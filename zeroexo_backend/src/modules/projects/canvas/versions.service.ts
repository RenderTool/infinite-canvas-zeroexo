import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { ProjectVersion } from '@prisma/client';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { notFound } from '../../../common/errors/app-exception.js';
import { ResourceService } from '../../assets/resource.service';
import { MinioService } from '../../assets/minio.service';
import { LogsService } from '../../logs/logs.service';
import { SyncService } from '../../sync/sync.service';
import { BaseProjectService } from '../common/base-project.service';

/** 快照硬性上限 */
const MAX_VERSIONS = 30;
/** 24 小时毫秒数(该窗口内快照全保留) */
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
/** 定时快照窗口(30 分钟),同一窗口内只存一个 */
const TIMER_WINDOW_MS = 30 * 60 * 1000;

/**
 * 版本快照服务 - 画布时间点快照的创建/查询/淘汰/回退。
 *
 * 快照文件: storage/resources/front/canvases/{ownerId}/{projectId}/scene-v{N}.json
 * 快照内容: { projectId, version, scene, connections, viewport, title, createdAt }
 * 元数据:   ProjectVersion 表(version/nodeCount/size/createdBy/label/source)
 *
 * 资源保护: 创建快照时,快照引用的资源 snapshotRefCount+1 并置 snapshotProtected=true,
 * GC 跳过受保护资源;快照淘汰时 snapshotRefCount-1,归零后解除保护。
 */
@Injectable()
export class VersionsService extends BaseProjectService {
  private readonly logger = new Logger(VersionsService.name);

  protected get storageModule(): string { return 'canvases'; }
  protected get versionStrategy(): 'lt' | 'neq' { return 'lt'; }
  protected get storageRoot(): string { return this.minioService.getStorageRoot(); }

  constructor(
    private readonly prisma: PrismaService,
    private readonly resourceService: ResourceService,
    private readonly minioService: MinioService,
    private readonly logsService: LogsService,
    private readonly syncService: SyncService,
  ) {
    super();
  }

  /**
   * 创建版本快照(主动保存或自动触发)。
   * 快照写入失败不阻塞主流程,仅记录日志(NFR-1)。
   */
  async createVersion(
    ownerId: string,
    projectId: string,
    opts: { label?: string; source?: string } = {},
  ): Promise<ProjectVersion> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.ownerId !== ownerId) {
      throw notFound('PROJECT_NOT_FOUND', 'Project not found or access denied');
    }

    const latest = await this.prisma.projectVersion.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
    const version = (latest?.version ?? 0) + 1;
    const scene = project.scene;
    const nodeCount = Array.isArray(scene) ? scene.length : 0;

    // 序列化快照内容,写入 scene-v{N}.json
    const payload = {
      projectId,
      version,
      scene,
      connections: project.connections,
      viewport: project.viewport,
      title: project.title,
      createdAt: new Date().toISOString(),
    };
    const size = Buffer.byteLength(JSON.stringify(payload));

    try {
      const dir = this.getProjectDir(ownerId, projectId);
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `scene-v${version}.json`);
      await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      this.logger.warn(
        `版本快照文件写入失败(projectId=${projectId}, version=${version}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.logsService.log('project', `版本快照文件写入失败: ${projectId}`, {
        level: 'warn',
        userId: ownerId,
        meta: { version, error: err instanceof Error ? err.message : String(err) },
      });
    }

    // 快照引用的资源标记保护(引用计数)
    const keys = this.resourceService.extractStorageKeysFromScene(scene);
    await this.protectResources(keys);

    const record = await this.prisma.projectVersion.create({
      data: {
        projectId,
        version,
        size,
        nodeCount,
        createdBy: ownerId,
        label: opts.label ?? null,
        source: opts.source ?? 'manual',
      },
    });

    // 新增快照后自动执行淘汰
    await this.evictVersions(projectId);

    this.logsService.log('project', `创建版本快照: ${project.title}`, {
      userId: ownerId,
      meta: { id: projectId, version, source: record.source, nodeCount },
    });

    return record;
  }

  /** 版本列表(元数据),按 version 降序 */
  async listVersions(ownerId: string, projectId: string): Promise<ProjectVersion[]> {
    await this.assertOwner(ownerId, projectId);
    return this.prisma.projectVersion.findMany({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
  }

  /** 获取指定版本的完整数据(scene/connections/viewport) */
  async getVersion(
    ownerId: string,
    projectId: string,
    version: number,
  ): Promise<Record<string, unknown>> {
    await this.assertOwner(ownerId, projectId);
    const record = await this.prisma.projectVersion.findUnique({
      where: { projectId_version: { projectId, version } },
    });
    if (!record) {
      throw notFound('VERSION_NOT_FOUND', 'Snapshot version not found');
    }
    const filePath = this.getVersionFilePath(ownerId, projectId, version);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      this.logger.warn(
        `版本快照文件缺失(projectId=${projectId}, version=${version}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw notFound('VERSION_FILE_NOT_FOUND', 'Snapshot file not found');
    }
  }

  /** 删除指定快照(文件 + 元数据 + 解除资源保护) */
  async deleteVersion(ownerId: string, projectId: string, version: number): Promise<void> {
    await this.assertOwner(ownerId, projectId);
    const record = await this.prisma.projectVersion.findUnique({
      where: { projectId_version: { projectId, version } },
    });
    if (!record) {
      throw notFound('VERSION_NOT_FOUND', 'Snapshot version not found');
    }

    // 删除快照文件(文件不存在则忽略)
    const filePath = this.getVersionFilePath(ownerId, projectId, version);
    await fs.unlink(filePath).catch(() => {});

    // 解除该快照引用的资源保护
    const scene = await this.readSnapshotScene(ownerId, projectId, version).catch(() => null);
    if (scene) {
      const keys = this.resourceService.extractStorageKeysFromScene(scene);
      await this.releaseResources(keys);
    }

    await this.prisma.projectVersion.delete({ where: { id: record.id } });

    this.logsService.log('project', `删除版本快照: ${projectId} v${version}`, {
      userId: ownerId,
      meta: { projectId, version },
    });
  }

  /**
   * 回退到指定版本(事务性):
   * 1. 读取指定版本快照
   * 2. 检查快照引用的资源是否存在(返回缺失列表 warnings)
   * 3. 将快照数据写回 Project 表(version 递增)
   * 4. 刷新资源引用计数(旧 scene -1,新 scene +1)
   * 5. 将回滚结果作为权威版本广播到 Yjs(Hocuspocus),所有在线端实时切换
   * 6. 返回新版本号、缺失资源警告与回滚后的完整 graph(供前端对齐本地缓存)
   */
  async rollback(
    ownerId: string,
    projectId: string,
    version: number,
  ): Promise<{
    version: number;
    warnings: string[];
    graph: { scene: unknown; connections: unknown; viewport: unknown };
    lastSyncedAt: Date | null;
  }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.ownerId !== ownerId) {
      throw notFound('PROJECT_NOT_FOUND', 'Project not found or access denied');
    }
    const record = await this.prisma.projectVersion.findUnique({
      where: { projectId_version: { projectId, version } },
    });
    if (!record) {
      throw notFound('VERSION_NOT_FOUND', 'Snapshot version not found');
    }

    const snapshot = await this.getVersion(ownerId, projectId, version);
    const scene = snapshot.scene ?? [];
    const connections = snapshot.connections ?? project.connections;
    const viewport = snapshot.viewport ?? project.viewport;

    // 检查快照引用的资源是否存在(Resource 记录缺失 = 已被 GC 物理删除)
    const snapshotKeys = this.resourceService.extractStorageKeysFromScene(scene);
    const warnings: string[] = [];
    if (snapshotKeys.size > 0) {
      const existing = await this.prisma.resource.findMany({
        where: { storageKey: { in: [...snapshotKeys] } },
        select: { storageKey: true },
      });
      const existingSet = new Set(existing.map((r) => r.storageKey));
      for (const key of snapshotKeys) {
        if (!existingSet.has(key)) {
          warnings.push(key);
        }
      }
    }

    // 事务: 写回 Project + 调整资源引用计数
    const oldKeys = this.resourceService.extractStorageKeysFromScene(project.scene);
    const added = new Set([...snapshotKeys].filter((k) => !oldKeys.has(k)));
    const removed = new Set([...oldKeys].filter((k) => !snapshotKeys.has(k)));

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.project.update({
        where: { id: projectId },
        data: {
          scene: scene as object,
          connections: connections as object,
          viewport: viewport as object,
          version: project.version + 1,
          lastSyncedAt: new Date(),
        },
      });
      if (added.size > 0) {
        for (const key of added) {
          await this.resourceService.incrementRef(key);
        }
      }
      if (removed.size > 0) {
        for (const key of removed) {
          await this.resourceService.decrementRef(key);
        }
      }
      return next;
    });

    this.logsService.log('project', `版本回退: ${project.title} 到 v${version}`, {
      userId: ownerId,
      meta: {
        id: projectId,
        fromVersion: project.version,
        toVersion: version,
        newVersion: updated.version,
        missingResources: warnings.length,
      },
    });

    // 将回滚结果作为权威版本广播到所有在线端(Yjs/Hocuspocus)：
    // 在线端实时 replaceState 切换到回滚版本；失败仅告警，不影响已落库的结果。
    await this.syncService.publishCanvasGraph(projectId, {
      scene,
      connections,
      viewport,
    });

    return {
      version: updated.version,
      warnings,
      graph: { scene, connections, viewport },
      lastSyncedAt: updated.lastSyncedAt,
    };
  }

  /** 手动触发淘汰清理(供管理后台使用) */
  async runCleanup(ownerId: string, projectId: string): Promise<number> {
    await this.assertOwner(ownerId, projectId);
    const before = await this.prisma.projectVersion.count({ where: { projectId } });
    await this.evictVersions(projectId);
    const after = await this.prisma.projectVersion.count({ where: { projectId } });
    return before - after;
  }

  /**
   * 定时自动快照(每 30 分钟):检查有修改的项目,同一 30 分钟窗口内只存一个。
   * 仅对 ownerId 有效的活跃项目生效,失败不中断任务。
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async timerAutoSnapshot(): Promise<void> {
    const since = new Date(Date.now() - TIMER_WINDOW_MS * 2);
    const candidates = await this.prisma.project.findMany({
      where: { updatedAt: { gte: since } },
      select: { id: true, ownerId: true, updatedAt: true, scene: true },
      take: 500,
    });
    let created = 0;
    for (const project of candidates) {
      try {
        // 该窗口内已存在自动快照则跳过
        const lastAuto = await this.prisma.projectVersion.findFirst({
          where: { projectId: project.id, source: 'auto-timer' },
          orderBy: { createdAt: 'desc' },
        });
        if (lastAuto && Date.now() - lastAuto.createdAt.getTime() < TIMER_WINDOW_MS) continue;
        // 快照需晚于上次自动快照,避免无修改重复创建
        if (lastAuto && project.updatedAt <= lastAuto.createdAt) continue;
        if (!Array.isArray(project.scene) || project.scene.length === 0) continue;

        await this.createVersion(project.ownerId, project.id, {
          label: '自动快照',
          source: 'auto-timer',
        });
        created++;
      } catch (err) {
        this.logger.warn(
          `定时自动快照失败(projectId=${project.id}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (created > 0) {
      this.logger.log(`定时自动快照: 为 ${created} 个项目创建快照`);
    }
  }

  // ========== 内部方法 ==========

  private async assertOwner(ownerId: string, projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });
    if (!project || project.ownerId !== ownerId) {
      throw notFound('PROJECT_NOT_FOUND', 'Project not found or access denied');
    }
  }

  /** 版本快照文件路径 */
  private getVersionFilePath(ownerId: string, projectId: string, version: number): string {
    return path.join(this.getProjectDir(ownerId, projectId), `scene-v${version}.json`);
  }

  /** 读取快照文件的 scene 数据(文件缺失时抛错) */
  private async readSnapshotScene(
    ownerId: string,
    projectId: string,
    version: number,
  ): Promise<unknown> {
    const data = await this.getVersion(ownerId, projectId, version);
    return data.scene;
  }

  /** 快照引用资源保护: snapshotRefCount+1,置 snapshotProtected=true */
  private async protectResources(keys: Set<string>): Promise<void> {
    if (keys.size === 0) return;
    for (const key of keys) {
      await this.prisma.resource.updateMany({
        where: { storageKey: key },
        data: { snapshotRefCount: { increment: 1 }, snapshotProtected: true },
      });
    }
  }

  /** 解除资源保护: snapshotRefCount-1,归零后 snapshotProtected=false */
  private async releaseResources(keys: Set<string>): Promise<void> {
    if (keys.size === 0) return;
    for (const key of keys) {
      const resource = await this.prisma.resource.findUnique({ where: { storageKey: key } });
      if (!resource || resource.snapshotRefCount <= 0) continue;
      const newCount = resource.snapshotRefCount - 1;
      await this.prisma.resource.update({
        where: { id: resource.id },
        data: { snapshotRefCount: newCount, snapshotProtected: newCount > 0 },
      });
    }
  }

  /**
   * 时间窗口淘汰策略:
   * - 24 小时内: 全保留
   * - 24 小时 ~ 7 天: 每 2 小时保留一个
   * - 7 天以上: 每天保留一个
   * - 硬性上限: 最多 30 个(超出时从最旧开始删)
   */
  private async evictVersions(projectId: string): Promise<void> {
    const versions = await this.prisma.projectVersion.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    if (versions.length <= MAX_VERSIONS) return;

    const now = Date.now();
    // 分组桶: 每窗口保留最新一个
    const buckets = new Map<string, ProjectVersion>();
    for (const v of versions) {
      const age = now - v.createdAt.getTime();
      if (age <= DAY_MS) continue; // 24h 内全保留
      const windowMs = age <= WEEK_MS ? 2 * HOUR_MS : DAY_MS;
      const bucketKey = `${windowMs}:${Math.floor(v.createdAt.getTime() / windowMs)}`;
      const existing = buckets.get(bucketKey);
      if (!existing || v.createdAt > existing.createdAt) {
        buckets.set(bucketKey, v);
      }
    }

    const toRemove = new Set<string>();
    for (const v of versions) {
      const age = now - v.createdAt.getTime();
      if (age <= DAY_MS) continue;
      const windowMs = age <= WEEK_MS ? 2 * HOUR_MS : DAY_MS;
      const bucketKey = `${windowMs}:${Math.floor(v.createdAt.getTime() / windowMs)}`;
      if (buckets.get(bucketKey)?.id !== v.id) {
        toRemove.add(v.id);
      }
    }

    // 硬性上限: 保留最新 MAX_VERSIONS 个,超出部分从最旧开始删
    const kept = versions.filter((v) => !toRemove.has(v.id));
    const excess = kept.length - MAX_VERSIONS;
    if (excess > 0) {
      const oldest = [...kept].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      for (let i = 0; i < excess; i++) {
        toRemove.add(oldest[i].id);
      }
    }

    for (const v of versions) {
      if (toRemove.has(v.id)) {
        try {
          const filePath = this.getVersionFilePath(v.createdBy, projectId, v.version);
          await fs.unlink(filePath).catch(() => {});
          // 解除资源保护(优先从快照文件读 scene,缺失时跳过保护解除)
          const scene = await this.readSnapshotScene(v.createdBy, projectId, v.version).catch(() => null);
          if (scene) {
            await this.releaseResources(this.resourceService.extractStorageKeysFromScene(scene));
          }
          await this.prisma.projectVersion.delete({ where: { id: v.id } });
        } catch (err) {
          this.logger.warn(
            `快照淘汰失败(projectId=${projectId}, version=${v.version}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
  }
}
