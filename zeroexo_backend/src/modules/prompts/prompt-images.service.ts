import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { notFound } from '../../common/errors/app-exception.js';
import { LogsService } from '../logs/logs.service';
import { AddPromptImageDto, SetPromptImagesDto } from './dto/prompt-image.dto';

/**
 * 提示词图片服务 - 一个提示词可关联多张参考图(从资产库选择)
 * 数据存于 PromptImage 表;Prompt.imageKeys 字段为冗余快照,便于列表展示
 */
@Injectable()
export class PromptImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logsService: LogsService,
  ) {}

  private async assertOwner(ownerId: string, promptId: string): Promise<void> {
    const prompt = await this.prisma.prompt.findUnique({ where: { id: promptId } });
    if (!prompt || prompt.ownerId !== ownerId) {
      throw notFound(ErrorCode.PROMPT_NOT_FOUND, 'Prompt not found or no access');
    }
  }

  /** 获取提示词所有图片 */
  async list(ownerId: string, promptId: string) {
    await this.assertOwner(ownerId, promptId);
    return this.prisma.promptImage.findMany({
      where: { promptId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** 添加一张图片 */
  async add(ownerId: string, promptId: string, dto: AddPromptImageDto) {
    await this.assertOwner(ownerId, promptId);
    const img = await this.prisma.promptImage.create({
      data: {
        promptId,
        storageKey: dto.storageKey,
        role: dto.role ?? 'reference',
        isCover: dto.isCover ?? false,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    // 同步 Prompt.imageKeys 快照
    await this.syncImageKeysSnapshot(promptId);
    this.logsService.log('system', `添加提示词图片`, {
      userId: ownerId,
      meta: { promptId, storageKey: dto.storageKey, role: dto.role ?? 'reference', isCover: dto.isCover },
    });
    return img;
  }

  /** 删除一张图片 */
  async remove(ownerId: string, promptId: string, imageId: string) {
    await this.assertOwner(ownerId, promptId);
    const img = await this.prisma.promptImage.findUnique({ where: { id: imageId } });
    if (!img || img.promptId !== promptId) {
      throw notFound(ErrorCode.NOT_FOUND, 'Prompt image not found');
    }
    await this.prisma.promptImage.delete({ where: { id: imageId } });
    await this.syncImageKeysSnapshot(promptId);
    this.logsService.log('system', `删除提示词图片`, {
      userId: ownerId,
      meta: { promptId, imageId },
    });
    return { message: '已删除' };
  }

  /** 覆盖式批量设置(用于 update 时的整体替换) */
  async setAll(ownerId: string, promptId: string, dto: SetPromptImagesDto) {
    await this.assertOwner(ownerId, promptId);
    await this.prisma.$transaction(async (tx) => {
      await tx.promptImage.deleteMany({ where: { promptId } });
      if (dto.images.length > 0) {
        await tx.promptImage.createMany({
          data: dto.images.map((img, idx) => ({
            promptId,
            storageKey: img.storageKey,
            role: img.role ?? 'reference',
            isCover: img.isCover ?? false,
            sortOrder: img.sortOrder ?? idx,
          })),
        });
      }
    });
    await this.syncImageKeysSnapshot(promptId);
    return this.list(ownerId, promptId);
  }

  /** 同步 Prompt.imageKeys 冗余字段(便于列表展示) */
  private async syncImageKeysSnapshot(promptId: string): Promise<void> {
    const images = await this.prisma.promptImage.findMany({
      where: { promptId },
      orderBy: { sortOrder: 'asc' },
      select: { storageKey: true },
    });
    await this.prisma.prompt.update({
      where: { id: promptId },
      data: { imageKeys: images.map((i) => i.storageKey) },
    });
  }
}
