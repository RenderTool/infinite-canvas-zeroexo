import { Injectable } from '@nestjs/common';
import { Prisma, PublicPrompt } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PromptFavoritesService } from '../prompt-favorites/prompt-favorites.service';
import { CreatePublicPromptDto, UpdatePublicPromptDto, ImportPublicPromptDto } from './dto/public-prompt.dto';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 1000;

@Injectable()
export class PublicPromptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promptFavoritesService: PromptFavoritesService,
  ) {}

  /** 分页查询公共提示词(offset 分页),支持 category 过滤和 keyword 模糊搜索,返回 total。
   *  order=random 且携带 seed 时按 md5(id + seed) 稳定随机排序(同一 seed 分页不重复) */
  async list(page?: number, limit?: number, category?: string, keyword?: string, userId?: string, order?: string, seed?: string) {
    const take = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const skip = ((page ?? 1) - 1) * take;
    const where: Record<string, unknown> = {};
    if (category && category.trim()) {
      const cat = category.trim();
      // 业务分类收敛(用户拍板):style/shot 并入 other
      where.category = cat === 'other' ? { in: ['other', 'style', 'shot'] } : cat;
    }
    if (keyword && keyword.trim()) {
      where.title = { contains: keyword.trim(), mode: 'insensitive' };
    }

    let items: PublicPrompt[];
    let total: number;
    if (order === 'random' && seed) {
      // 种子随机: md5(id + seed) 稳定打乱,同 seed 翻页不重复;where 条件用参数化 SQL 防注入
      const conditions: Prisma.Sql[] = [];
      if (category && category.trim()) {
        const cat = category.trim();
        // 业务分类收敛(用户拍板):style/shot 并入 other
        conditions.push(
          cat === 'other'
            ? Prisma.sql`"category" IN (${Prisma.join(['other', 'style', 'shot'])})`
            : Prisma.sql`"category" = ${cat}`,
        );
      }
      if (keyword && keyword.trim()) {
        conditions.push(Prisma.sql`"title" ILIKE ${'%' + keyword.trim() + '%'}`);
      }
      const whereSql =
        conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
      [items, total] = await Promise.all([
        this.prisma.$queryRaw<PublicPrompt[]>(
          Prisma.sql`SELECT * FROM "PublicPrompt" ${whereSql} ORDER BY md5("id"::text || ${seed}) LIMIT ${take} OFFSET ${skip}`,
        ),
        this.prisma.publicPrompt.count({ where }),
      ]);
    } else {
      [items, total] = await Promise.all([
        this.prisma.publicPrompt.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          skip,
          take,
        }),
        this.prisma.publicPrompt.count({ where }),
      ]);
    }

    // 如果用户已登录,批量查询收藏状态
    let favoritedSet = new Set<string>();
    if (userId) {
      const map = await this.promptFavoritesService.batchIsFavorited(
        userId,
        items.map((i) => i.id),
      );
      for (const [id, val] of map) {
        if (val) favoritedSet.add(id);
      }
    }

    const itemsWithFav = items.map((item) => ({
      ...item,
      isFavorited: favoritedSet.has(item.id),
    }));

    return { items: itemsWithFav, total, page: page ?? 1, limit: take };
  }

  /** 获取各分类的提示词数量统计 */
  async getCategoryCounts() {
    const rows = await this.prisma.publicPrompt.groupBy({
      by: ['category'],
      _count: { id: true },
    });
    const counts: Record<string, number> = { all: 0 };
    for (const row of rows) {
      counts[row.category] = row._count.id;
      counts.all += row._count.id;
    }
    // 业务分类收敛(用户拍板):style/shot 并入 other
    const mergedOther = (counts.other ?? 0) + (counts.style ?? 0) + (counts.shot ?? 0);
    delete counts.style;
    delete counts.shot;
    if (mergedOther > 0) counts.other = mergedOther;
    return counts;
  }

  /** 获取单个公共提示词 */
  async findOne(id: string, userId?: string) {
    const prompt = await this.prisma.publicPrompt.findUniqueOrThrow({ where: { id } });
    let isFavorited = false;
    if (userId) {
      isFavorited = await this.promptFavoritesService.isFavorited(userId, id);
    }
    return { ...prompt, isFavorited };
  }

  /** 创建公共提示词 */
  async create(dto: CreatePublicPromptDto) {
    return this.prisma.publicPrompt.create({
      data: {
        title: dto.title,
        content: dto.content,
        category: dto.category,
        ...(dto.tags ? { tags: dto.tags } : {}),
        ...(dto.source ? { source: dto.source } : {}),
        ...(dto.sourceId ? { sourceId: dto.sourceId } : {}),
        ...(dto.clusterName ? { clusterName: dto.clusterName } : {}),
        ...(dto.images ? { images: dto.images } : {}),
        ...(dto.demoTitles ? { demoTitles: dto.demoTitles } : {}),
        ...(dto.sourceName ? { sourceName: dto.sourceName } : {}),
        ...(dto.sourceUrl ? { sourceUrl: dto.sourceUrl } : {}),
        ...(dto.license ? { license: dto.license } : {}),
      },
    });
  }

  /** 更新公共提示词 */
  async update(id: string, dto: UpdatePublicPromptDto) {
    return this.prisma.publicPrompt.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.content !== undefined ? { content: dto.content } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
        ...(dto.source !== undefined ? { source: dto.source } : {}),
        ...(dto.images !== undefined ? { images: dto.images } : {}),
        ...(dto.demoTitles !== undefined ? { demoTitles: dto.demoTitles } : {}),
        ...(dto.sourceName !== undefined ? { sourceName: dto.sourceName } : {}),
        ...(dto.sourceUrl !== undefined ? { sourceUrl: dto.sourceUrl } : {}),
        ...(dto.license !== undefined ? { license: dto.license } : {}),
      },
    });
  }

  /** 删除公共提示词 */
  async remove(id: string) {
    await this.prisma.publicPrompt.delete({ where: { id } });
    return { message: '公共提示词已删除' };
  }

  /** 批量删除公共提示词 */
  async batchRemove(ids: string[]) {
    const result = await this.prisma.publicPrompt.deleteMany({
      where: { id: { in: ids } },
    });
    return { deletedCount: result.count };
  }

  /** 清空全部公共提示词 */
  async clearAll() {
    const result = await this.prisma.publicPrompt.deleteMany({});
    return { deletedCount: result.count };
  }

  /** 批量导入公共提示词 */
  async batchImport(dto: ImportPublicPromptDto) {
    const created = await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.publicPrompt.create({
          data: {
            title: item.title,
            content: item.content,
            category: item.category,
            tags: item.tags ?? [],
            source: item.source ?? 'image-prompt-library',
            sourceId: item.sourceId ?? null,
            clusterName: item.clusterName ?? null,
            images: item.images ?? [],
            demoTitles: item.demoTitles ?? {},
            sourceName: item.sourceName ?? null,
            sourceUrl: item.sourceUrl ?? null,
            license: item.license ?? null,
          },
        }),
      ),
    );
    return { imported: created.length, items: created };
  }
}