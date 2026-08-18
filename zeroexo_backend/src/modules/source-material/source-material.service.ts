import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { notFound } from '../../common/errors/app-exception.js';
import { CreateSourceMaterialDto, UpdateSourceMaterialStatusDto } from './dto/source-material.dto';

@Injectable()
export class SourceMaterialService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建源素材记录 - 记录前端上传的原始素材经过资产引擎处理后的关联信息。
   */
  async create(dto: CreateSourceMaterialDto) {
    return this.prisma.sourceMaterial.create({
      data: {
        projectId: dto.projectId,
        userId: dto.userId,
        processedAssetId: dto.processedAssetId,
      },
    });
  }

  /**
   * 按项目 ID 查询源素材列表。
   */
  async findByProject(projectId: string) {
    return this.prisma.sourceMaterial.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 删除源素材记录。
   */
  async delete(id: string): Promise<void> {
    const record = await this.prisma.sourceMaterial.findUnique({ where: { id } });
    if (!record) {
      throw notFound('NOT_FOUND', 'Source material record not found');
    }
    await this.prisma.sourceMaterial.delete({ where: { id } });
  }

  /**
   * 更新处理状态 - 支持更新 processingStatus 和可选的 scriptId。
   */
  async updateStatus(id: string, dto: UpdateSourceMaterialStatusDto) {
    const record = await this.prisma.sourceMaterial.findUnique({ where: { id } });
    if (!record) {
      throw notFound('NOT_FOUND', 'Source material record not found');
    }
    return this.prisma.sourceMaterial.update({
      where: { id },
      data: {
        processingStatus: dto.processingStatus,
        ...(dto.scriptId !== undefined ? { scriptId: dto.scriptId } : {}),
      },
    });
  }
}