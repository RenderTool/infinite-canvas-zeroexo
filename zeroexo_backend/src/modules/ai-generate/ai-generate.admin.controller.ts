import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { notFound } from '../../common/errors/app-exception.js';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/ai/generations')
export class AiGenerateAdminController {
  constructor(private readonly prisma: PrismaService) {}

  /** 查看指定用户的 AI 生成记录列表（分页） */
  @Get('user/:userId')
  @HttpCode(HttpStatus.OK)
  async listUserGenerations(
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const take = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.aiGeneration.findMany({
        where: { ownerId: userId },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        select: {
          id: true,
          kind: true,
          prompt: true,
          model: true,
          providerName: true,
          status: true,
          resultAssetId: true,
          createdAt: true,
        },
      }),
      this.prisma.aiGeneration.count({ where: { ownerId: userId } }),
    ]);

    // 批量获取 resultAssetId 对应的 storageKey
    const assetIds = items.filter(i => i.resultAssetId).map(i => i.resultAssetId!);
    const assets = assetIds.length > 0
      ? await this.prisma.asset.findMany({
          where: { id: { in: assetIds } },
          select: { id: true, storageKey: true },
        })
      : [];
    const assetMap = new Map(assets.map(a => [a.id, a.storageKey]));

    const enrichedItems = items.map(i => ({
      ...i,
      storageKey: i.resultAssetId ? (assetMap.get(i.resultAssetId) || null) : null,
    }));

    return { items: enrichedItems, total, page: Math.max(Number(page) || 1, 1), pageSize: take };
  }

  /** 根据结果资源 ID 获取完整的 AI 生成元数据 */
  @Get('by-asset/:assetId')
  @HttpCode(HttpStatus.OK)
  async getGenerationByAsset(@Param('assetId') assetId: string) {
    const gen = await this.prisma.aiGeneration.findFirst({
      where: { resultAssetId: assetId },
    });
    if (!gen) throw notFound(ErrorCode.AI_GENERATION_NOT_FOUND, 'Associated generation record not found');
    return gen;
  }

  /** 删除单条生成记录 */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteGeneration(@Param('id') id: string) {
    try {
      await this.prisma.aiGeneration.delete({ where: { id } });
      return { success: true };
    } catch {
      throw new Error('生成记录不存在');
    }
  }

  /** 批量删除生成记录（仅删除记录，不删除关联素材） */
  @Post('batch-delete')
  @HttpCode(HttpStatus.OK)
  async batchDeleteGenerations(@Body() body: { ids: string[] }) {
    if (!body.ids || body.ids.length === 0) {
      throw new Error('ids 不能为空');
    }
    const { count } = await this.prisma.aiGeneration.deleteMany({
      where: { id: { in: body.ids } },
    });
    return { deletedCount: count };
  }

  /** 清空指定用户的全部生成记录（仅删除记录，不删除关联素材） */
  @Post('user/:userId/clear')
  @HttpCode(HttpStatus.OK)
  async clearUserGenerations(@Param('userId') userId: string) {
    const { count } = await this.prisma.aiGeneration.deleteMany({
      where: { ownerId: userId },
    });
    return { deletedCount: count };
  }
}
