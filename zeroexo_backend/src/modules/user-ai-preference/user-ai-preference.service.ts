import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { notFound } from '../../common/errors/app-exception.js';
import { UpdateUserAiPreferenceDto } from './dto/update-preference.dto';

/**
 * 用户级 AI 配置服务
 * - 懒加载首次访问自动创建默认配置
 * - 更新时按 DTO 字段局部更新
 */
@Injectable()
export class UserAiPreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取当前用户的 AI 配置
   * 若不存在则自动创建默认值
   */
  async get(userId: string) {
    let pref = await this.prisma.userAiPreference.findUnique({
      where: { userId },
    });
    if (!pref) {
      pref = await this.prisma.userAiPreference.create({
        data: { userId },
      });
    }
    return pref;
  }

  /**
   * 更新当前用户的 AI 配置
   * - DTO 字段为可选,只更新传入的字段
   * - capabilityDefaults 整体覆盖
   */
  async update(userId: string, dto: UpdateUserAiPreferenceDto) {
    const existing = await this.get(userId);

    const data: Prisma.UserAiPreferenceUpdateInput = {};
    if (dto.analysisModel !== undefined) data.analysisModel = dto.analysisModel;
    if (dto.characterModel !== undefined) data.characterModel = dto.characterModel;
    if (dto.locationModel !== undefined) data.locationModel = dto.locationModel;
    if (dto.videoModel !== undefined) data.videoModel = dto.videoModel;
    if (dto.audioModel !== undefined) data.audioModel = dto.audioModel;
    if (dto.analysisConcurrency !== undefined) data.analysisConcurrency = dto.analysisConcurrency;
    if (dto.imageConcurrency !== undefined) data.imageConcurrency = dto.imageConcurrency;
    if (dto.videoConcurrency !== undefined) data.videoConcurrency = dto.videoConcurrency;
    if (dto.capabilityDefaults !== undefined) {
      data.capabilityDefaults = dto.capabilityDefaults as Prisma.InputJsonValue;
    }

    return this.prisma.userAiPreference.update({
      where: { id: existing.id },
      data,
    });
  }

  /**
   * 重置为默认值
   */
  async reset(userId: string) {
    const existing = await this.prisma.userAiPreference.findUnique({ where: { userId } });
    if (!existing) {
      throw notFound('NOT_FOUND', 'User preference not found');
    }
    return this.prisma.userAiPreference.update({
      where: { id: existing.id },
      data: {
        analysisModel: null,
        characterModel: null,
        locationModel: null,
        videoModel: null,
        audioModel: null,
        analysisConcurrency: 3,
        imageConcurrency: 2,
        videoConcurrency: 1,
        capabilityDefaults: {},
      },
    });
  }
}
