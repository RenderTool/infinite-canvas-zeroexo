import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { notFound } from '../../common/errors/app-exception.js';
import { LogsService } from '../logs/logs.service';
import { CreatePromptDto, UpdatePromptDto } from './dto/prompt.dto';

/** 默认每页条数 */
const DEFAULT_LIMIT = 20;
/** 单页最大条数 */
const MAX_LIMIT = 100;

/**
 * 提示词服务 - 当前用户的提示词 CRUD(仅能操作 ownerId === currentUser.id)。
 * 列表接口采用游标分页(cursor + take + skip 1),与 projects/assets 服务一致。
 */
@Injectable()
export class PromptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logsService: LogsService,
  ) {}

  /**
   * 分页查询当前用户的提示词(游标分页),可按 category 过滤,keyword 模糊搜索 title。
   * 当 type='all' 时,聚合自有提示词 + 收藏的公共提示词。
   */
  async list(
    ownerId: string,
    cursor?: string,
    limit?: number,
    category?: string,
    keyword?: string,
    folderId?: string,
    type?: string,
  ) {
    // type=all 时,聚合自有提示词 + 收藏的公共提示词
    if (type === 'all') {
      return this.listAll(ownerId, cursor, limit, category, keyword, folderId);
    }

    const take = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const where: Prisma.PromptWhereInput = { ownerId };
    if (category && category.trim()) {
      where.category = category.trim();
    }
    if (keyword && keyword.trim()) {
      where.title = { contains: keyword.trim(), mode: 'insensitive' };
    }
    if (folderId !== undefined) {
      where.folderId = folderId || null;
    }
    // 多取 1 条用于判断是否有下一页
    const items = await this.prisma.prompt.findMany({
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

  /** 聚合自有提示词 + 收藏的公共提示词 */
  private async listAll(
    ownerId: string,
    cursor?: string,
    limit?: number,
    category?: string,
    keyword?: string,
    folderId?: string,
  ) {
    const take = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    // 1. 查询自有提示词
    const ownWhere: Prisma.PromptWhereInput = { ownerId };
    if (category && category.trim()) {
      ownWhere.category = category.trim();
    }
    if (keyword && keyword.trim()) {
      ownWhere.title = { contains: keyword.trim(), mode: 'insensitive' };
    }
    if (folderId !== undefined) {
      ownWhere.folderId = folderId || null;
    }
    const ownPrompts = await this.prisma.prompt.findMany({
      where: ownWhere,
      orderBy: { updatedAt: 'desc' },
    });

    // 2. 查询收藏的公共提示词
    const favorites = await this.prisma.promptFavorite.findMany({
      where: { userId: ownerId },
      include: { prompt: true },
      orderBy: { createdAt: 'desc' },
    });

    // 3. 合并,统一格式
    const ownItems = ownPrompts.map((p) => ({
      ...p,
      isPublicImported: false,
      isFavorited: false,
      favoritedAt: undefined,
    }));

    const favItems = favorites.map((f) => ({
      ...f.prompt,
      isPublicImported: true,
      isFavorited: true,
      favoritedAt: f.createdAt,
    }));

    // 4. 按 updatedAt 降序合并排序
    const all = [...ownItems, ...favItems].sort(
      (a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime(),
    );

    // 5. 游标分页(基于合并后数组)
    let startIndex = 0;
    if (cursor) {
      const idx = all.findIndex((item) => item.id === cursor);
      if (idx !== -1) startIndex = idx + 1;
    }
    const paged = all.slice(startIndex, startIndex + take + 1);
    const hasMore = paged.length > take;
    const data = hasMore ? paged.slice(0, take) : paged;
    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? last.id : null;

    return { items: data, nextCursor };
  }

  /**
   * 创建提示词(同步场景可携带 id)。
   * 若提供 imageKeys,会同步创建 PromptImage 记录。
   */
  async create(ownerId: string, dto: CreatePromptDto) {
    const imageKeys = dto.imageKeys ?? [];
    const prompt = await this.prisma.$transaction(async (tx) => {
      // 同步场景会携带本地 id。若该 id 已存在（如上次推送成功但本地 cloudId 丢失），
      // 直接 create 会触发唯一约束冲突，故用 upsert 幂等处理。
      const created = await tx.prompt.upsert({
        where: { id: dto.id ?? '' },
        create: {
          ownerId,
          title: dto.title,
          content: dto.content,
          category: dto.category,
          ...(dto.id ? { id: dto.id } : {}),
          ...(dto.contentEn !== undefined ? { contentEn: dto.contentEn } : {}),
          ...(dto.contentJa !== undefined ? { contentJa: dto.contentJa } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
          ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
          ...(dto.favorite !== undefined ? { favorite: dto.favorite } : {}),
          ...(dto.folderId !== undefined ? { folderId: dto.folderId } : {}),
          ...(dto.source !== undefined ? { source: dto.source } : {}),
          ...(dto.sourceRepo !== undefined ? { sourceRepo: dto.sourceRepo } : {}),
          ...(dto.generationMode !== undefined ? { generationMode: dto.generationMode } : {}),
          imageKeys,
          lastSyncedAt: new Date(),
        },
        update: {
          title: dto.title,
          content: dto.content,
          category: dto.category,
          ...(dto.contentEn !== undefined ? { contentEn: dto.contentEn } : {}),
          ...(dto.contentJa !== undefined ? { contentJa: dto.contentJa } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
          ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
          ...(dto.favorite !== undefined ? { favorite: dto.favorite } : {}),
          ...(dto.folderId !== undefined ? { folderId: dto.folderId } : {}),
          ...(dto.source !== undefined ? { source: dto.source } : {}),
          ...(dto.sourceRepo !== undefined ? { sourceRepo: dto.sourceRepo } : {}),
          ...(dto.generationMode !== undefined ? { generationMode: dto.generationMode } : {}),
          ...(imageKeys.length > 0 ? { imageKeys } : {}),
          version: { increment: 1 },
          lastSyncedAt: new Date(),
        },
      });
      // 参考图采用整体替换，保证与传入的 imageKeys 一致
      if (imageKeys.length > 0) {
        await tx.promptImage.deleteMany({ where: { promptId: created.id } });
        await tx.promptImage.createMany({
          data: imageKeys.map((key, idx) => ({
            promptId: created.id,
            storageKey: key,
            role: 'reference' as const,
            sortOrder: idx,
          })),
        });
      }
      return created;
    });
    this.logsService.log('system', `创建提示词: ${dto.title}`, {
      userId: ownerId,
      meta: { id: prompt.id, category: dto.category, imageCount: imageKeys.length },
    });

    return prompt;
  }

  /**
   * 获取单个提示词(仅限所有者)。
   */
  async findOne(ownerId: string, id: string) {
    const prompt = await this.prisma.prompt.findUnique({ where: { id } });
    if (!prompt || prompt.ownerId !== ownerId) {
      throw notFound(ErrorCode.PROMPT_NOT_FOUND, 'Prompt not found or no access');
    }
    return prompt;
  }

  /**
   * 更新提示词(每次更新自增 version,刷新 lastSyncedAt)。
   * 若提供 imageKeys,会整体替换 PromptImage 记录。
   */
  async update(ownerId: string, id: string, dto: UpdatePromptDto) {
    await this.findOne(ownerId, id);
    const imageKeys = dto.imageKeys;
    const prompt = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.prompt.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.content !== undefined ? { content: dto.content } : {}),
          ...(dto.contentEn !== undefined ? { contentEn: dto.contentEn } : {}),
          ...(dto.contentJa !== undefined ? { contentJa: dto.contentJa } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
          ...(dto.category !== undefined ? { category: dto.category } : {}),
          ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
          ...(dto.source !== undefined ? { source: dto.source } : {}),
          ...(dto.sourceRepo !== undefined ? { sourceRepo: dto.sourceRepo } : {}),
          ...(dto.favorite !== undefined ? { favorite: dto.favorite } : {}),
          ...(dto.folderId !== undefined ? { folderId: dto.folderId } : {}),
          ...(dto.generationMode !== undefined ? { generationMode: dto.generationMode } : {}),
          ...(imageKeys !== undefined ? { imageKeys } : {}),
          version: { increment: 1 },
          lastSyncedAt: new Date(),
        },
      });
      if (imageKeys !== undefined) {
        await tx.promptImage.deleteMany({ where: { promptId: id } });
        if (imageKeys.length > 0) {
          await tx.promptImage.createMany({
            data: imageKeys.map((key, idx) => ({
              promptId: id,
              storageKey: key,
              role: 'reference' as const,
              sortOrder: idx,
            })),
          });
        }
      }
      return updated;
    });
    this.logsService.log('sync', `提示词同步: ${prompt.title}`, {
      userId: ownerId,
      meta: { id, title: dto.title ?? prompt.title, version: prompt.version },
    });

    return prompt;
  }

  /**
   * 删除提示词。
   */
  async remove(ownerId: string, id: string) {
    const prompt = await this.findOne(ownerId, id);
    await this.prisma.prompt.delete({ where: { id } });
    this.logsService.log('system', `删除提示词: ${prompt.title}`, {
      userId: ownerId,
      meta: { id, title: prompt.title, category: prompt.category },
    });

    return { message: '提示词已删除' };
  }
}
