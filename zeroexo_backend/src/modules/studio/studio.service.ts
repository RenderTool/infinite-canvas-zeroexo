/**
 * Studio 服务（工业化制片项目，Plan#46）
 *
 * 所有权铁律：所有操作仅能针对 ownerId === currentUser.id 的项目（嵌套资源经关联上溯校验）。
 * 资产卡 = 角色/场景/道具（提示词条目 + 参考素材 + 生成图 + 状态机）。
 * 剧集 = 出片按集管理（拆分稿/过审状态机；平台提示词与成片登记在 Phase 3 扩展）。
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { forbidden, notFound } from '../../common/errors/app-exception.js';
import {
  CreateStudioAssetDto,
  CreateStudioEpisodeDto,
  CreateStudioProjectDto,
  CreateStudioPromptEntryDto,
  RegisterStudioImageDto,
  UpdateStudioAssetDto,
  UpdateStudioEpisodeDto,
  UpdateStudioProjectDto,
  UpdateStudioPromptEntryDto,
} from './dto/studio.dto';

@Injectable()
export class StudioService {
  constructor(private readonly prisma: PrismaService) {}

  // ============ 所有权校验 ============

  private async assertProjectOwner(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.type !== 'studio') throw notFound('STUDIO_PROJECT_NOT_FOUND', '项目不存在');
    if (project.ownerId !== userId) throw forbidden('STUDIO_PROJECT_FORBIDDEN', '无权操作该项目');
    return project;
  }

  private async assertAssetOwner(userId: string, assetId: string) {
    const asset = await this.prisma.studioAsset.findUnique({
      where: { id: assetId },
      include: { project: { select: { ownerId: true, type: true } } },
    });
    if (!asset || asset.project.type !== 'studio') throw notFound('STUDIO_ASSET_NOT_FOUND', '资产不存在');
    if (asset.project.ownerId !== userId) throw forbidden('STUDIO_ASSET_FORBIDDEN', '无权操作该资产');
    return asset;
  }

  private async assertEpisodeOwner(userId: string, episodeId: string) {
    const episode = await this.prisma.studioEpisode.findUnique({
      where: { id: episodeId },
      include: { project: { select: { ownerId: true, type: true } } },
    });
    if (!episode || episode.project.type !== 'studio') throw notFound('STUDIO_EPISODE_NOT_FOUND', '剧集不存在');
    if (episode.project.ownerId !== userId) throw forbidden('STUDIO_EPISODE_FORBIDDEN', '无权操作该剧集');
    return episode;
  }

  private async assertPromptEntryOwner(userId: string, entryId: string) {
    const entry = await this.prisma.studioPromptEntry.findUnique({
      where: { id: entryId },
      include: { asset: { include: { project: { select: { ownerId: true } } } } },
    });
    if (!entry) throw notFound('STUDIO_PROMPT_ENTRY_NOT_FOUND', '提示词条目不存在');
    if (entry.asset.project.ownerId !== userId) throw forbidden('STUDIO_PROMPT_ENTRY_FORBIDDEN', '无权操作该条目');
    return entry;
  }

  private async assertImageOwner(userId: string, imageId: string) {
    const image = await this.prisma.studioGeneratedImage.findUnique({
      where: { id: imageId },
      include: { asset: { include: { project: { select: { ownerId: true } } } } },
    });
    if (!image) throw notFound('STUDIO_IMAGE_NOT_FOUND', '生成图不存在');
    if (image.asset.project.ownerId !== userId) throw forbidden('STUDIO_IMAGE_FORBIDDEN', '无权操作该生成图');
    return image;
  }

  // ============ 项目 ============

  async listProjects(userId: string, keyword?: string) {
    const where: Prisma.ProjectWhereInput = { ownerId: userId, type: 'studio' };
    if (keyword && keyword.trim()) {
      where.title = { contains: keyword.trim(), mode: 'insensitive' };
    }
    const items = await this.prisma.project.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        title: true,
        description: true,
        thumbnailUrl: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { studioAssets: true, studioEpisodes: true } },
      },
    });
    return { items };
  }

  async createProject(userId: string, dto: CreateStudioProjectDto) {
    return this.prisma.project.create({
      data: {
        ownerId: userId,
        title: dto.title,
        description: dto.description,
        type: 'studio',
        lastSyncedAt: new Date(),
      },
    });
  }

  async getProject(userId: string, projectId: string) {
    await this.assertProjectOwner(userId, projectId);
    const [assets, episodes] = await Promise.all([
      this.prisma.studioAsset.findMany({
        where: { projectId },
        orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.studioEpisode.findMany({
        where: { projectId },
        orderBy: { episodeNumber: 'asc' },
      }),
    ]);
    return { assets, episodes };
  }

  async updateProject(userId: string, projectId: string, dto: UpdateStudioProjectDto) {
    await this.assertProjectOwner(userId, projectId);
    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
    });
  }

  async removeProject(userId: string, projectId: string) {
    await this.assertProjectOwner(userId, projectId);
    // StudioAsset/StudioEpisode 经 onDelete: Cascade 级联删除
    await this.prisma.project.delete({ where: { id: projectId } });
    return { ok: true };
  }

  // ============ 资产卡 ============

  async listAssets(userId: string, projectId: string, kind?: string) {
    await this.assertProjectOwner(userId, projectId);
    const items = await this.prisma.studioAsset.findMany({
      where: { projectId, ...(kind ? { kind } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        promptEntries: { orderBy: { createdAt: 'desc' } },
        generatedImages: { orderBy: { createdAt: 'desc' } },
      },
    });
    return { items };
  }

  async createAsset(userId: string, projectId: string, dto: CreateStudioAssetDto) {
    await this.assertProjectOwner(userId, projectId);
    const maxSort = await this.prisma.studioAsset.aggregate({
      where: { projectId, kind: dto.kind },
      _max: { sortOrder: true },
    });
    return this.prisma.studioAsset.create({
      data: {
        projectId,
        kind: dto.kind,
        name: dto.name,
        description: dto.description,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      },
    });
  }

  async updateAsset(userId: string, assetId: string, dto: UpdateStudioAssetDto) {
    await this.assertAssetOwner(userId, assetId);
    return this.prisma.studioAsset.update({
      where: { id: assetId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.mainImageUrl !== undefined ? { mainImageUrl: dto.mainImageUrl } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
  }

  async removeAsset(userId: string, assetId: string) {
    await this.assertAssetOwner(userId, assetId);
    // promptEntries/generatedImages 级联删除
    await this.prisma.studioAsset.delete({ where: { id: assetId } });
    return { ok: true };
  }

  // ============ 提示词条目（含参考素材） ============

  async createPromptEntry(userId: string, assetId: string, dto: CreateStudioPromptEntryDto) {
    await this.assertAssetOwner(userId, assetId);
    return this.prisma.studioPromptEntry.create({
      data: {
        assetId,
        promptText: dto.promptText,
        ...(dto.params !== undefined ? { params: dto.params as Prisma.InputJsonValue } : {}),
        referenceImages: (dto.referenceImages ?? []) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async updatePromptEntry(userId: string, entryId: string, dto: UpdateStudioPromptEntryDto) {
    await this.assertPromptEntryOwner(userId, entryId);
    return this.prisma.studioPromptEntry.update({
      where: { id: entryId },
      data: {
        ...(dto.promptText !== undefined ? { promptText: dto.promptText } : {}),
        ...(dto.params !== undefined ? { params: dto.params as Prisma.InputJsonValue } : {}),
        ...(dto.referenceImages !== undefined
          ? { referenceImages: dto.referenceImages as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  async removePromptEntry(userId: string, entryId: string) {
    await this.assertPromptEntryOwner(userId, entryId);
    await this.prisma.studioPromptEntry.delete({ where: { id: entryId } });
    return { ok: true };
  }

  // ============ 生成图 ============

  async registerImage(userId: string, assetId: string, dto: RegisterStudioImageDto) {
    await this.assertAssetOwner(userId, assetId);
    return this.prisma.studioGeneratedImage.create({
      data: { assetId, url: dto.url, promptEntryId: dto.promptEntryId },
    });
  }

  /** 选中为主图：事务内取消其他选中 + 同步资产主图（一致性基准锁定素材） */
  async selectImage(userId: string, assetId: string, imageId: string) {
    const image = await this.assertImageOwner(userId, imageId);
    if (image.assetId !== assetId) throw notFound('STUDIO_IMAGE_MISMATCH', '生成图不属于该资产');
    await this.prisma.$transaction([
      this.prisma.studioGeneratedImage.updateMany({
        where: { assetId },
        data: { selected: false },
      }),
      this.prisma.studioGeneratedImage.update({
        where: { id: imageId },
        data: { selected: true },
      }),
      this.prisma.studioAsset.update({
        where: { id: assetId },
        data: { mainImageUrl: image.url, status: 'pending_review' },
      }),
    ]);
    return { ok: true };
  }

  async removeImage(userId: string, imageId: string) {
    await this.assertImageOwner(userId, imageId);
    await this.prisma.studioGeneratedImage.delete({ where: { id: imageId } });
    return { ok: true };
  }

  // ============ 剧集（出片按集） ============

  async listEpisodes(userId: string, projectId: string) {
    await this.assertProjectOwner(userId, projectId);
    const items = await this.prisma.studioEpisode.findMany({
      where: { projectId },
      orderBy: { episodeNumber: 'asc' },
    });
    return { items };
  }

  async createEpisode(userId: string, projectId: string, dto: CreateStudioEpisodeDto) {
    await this.assertProjectOwner(userId, projectId);
    let episodeNumber = dto.episodeNumber;
    if (!episodeNumber) {
      const max = await this.prisma.studioEpisode.aggregate({
        where: { projectId },
        _max: { episodeNumber: true },
      });
      episodeNumber = (max._max.episodeNumber ?? 0) + 1;
    }
    return this.prisma.studioEpisode.create({
      data: { projectId, episodeNumber, title: dto.title, sourceRange: dto.sourceRange },
    });
  }

  async updateEpisode(userId: string, episodeId: string, dto: UpdateStudioEpisodeDto) {
    await this.assertEpisodeOwner(userId, episodeId);
    return this.prisma.studioEpisode.update({
      where: { id: episodeId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.sourceRange !== undefined ? { sourceRange: dto.sourceRange } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.splitDraft !== undefined
          ? { splitDraft: dto.splitDraft as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  async removeEpisode(userId: string, episodeId: string) {
    await this.assertEpisodeOwner(userId, episodeId);
    await this.prisma.studioEpisode.delete({ where: { id: episodeId } });
    return { ok: true };
  }
}
