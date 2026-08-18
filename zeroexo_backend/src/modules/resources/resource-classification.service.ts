import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { notFound } from '../../common/errors/app-exception.js';
import { ErrorCode } from '../../common/errors/error-codes';
import { RESOURCE_CLASSIFICATION_CONFIG, ResourceCategory } from '../../config/resource-classification.config';

/**
 * 统一查询引擎 — 由配置驱动，消除所有硬编码查询逻辑。
 *
 * 核心职责：
 * 1. 根据配置中的 category key 路由到对应数据源（asset / project / ai-generation / prompt）
 * 2. 动态构造 where 条件（storageKey 前缀、category、filter 参数）
 * 3. 对结果执行配置中声明的 transform（source 标记、项目合并等）
 */
@Injectable()
export class ResourceClassificationService {
  private config = RESOURCE_CLASSIFICATION_CONFIG;

  constructor(private readonly prisma: PrismaService) {}

  /** 获取完整分类配置 */
  getConfig() {
    return this.config;
  }

  /** 根据分类标识执行查询 */
  async queryByCategory(
    userId: string,
    categoryKey: string,
    filters: Record<string, string | undefined>,
    page: number,
    pageSize: number,
  ) {
    const cat = this.config.categories.find((c) => c.key === categoryKey);
    if (!cat) throw notFound(ErrorCode.RESOURCE_NOT_FOUND, `Unknown resource category: ${categoryKey}`);

    const take = Math.min(Math.max(pageSize || 20, 1), 100);
    const skip = (Math.max(page || 1, 1) - 1) * take;

    switch (cat.query.source) {
      case 'asset':
        return this.queryAssets(userId, cat, filters, skip, take);
      case 'project':
        return this.queryProjects(userId, cat, filters, skip, take);
      case 'ai-generation':
        return this.queryAiGenerations(userId, cat, filters, skip, take);
      case 'prompt':
        return this.queryPrompts(userId, cat, filters, skip, take);
      default:
        throw notFound('NOT_FOUND', `Unsupported data source: ${cat.query.source}`);
    }
  }

  // ==================== Asset 查询 ====================

  private async queryAssets(
    userId: string,
    cat: ResourceCategory,
    filters: Record<string, string | undefined>,
    skip: number,
    take: number,
  ) {
    const where = this.buildAssetWhere(userId, cat, filters);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          kind: true,
          filename: true,
          storageKey: true,
          mimeType: true,
          size: true,
          width: true,
          height: true,
          duration: true,
          tags: true,
          createdAt: true,
        },
      }),
      this.prisma.asset.count({ where }),
    ]);

    // 后处理
    const enriched = this.applyTransform(items, cat);

    return { items: enriched, total, page: skip / take + 1, pageSize: take };
  }

  private buildAssetWhere(
    userId: string,
    cat: ResourceCategory,
    filters: Record<string, string | undefined>,
  ) {
    const where: Record<string, unknown> = { ownerId: userId };

    // storageKey 前缀筛选
    if (cat.query.storagePrefix) {
      where.storageKey = { startsWith: cat.query.storagePrefix };
    }

    // category 字段（仅在非 ignoreCategory 时加入）
    if (!cat.query.ignoreCategory && cat.query.where?.category) {
      where.category = cat.query.where.category;
    }

    // 动态 filter：kind / 其他 asset 字段
    for (const [key, value] of Object.entries(filters)) {
      if (value) {
        where[key] = value;
      }
    }

    return where;
  }

  // ==================== Project 查询 ====================

  private async queryProjects(
    userId: string,
    _cat: ResourceCategory,
    filters: Record<string, string | undefined>,
    skip: number,
    take: number,
  ) {
    const typeFilter = filters['type'] || '';

    // 并行查两个表，各取 take 条（避免单表取太少导致前端缺页）
    const extraTake = Math.min(take * 3, 100);

    const canvasProjects = await this.prisma.project.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: 'desc' },
      take: extraTake,
      skip: 0,
      select: {
        id: true,
        title: true,
        version: true,
        tags: true,
        isPublic: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // 合并 + 标记类型 + 排序
    let allItems: Record<string, unknown>[] = [
      ...canvasProjects.map((p) => ({
        ...p,
        type: 'canvas' as const,
        statusOrVersion: `v${p.version}`,
      })),
    ];

    // 按 type 筛选
    if (typeFilter) {
      allItems = allItems.filter((item) => item.type === typeFilter);
    }

    // 按 updatedAt 降序排列
    allItems.sort(
      (a, b) =>
        new Date(b.updatedAt as Date).getTime() -
        new Date(a.updatedAt as Date).getTime(),
    );

    const total = allItems.length;
    const items = allItems.slice(skip, skip + take);

    return { items, total, page: skip / take + 1, pageSize: take };
  }

  // ==================== AiGeneration 查询 ====================

  private async queryAiGenerations(
    userId: string,
    cat: ResourceCategory,
    filters: Record<string, string | undefined>,
    skip: number,
    take: number,
  ) {
    const where: Record<string, unknown> = { ownerId: userId };

    // 额外的固定 where 条件（如 prompt 分类的 { status: 'success' }）
    if (cat.query.where) {
      Object.assign(where, cat.query.where);
    }

    // 动态 filter
    for (const [key, value] of Object.entries(filters)) {
      if (value) where[key] = value;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.aiGeneration.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          kind: true,
          prompt: true,
          model: true,
          status: true,
          costTokens: true,
          resultAssetId: true,
          createdAt: true,
        },
      }),
      this.prisma.aiGeneration.count({ where }),
    ]);

    return { items, total, page: skip / take + 1, pageSize: take };
  }

  // ==================== Prompt 查询 ====================

  private async queryPrompts(
    userId: string,
    cat: ResourceCategory,
    filters: Record<string, string | undefined>,
    skip: number,
    take: number,
  ) {
    const where: Record<string, unknown> = { ownerId: userId };

    if (cat.query.where) {
      Object.assign(where, cat.query.where);
    }

    for (const [key, value] of Object.entries(filters)) {
      if (value) where[key] = value;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.prompt.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          title: true,
          content: true,
          category: true,
          tags: true,
          source: true,
          sourceRepo: true,
          favorite: true,
          imageKeys: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.prompt.count({ where }),
    ]);

    return { items, total, page: skip / take + 1, pageSize: take };
  }

  // ==================== 后处理 ====================

  private applyTransform(items: Record<string, unknown>[], cat: ResourceCategory) {
    if (!cat.transform) return items;

    let result = [...items];

    // 来源标记
    if (cat.transform.computeSource && cat.transform.sourceMap) {
      const defaultSource = cat.transform.defaultSource || '未知';
      result = result.map((item) => {
        const tags = item.tags as string[] | undefined;
        const matchedTag = tags?.find((t) => cat.transform!.sourceMap![t]);
        return {
          ...item,
          source: matchedTag ? cat.transform!.sourceMap![matchedTag] : defaultSource,
        };
      });
    }

    return result;
  }
}
