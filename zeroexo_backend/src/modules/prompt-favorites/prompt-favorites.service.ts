import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { notFound } from '../../common/errors/app-exception.js';

@Injectable()
export class PromptFavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  /** 收藏公共提示词 */
  async favorite(userId: string, promptId: string) {
    // 检查公共提示词是否存在
    const prompt = await this.prisma.publicPrompt.findUnique({ where: { id: promptId } });
    if (!prompt) throw notFound(ErrorCode.PROMPT_NOT_FOUND, 'Public prompt not found');

    // 已存在则忽略（幂等）
    const existing = await this.prisma.promptFavorite.findUnique({
      where: { userId_promptId: { userId, promptId } },
    });
    if (existing) return { message: 'already favorited' };

    await this.prisma.promptFavorite.create({
      data: { userId, promptId },
    });
    return { message: 'favorited' };
  }

  /** 取消收藏 */
  async unfavorite(userId: string, promptId: string) {
    try {
      await this.prisma.promptFavorite.delete({
        where: { userId_promptId: { userId, promptId } },
      });
    } catch {
      throw notFound(ErrorCode.PROMPT_FAVORITE_NOT_FOUND, 'Prompt not favorited');
    }
    return { message: 'unfavorited' };
  }

  /** 获取用户收藏列表（返回公共提示词完整数据 + isPublicImported: true） */
  async listFavorites(userId: string) {
    const favorites = await this.prisma.promptFavorite.findMany({
      where: { userId },
      include: { prompt: true },
      orderBy: { createdAt: 'desc' },
    });

    return favorites.map((f) => ({
      ...f.prompt,
      isPublicImported: true,
      isFavorited: true,
      favoritedAt: f.createdAt,
    }));
  }

  /** 检查用户是否收藏了指定提示词 */
  async isFavorited(userId: string, promptId: string): Promise<boolean> {
    const count = await this.prisma.promptFavorite.count({
      where: { userId, promptId },
    });
    return count > 0;
  }

  /** 批量检查用户是否收藏了多个提示词 */
  async batchIsFavorited(userId: string, promptIds: string[]): Promise<Map<string, boolean>> {
    const favorites = await this.prisma.promptFavorite.findMany({
      where: { userId, promptId: { in: promptIds } },
    });
    const map = new Map<string, boolean>();
    for (const id of promptIds) map.set(id, false);
    for (const f of favorites) map.set(f.promptId, true);
    return map;
  }
}