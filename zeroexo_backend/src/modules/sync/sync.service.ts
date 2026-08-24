import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { IncomingMessage, Server as HttpServer } from 'http';
import type { Duplex } from 'stream';
import * as jwt from 'jsonwebtoken';
import { Server, Extension } from '@hocuspocus/server';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ResourceService } from '../assets/resource.service';

/** 命名空间 → Project 字段映射（canvas 走 Project 表，不在此映射） */
const NAMESPACE_FIELD = {
  script: 'script',
  storyboard: 'storyboard',
  generations: 'generations',
} as const;

/** 画布命名空间：数据存 Project 表（scene/connections/viewport） */
const CANVAS_NAMESPACE = 'canvas';

type SyncNamespace = keyof typeof NAMESPACE_FIELD | typeof CANVAS_NAMESPACE;

/** 合法命名空间列表（决定是否允许建立连接） */
const VALID_NAMESPACES: readonly string[] = ['script', 'storyboard', 'generations', CANVAS_NAMESPACE];

/**
 * WebSocket 消息保护 Extension
 * - 大小限制：单条更新不超过 1MB
 * - 频率限制：每用户每秒最多 60 条更新
 */
class RateLimitExtension implements Extension {
  private readonly logger = new Logger('RateLimitExtension');
  private readonly updateCounts = new Map<string, { count: number; resetAt: number; lastWarnedAt?: number }>();
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private lastSizeWarnAt = 0;

  constructor() {
    // 每 5 分钟清理过期记录，防止内存泄漏
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, record] of this.updateCounts) {
        if (now > record.resetAt + 60_000) {
          this.updateCounts.delete(key);
        }
      }
    }, 300_000);
  }

  // 实现 Extension.onChange(data) 钩子 — 每个 Yjs 更新都会触发
  // ⚠️ 禁止在此 throw：Hocuspocus 4.x 的 onChange 钩子调用点无 catch 保护，
  // 抛错会变成 unhandledRejection 直接退出整个进程（Node 15+ 默认行为）。
  // 画布大更新（>1MB，如含 base64 图的完整 graph）会周期性触发，导致后端
  // 「启动一会就自己关闭」。超限仅记录告警并放行，保护优先级低于服务可用性。
  async onChange(data: { documentName: string; context: any; update: Uint8Array }) {
    // 1. 检查消息大小（单条更新不超过 1MB；超限仅告警不阻断）
    if (data.update && data.update.byteLength > 1_048_576) {
      const now = Date.now();
      if (now - this.lastSizeWarnAt > 5000) {
        this.logger.warn(
          `[SIZE] 更新过大: ${data.documentName}, size=${(data.update.byteLength / 1024).toFixed(1)}KB（已放行）`,
        );
        this.lastSizeWarnAt = now;
      }
      return;
    }

    // 2. 检查频率（同样只告警不抛错，5s 节流防刷屏）
    const userId = data.context?.userId as string | undefined;
    if (!userId) return;

    const now = Date.now();
    const record = this.updateCounts.get(userId);
    if (!record || now > record.resetAt) {
      this.updateCounts.set(userId, { count: 1, resetAt: now + 1000 });
      return;
    }

    record.count++;
    if (record.count > 60) {
      if (!record.lastWarnedAt || now - record.lastWarnedAt > 5000) {
        this.logger.warn(`[RATE] 用户 ${userId} 更新频率过高: ${data.documentName}（已放行）`);
        record.lastWarnedAt = now;
      }
      return;
    }
  }

  // 清理定时器
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}

/** 从 docName 解析命名空间与项目 ID（兼容 `/ws-sync/script:xxx` 等多段路径） */
function parseDocName(docName: string): { namespace: SyncNamespace; artifactId: string } | null {
  const cleaned = docName.split('/').pop() ?? '';
  const sep = cleaned.indexOf(':');
  if (sep === -1) return null;
  const namespace = cleaned.slice(0, sep) as SyncNamespace;
  if (!VALID_NAMESPACES.includes(namespace)) return null;
  const artifactId = cleaned.slice(sep + 1);
  if (!artifactId) return null;
  return { namespace, artifactId };
}

/**
   * 分镜加载规范化：旧数据（无 versions）包装成单个"初始版本"。
   * episodes 是活跃版本的镜像，不写入 Y.Doc（由 onStoreDocument 派生）。
   */
function normalizeStoryboardForLoad(snapshot: unknown): Record<string, unknown> {
  const obj = (snapshot && typeof snapshot === 'object' ? snapshot : {}) as Record<string, unknown>;
  if (Array.isArray(obj.versions) && obj.versions.length > 0) {
    // DB 中可能残留 Agent 直写后的 episodes 镜像（save_shots 只更新镜像不更新版本内剧集），
    // 回填到活跃版本，保证 Y.Doc 初始状态与前端 wrapToVersions 一致
    if (Array.isArray(obj.episodes)) {
      const versions = obj.versions as Array<{ id?: string }>;
      const vid = versions.find((v) => v.id === obj.activeVersionId)?.id ?? versions[0]?.id;
      if (vid) {
        return {
          ...obj,
          versions: versions.map((v) => (v.id === vid ? { ...v, episodes: obj.episodes } : v)),
        };
      }
    }
    return obj;
  }
  const episodes = Array.isArray(obj.episodes) ? (obj.episodes as unknown[]) : [];
  return {
    ...obj,
    versions: [{
      id: 'v1',
      name: '初始版本',
      source: '用户手写',
      createdAt: new Date().toISOString(),
      episodes,
    }],
    activeVersionId: 'v1',
    activeEpisodeId: (episodes[0] as { episodeId?: string } | undefined)?.episodeId ?? '',
  };
}

/** 分镜存储派生：按活跃版本重建 episodes 镜像，保持后端 Agent 工具（save_shots 等）v2 兼容 */
function deriveStoryboardForStore(mapJson: Record<string, unknown>): Record<string, unknown> {
  const versions = Array.isArray(mapJson.versions)
    ? (mapJson.versions as Array<{ id?: string; episodes?: unknown }>)
    : [];
  const activeVersion = versions.find((v) => v.id === mapJson.activeVersionId) ?? versions[0];
  return {
    ...mapJson,
    schemaVersion: 2,
    episodes: activeVersion?.episodes ?? [],
  };
}

/**
 * SyncService - Yjs 实时同步（Hocuspocus 挂载到现有 HTTP server）
 *
 * 职责：
 * - onAuthenticate：校验 JWT，注入 userId 到 context
 * - onLoadDocument：从 Project.{field} 的 JSON 快照填充 Y.Doc（canvas 允许 active 协作成员加载）
 * - onStoreDocument：将 Y.Doc 顶层 Y.Map 序列化为 JSON 快照写回 Project.{field}
 *   （Plan#40 Phase1：canvas 命名空间也落库——Yjs 单主干方向的最后一块；
 *   双写观察期内不递增 version（HTTP 乐观锁仍管版本），落库时增量 diff 维护 refCount）
 *
 * 多浏览器实时合并由 Yjs CRDT 协议保证；快照落库为防抖写入（debounce 2s / maxDebounce 10s），
 */
@Injectable()
export class SyncService implements OnModuleDestroy {
  private readonly logger = new Logger(SyncService.name);
  private server?: Server;
  private nestHttpServer?: HttpServer;
  private upgradeForwarder?: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly resourceService: ResourceService,
  ) {}

  /**
   * canvas 访问权限判定：画布 owner 或 active 协作房间的已批准成员（排除 pending 待审）。
   * requireEdit=true 时额外要求成员持有 edit 权限（对齐 #38 只读/可编辑两档：
   * viewer 只读不落库；服务端写权限强制校验的已知缺口在此部分收口）。
   * 供 onLoadDocument（requireEdit=false）与 onStoreDocument（requireEdit=true）共用。
   */
  private async canAccessCanvas(userId: string, canvasId: string, requireEdit = false): Promise<boolean> {
    const project = await this.prisma.project.findUnique({
      where: { id: canvasId },
      select: { ownerId: true },
    });
    if (!project) return false;
    if (project.ownerId === userId) return true;
    const membership = await this.prisma.collaborationMember.findFirst({
      where: {
        userId,
        // banned(封禁)/left(退出/被踢)不得读写画布——状态优先级: banned > left > muted/offline/online
        status: { notIn: ['banned', 'left', 'pending'] },
        room: { canvasId, status: 'active' },
      },
      select: { id: true, role: true, permissions: true },
    });
    if (!membership) return false;
    if (!requireEdit) return true;
    return membership.role === 'editor' || membership.permissions.split(',').includes('edit');
  }

  /** 将 Yjs WebSocket 服务挂载到 NestJS 的 HTTP server（不占用新端口） */
  attach(httpServer: HttpServer): void {
    const secret = process.env.JWT_SECRET ?? '';
    if (!secret.trim()) {
      throw new Error('JWT_SECRET 未配置，请在环境变量中设置强随机密钥（如 openssl rand -hex 64）');
    }

    this.server = new Server({
      name: 'zeroexo-sync',
      extensions: [
        new RateLimitExtension(),
      ],
      // 关键：不能把 NestJS httpServer 传给 websocketOptions.server！
      // crossws 的 node adapter 内部先置 noServer:true 再展开 serverOptions，
      // 传 server 后 ws 会走自身 handleUpgrade 链路，request 缺少 crossws 注入的
      // _namespace，导致 getPeers 抛 "Websocket publish namespace missing" 崩溃。
      // 保持 crossws 默认 noServer:true，由下方 upgrade 转发走 Hocuspocus 的
      // setupHttpUpgrade 链（内部会调用 crossws.handleUpgrade 注入 namespace）。
      websocketOptions: {},
      // 快照落库防抖：默认 2s，最长 10s 必写一次
      debounce: 2000,
      maxDebounce: 10000,
      onAuthenticate: async (data: { token?: string }) => {
        const token = typeof data.token === 'string' ? data.token : '';
        if (!token) throw new Error('Unauthorized');
        try {
          const payload = jwt.verify(token, secret) as { sub?: string };
          if (!payload?.sub) throw new Error('Unauthorized');
          return { userId: payload.sub };
        } catch {
          throw new Error('Unauthorized');
        }
      },
      onLoadDocument: async (data: { documentName: string; document: { getMap: () => any }; context: any }) => {
        const parsed = parseDocName(data.documentName);
        if (!parsed) return;
        const userId = data.context?.userId as string | undefined;
        if (!userId) return;

        // canvas：读 Project 表 scene/connections/viewport，包装为 graph 对象
        // Plan#40 Phase1：除 owner 外，active 协作房间的已批准成员也可加载（协作者编辑需服务端播种）
        if (parsed.namespace === CANVAS_NAMESPACE) {
          if (!(await this.canAccessCanvas(userId, parsed.artifactId))) return;
          const canvasProject = await this.prisma.project.findUnique({ where: { id: parsed.artifactId } });
          if (!canvasProject) return;
          const ymap = data.document.getMap();
          if (ymap.size > 0) return;
          ymap.set('nodes', (canvasProject.scene as unknown) ?? []);
          ymap.set('edges', (canvasProject.connections as unknown) ?? []);
          ymap.set('viewport', (canvasProject.viewport as unknown) ?? { x: 0, y: 0, k: 1 });
          return;
        }

        const project = await this.prisma.project.findUnique({ where: { id: parsed.artifactId } });
        if (!project || project.ownerId !== userId) return;

        // 仅当文档为空时从快照填充，避免覆盖并发编辑
        const ymap = data.document.getMap();
        if (ymap.size > 0) return;
        const field = NAMESPACE_FIELD[parsed.namespace];
        const snapshot = project[field] as unknown;
        if (!snapshot || typeof snapshot !== 'object') return;

        // 分镜：旧数据包装为"初始版本"；episodes 镜像不入 Y.Doc（由 onStore 派生）
        if (parsed.namespace === 'storyboard') {
          const normalized = normalizeStoryboardForLoad(snapshot);
          for (const [key, value] of Object.entries(normalized)) {
            if (key === 'episodes') continue;
            ymap.set(key, value);
          }
          return;
        }

        for (const [key, value] of Object.entries(snapshot as Record<string, unknown>)) {
          ymap.set(key, value);
        }
      },
      onStoreDocument: async (data: { documentName: string; document: { getMap: () => any }; lastContext: any }) => {
        const parsed = parseDocName(data.documentName);
        if (!parsed) return;
        const userId = data.lastContext?.userId as string | undefined;
        if (!userId) return;

        const json = data.document.getMap().toJSON();
        if (Object.keys(json).length === 0) return;

        // canvas 落库（Plan#40 Phase1：Yjs 单主干方向补齐最后一块）。
        // 双写观察期：HTTP PATCH 推送仍保留，本钩子与其幂等写同一行；
        // 不递增 version（乐观锁版本仍由 HTTP 路径管理，避免 409 风暴），
        // refCount 增量 diff（拍板点①：复用 resourceService 现成能力）。
        if (parsed.namespace === CANVAS_NAMESPACE) {
          try {
            await this.storeCanvasDocument(userId, parsed.artifactId, json);
          } catch (err) {
            // ⚠️ 钩子内禁止 throw（hocuspocus-hook-throw-crash 经验）：只告警放行
            this.logger.warn(
              `[sync] canvas store failed: ${data.documentName} - ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          return;
        }

        const field = NAMESPACE_FIELD[parsed.namespace];
        // 分镜：按活跃版本重建 episodes 镜像，保持后端 Agent 工具 v2 兼容
        const payload = parsed.namespace === 'storyboard' ? deriveStoryboardForStore(json) : json;

        try {
          await this.prisma.project.updateMany({
            where: { id: parsed.artifactId, ownerId: userId },
            data: { [field]: payload as object },
          });
        } catch (err) {
          this.logger.warn(`store document failed: ${data.documentName} - ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });

    // 复用 NestJS HTTP server 的 upgrade 事件：
    // 将连接请求转发给 Hocuspocus 内部 httpServer，由其 setupHttpUpgrade 链
    // 完成 crossws 握手（注入 namespace）与 Yjs 连接，不占用新端口。
    this.nestHttpServer = httpServer;
    this.upgradeForwarder = (request, socket, head) => {
      this.server?.httpServer.emit('upgrade', request, socket, head);
    };
    httpServer.on('upgrade', this.upgradeForwarder);

    this.logger.log('Yjs sync server attached to HTTP server');
  }

  /**
   * canvas Y.Doc 落库：scene/connections/viewport 写回 Project 表 + refCount 增量 diff。
   * - 权限：画布 owner 或 active 协作成员（协作中任意编辑者均可触发落库，
   *   修复原架构「协作期间 HTTP 被抑制且 Yjs 不落库 → 编辑只在内存」的持久化盲区）
   * - 双写观察期不递增 version；Phase3 删 HTTP 写路径后版本管理移交服务端落库。
   */
  private async storeCanvasDocument(
    userId: string,
    projectId: string,
    json: Record<string, unknown>,
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true, scene: true },
    });

    const scene = (json.nodes as unknown) ?? [];
    const connections = (json.edges as unknown) ?? [];
    const viewport = (json.viewport as unknown) ?? { x: 0, y: 0, k: 1 };

    // 项目不存在 → 自动创建（对齐 HTTP update 的 upsert 语义，兼容历史本地 ID）。
    // 必要性：Yjs connected 时前端已抑制 HTTP 推送（Phase3 前置），此处不建则
    // 新画布编辑只存在于内存与本地 IndexedDB，直到离开页面才补推创建。
    // 安全边界：仅当 findUnique 确实不存在时创建；存在但无权限时下方跳过，
    // 防止越权覆盖他人项目。
    if (!project) {
      await this.prisma.project.create({
        data: {
          id: projectId,
          ownerId: userId,
          title: '未命名画布',
          scene: scene as object,
          connections: connections as object,
          viewport: viewport as object,
          lastSyncedAt: new Date(),
        },
      });
      // 新建项目：全量增加 scene 中所有 storageKey 的引用计数（对齐 HTTP 自动创建）
      const keys = this.resourceService.extractStorageKeysFromScene(scene);
      if (keys.size > 0) {
        await this.resourceService.adjustRefs(keys, new Set());
      }
      this.logger.log(`[sync] canvas auto-created via Yjs store: ${projectId}`);
      return;
    }

    // 权限：owner 直通；非 owner 需为 active 协作房间的已批准编辑成员
    // （项目不存在分支已在上方处理，canAccessCanvas 的 findUnique 仅非 owner 触发）
    if (project.ownerId !== userId && !(await this.canAccessCanvas(userId, projectId, true))) {
      return;
    }

    // refCount 增量 diff：新旧 scene 的 storageKey 集合对比，只调整变化项（拍板点①）
    const oldKeys = this.resourceService.extractStorageKeysFromScene(project.scene);
    const newKeys = this.resourceService.extractStorageKeysFromScene(scene);
    const added = new Set([...newKeys].filter((k) => !oldKeys.has(k)));
    const removed = new Set([...oldKeys].filter((k) => !newKeys.has(k)));

    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        scene: scene as object,
        connections: connections as object,
        viewport: viewport as object,
        lastSyncedAt: new Date(),
      },
    });

    if (added.size > 0 || removed.size > 0) {
      await this.resourceService.adjustRefs(added, removed);
    }
  }

  /**
   * 权威写入画布 graph 到 Yjs 文档并广播给所有连接端。
   * 用于版本回滚等"整体覆盖"语义的权威操作：clear + set 替换 nodes/edges/viewport。
   * - 有在线连接的 doc：直接 transact 写入 → 各端 Yjs update 实时收到 → replaceState
   * - 无在线连接的 doc：无需广播，下次连接时 onLoadDocument 从 DB（已被回滚）注入
   * 失败仅告警，不阻塞回滚主流程（广播是增强，DB 已是权威源）。
   */
  async publishCanvasGraph(
    projectId: string,
    graph: { scene: unknown; connections: unknown; viewport: unknown },
  ): Promise<void> {
    const docName = `${CANVAS_NAMESPACE}:${projectId}`;
    const doc = this.server?.hocuspocus?.documents?.get(docName);
    if (!doc) {
      this.logger.log(`[sync] canvas authoritative publish skip (no active doc): ${docName}`);
      return;
    }
    try {
      doc.transact(() => {
        const ymap = doc.getMap();
        ymap.clear();
        ymap.set('nodes', (graph.scene as unknown) ?? []);
        ymap.set('edges', (graph.connections as unknown) ?? []);
        ymap.set('viewport', (graph.viewport as unknown) ?? { x: 0, y: 0, k: 1 });
      });
      this.logger.log(`[sync] canvas authoritative publish: ${docName}`);
    } catch (err) {
      this.logger.warn(
        `[sync] publish canvas graph failed ${docName}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.nestHttpServer && this.upgradeForwarder) {
      this.nestHttpServer.off('upgrade', this.upgradeForwarder);
    }
    await this.server?.destroy();
  }
}
