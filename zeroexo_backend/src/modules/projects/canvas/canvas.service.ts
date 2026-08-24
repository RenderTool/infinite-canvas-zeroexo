import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ResourceService } from '../../assets/resource.service';
import { MinioService } from '../../assets/minio.service';
import { LogsService } from '../../logs/logs.service';
import { BaseProjectService } from '../common/base-project.service';
import { notFound } from '../../../common/errors/app-exception.js';
import { CreateProjectDto, UpdateProjectDto } from './dto/canvas.dto';

/** 默认每页条数 */
const DEFAULT_LIMIT = 20;
/** 单页最大条数 */
const MAX_LIMIT = 100;

/**
 * 画布服务 - 当前用户的画布项目 CRUD(仅能操作 ownerId === currentUser.id)。
 * 列表接口采用游标分页(cursor + take + skip 1)。
 *
 * 资源引用:画布创建/更新/删除时,解析 scene 中的 storageKey,
 * 通过 ResourceService 维护引用计数。
 */
@Injectable()
export class CanvasService extends BaseProjectService {
  protected get storageModule(): string { return 'canvases'; }
  protected get storageRoot(): string { return this.minioService.getStorageRoot(); }

  constructor(
    private readonly prisma: PrismaService,
    private readonly resourceService: ResourceService,
    private readonly minioService: MinioService,
    private readonly logsService: LogsService,
  ) {
    super();
  }

  /**
   * 写画布方案快照到文件系统(数据库主存的备份)。
   * 路径: storage/resources/front/canvases/{ownerId}/{projectId}/scene.json
   * 异步写入,失败仅记录日志,不影响主流程。
   */
  private async writeCanvasSnapshot(
    projectId: string,
    ownerId: string,
    data: { scene?: unknown; connections?: unknown; viewport?: unknown; title?: string },
  ): Promise<void> {
    try {
      await this.writeSnapshot(ownerId, projectId, data as Record<string, unknown>);
    } catch (err) {
      this.logsService.log('project', `画布快照写入失败: ${projectId}`, {
        userId: '',
        meta: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  // 分页查询当前用户的项目
  async list(
    ownerId: string,
    cursor?: string,
    limit?: number,
    keyword?: string,
  ) {
    const take = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const where: Prisma.ProjectWhereInput = { ownerId };
    if (keyword && keyword.trim()) {
      where.title = { contains: keyword.trim(), mode: 'insensitive' };
    }
    // 多取 1 条用于判断是否有下一页
    const items = await this.prisma.project.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > take;
    const data = hasMore ? items.slice(0, take) : items;
    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? last.id : null;
    return { items: data, nextCursor };
  }

  // 创建项目(同步场景可携带 id、graph 数据等)
  async create(ownerId: string, dto: CreateProjectDto) {
    const project = await this.prisma.project.create({
      data: {
        ownerId,
        title: dto.title,
        ...(dto.id ? { id: dto.id } : {}),
        ...(dto.scene !== undefined ? { scene: dto.scene as Prisma.InputJsonValue } : {}),
        ...(dto.connections !== undefined
          ? { connections: dto.connections as Prisma.InputJsonValue }
          : {}),
        ...(dto.viewport !== undefined ? { viewport: dto.viewport as Prisma.InputJsonValue } : {}),
        ...(dto.thumbnailUrl !== undefined ? { thumbnailUrl: dto.thumbnailUrl } : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
        lastSyncedAt: new Date(),
      },
    });

    // 增加场景中所有 storageKey 的引用计数
    if (dto.scene !== undefined) {
      const keys = this.resourceService.extractStorageKeysFromScene(dto.scene);
      for (const key of keys) {
        await this.resourceService.incrementRef(key);
      }
    }

    this.logOperation(this.logsService, `创建画布: ${dto.title}`, {
      userId: ownerId,
      meta: { id: project.id, title: dto.title },
    });

    // 写画布快照到文件系统(数据库主存的备份)
    if (dto.scene !== undefined) {
      await this.writeCanvasSnapshot(project.id, ownerId, {
        scene: dto.scene,
        connections: dto.connections,
        viewport: dto.viewport,
        title: dto.title,
      });
    }

    return project;
  }

  // 获取单个项目(所有者优先;协作成员也可读取)
  async findOne(ownerId: string, id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw notFound('PROJECT_NOT_FOUND', 'Project not found');
    }
    // 项目所有者直接返回
    if (project.ownerId === ownerId) {
      return project;
    }
    // 非所有者:检查是否是该画布协作房间的活跃成员
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId: id, status: 'active' },
      select: { id: true },
    });
    if (room) {
      const member = await this.prisma.collaborationMember.findFirst({
        // 已入房成员均可读（含 offline：离屏不等于退出，再次打开不应报项目不存在）；
        // 待审申请（pending）与封禁除外（Plan#38 Phase 8 + 验收热修）
        where: { roomId: room.id, userId: ownerId, status: { notIn: ['banned', 'pending'] } },
        select: { id: true },
      });
      if (member) {
        return project;
      }
    }
    throw notFound('PROJECT_NOT_FOUND', 'Project not found or access denied');
  }

  // 更新项目(每次更新自增 version,刷新 lastSyncedAt)
  // 安全措施: 项目不存在时自动创建(upsert 语义),兼容历史版本本地 ID
  // 资源引用: scene 变更时 diff storageKey 集合,增量调整引用计数
  async update(ownerId: string, id: string, dto: UpdateProjectDto) {
    const existing = await this.prisma.project.findUnique({ where: { id } });

    if (!existing || existing.ownerId !== ownerId) {
      // 项目不存在或不属于当前用户 → 用传入的 id 自动创建(兼容旧本地 ID)
      const created = await this.prisma.project.create({
        data: {
          id,
          ownerId,
          title: dto.title ?? '未命名画布',
          ...(dto.scene !== undefined
            ? { scene: dto.scene as Prisma.InputJsonValue }
            : {}),
          ...(dto.connections !== undefined
            ? { connections: dto.connections as Prisma.InputJsonValue }
            : {}),
          ...(dto.viewport !== undefined
            ? { viewport: dto.viewport as Prisma.InputJsonValue }
            : {}),
          ...(dto.backgroundMode !== undefined
            ? { backgroundMode: dto.backgroundMode }
            : {}),
          ...(dto.showImageInfo !== undefined
            ? { showImageInfo: dto.showImageInfo }
            : {}),
          ...(dto.thumbnailUrl !== undefined
            ? { thumbnailUrl: dto.thumbnailUrl }
            : {}),
          ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
          ...(dto.isPublic !== undefined ? { isPublic: dto.isPublic } : {}),
          lastSyncedAt: new Date(),
        },
      });

      // 新建项目:增加场景中所有 storageKey 的引用计数
      if (dto.scene !== undefined) {
        const keys = this.resourceService.extractStorageKeysFromScene(dto.scene);
        for (const key of keys) {
          await this.resourceService.incrementRef(key);
        }
      }

      this.logOperation(this.logsService, `自动创建画布(历史 ID): ${created.title}`, {
        userId: ownerId,
        meta: { id, title: created.title },
      });

      // 写画布快照到文件系统(数据库主存的备份)
      if (dto.scene !== undefined) {
        await this.writeCanvasSnapshot(id, ownerId, {
          scene: dto.scene,
          connections: dto.connections,
          viewport: dto.viewport,
          title: dto.title ?? created.title,
        });
      }

      return created;
    }

    // scene 变更时:diff 旧/新 storageKey,调整引用计数。
    // （Phase3:增量合并通道已退役,scene 一律全量替换;画布写路径由 Yjs 落库承担,
    // 此分支仅为历史遗留的 HTTP 快照/元数据通道保留幂等写语义）
    if (dto.scene !== undefined) {
      const oldKeys = this.resourceService.extractStorageKeysFromScene(existing.scene);
      const newKeys = this.resourceService.extractStorageKeysFromScene(dto.scene);
      const added = new Set([...newKeys].filter((k) => !oldKeys.has(k)));
      const removed = new Set([...oldKeys].filter((k) => !newKeys.has(k)));
      if (added.size > 0 || removed.size > 0) {
        await this.resourceService.adjustRefs(added, removed);
      }
    }

    const project = await this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.scene !== undefined
          ? { scene: dto.scene as Prisma.InputJsonValue }
          : {}),
        ...(dto.connections !== undefined
          ? { connections: dto.connections as Prisma.InputJsonValue }
          : {}),
        ...(dto.viewport !== undefined
          ? { viewport: dto.viewport as Prisma.InputJsonValue }
          : {}),
        ...(dto.backgroundMode !== undefined
          ? { backgroundMode: dto.backgroundMode }
          : {}),
        ...(dto.showImageInfo !== undefined
          ? { showImageInfo: dto.showImageInfo }
          : {}),
        ...(dto.thumbnailUrl !== undefined
          ? { thumbnailUrl: dto.thumbnailUrl }
          : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
        ...(dto.isPublic !== undefined ? { isPublic: dto.isPublic } : {}),
        version: existing.version + 1,
        lastSyncedAt: new Date(),
      },
    });
    this.logOperation(this.logsService, `画布同步: ${project.title}`, {
      userId: ownerId,
      meta: { id, title: dto.title ?? project.title, version: project.version },
    });

    // 写画布快照到文件系统(数据库主存的备份)
    if (dto.scene !== undefined) {
      await this.writeCanvasSnapshot(project.id, ownerId, {
        scene: dto.scene,
        connections: dto.connections,
        viewport: dto.viewport,
        title: dto.title ?? project.title,
      });
    }

    return project;
  }

  // 删除项目 - 仅删除画布数据,不删除底层资源文件
  // 减少场景中所有 storageKey 的引用计数
  async remove(ownerId: string, id: string) {
    const project = await this.findOne(ownerId, id);

    // 减少场景中所有 storageKey 的引用计数
    const keys = this.resourceService.extractStorageKeysFromScene(project.scene);
    for (const key of keys) {
      await this.resourceService.decrementRef(key);
    }

    await this.prisma.project.delete({ where: { id } });
    this.logOperation(this.logsService, `删除画布: ${project.title}`, {
      userId: ownerId,
      meta: { id, title: project.title },
    });

    return { message: '项目已删除' };
  }

  /**
   * 分页获取画布 graph 节点。
   * scene 存储为 JSON 数组，直接按 offset/limit 切片返回。
   * 同时返回 total 总数供前端计算剩余页数。
   */
  async getGraphPaginated(
    ownerId: string,
    projectId: string,
    offset: number,
    limit: number,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true, scene: true, connections: true, viewport: true },
    });
    if (!project || project.ownerId !== ownerId) {
      throw notFound('PROJECT_NOT_FOUND', 'Project not found or access denied');
    }

    const scene = Array.isArray(project.scene) ? (project.scene as Record<string, unknown>[]) : [];
    const total = scene.length;
    const page = scene.slice(offset, offset + limit);

    return {
      nodes: page,
      connections: project.connections ?? [],
      viewport: project.viewport ?? null,
      total,
      offset,
      limit,
      hasMore: offset + limit < total,
    };
  }

  }
