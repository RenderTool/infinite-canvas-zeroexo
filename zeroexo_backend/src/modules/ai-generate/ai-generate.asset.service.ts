import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { badRequest } from '../../common/errors/app-exception.js';
import { MinioService } from '../assets/minio.service';
import { GenerateResult } from './adapters/adapter.interface';
import { GenerateRequestDto } from './dto/generate-request.dto';

/** 文本结果写入 Asset 时的固定 MIME 类型 */
const TEXT_MIME = 'text/plain';
const TEXT_EXT = 'txt';

/**
 * AI 生成结果持久化服务
 *
 * 负责将适配器产出的 GenerateResult 落 Asset：
 * - 文本结果：写 text 字段 + 上传 MinIO
 * - 二进制结果(image/video/audio)：直接落 MinIO
 */
@Injectable()
export class AiGenerateAssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

  /** 将生成结果落 Asset(文本写 text 字段,二进制落 MinIO) */
  async persistResult(
    userId: string,
    result: GenerateResult,
    dto: GenerateRequestDto,
  ) {
    const isTest = dto.isTest ?? false;
    const basePrefix = 'resources/admin/ai-gen';

    if (result.kind === 'text') {
      const text = result.text ?? '';
      const storageKey = `${basePrefix}/${userId}/text/${nanoid()}.${TEXT_EXT}`;
      await this.minio.putBuffer(
        storageKey,
        Buffer.from(text, 'utf-8'),
        `${TEXT_MIME}; charset=utf-8`,
      );
      return this.prisma.asset.create({
        data: {
          ownerId: userId,
          kind: 'text',
          filename: this.makeTextFilename(dto),
          storageKey,
          mimeType: `${TEXT_MIME}; charset=utf-8`,
          size: BigInt(Buffer.byteLength(text, 'utf-8')),
          text,
          tags: [...(dto.tags ?? []), ...(isTest ? ['devtest'] : [])],
          // AI 生成结果统一归入 ai-generation 分类,与用户素材(user)隔离,
          // 避免被前端素材库 /resources?category=user 拉到画布外的资产库
          category: 'ai-generation',
          lastSyncedAt: new Date(),
        },
      });
    }

    const kindMap: Record<string, string> = {
      image: 'images',
      video: 'videos',
      audio: 'audios',
    };
    const assetKind = kindMap[result.kind];
    if (!assetKind) {
      throw badRequest(
        ErrorCode.BAD_REQUEST,
        `Unsupported generation type: ${result.kind}`,
      );
    }
    const ext = result.ext ?? 'bin';

    if (!result.buffer) {
      throw badRequest(
        ErrorCode.BAD_REQUEST,
        'Generation result is missing buffer',
      );
    }
    const storageKey = `${basePrefix}/${userId}/${assetKind}/${nanoid()}.${ext}`;
    const { size } = await this.minio.putBuffer(
      storageKey,
      result.buffer,
      result.mimeType ?? 'application/octet-stream',
    );

    return this.prisma.asset.create({
      data: {
        ownerId: userId,
        kind: result.kind === 'image' ? 'image' : result.kind === 'video' ? 'video' : 'audio',
        filename: this.makeBinaryFilename(dto, ext),
        storageKey,
        mimeType: result.mimeType ?? 'application/octet-stream',
        size: BigInt(size),
        ...(result.width ? { width: result.width } : {}),
        ...(result.height ? { height: result.height } : {}),
        ...(result.duration ? { duration: result.duration } : {}),
        tags: [...(dto.tags ?? []), ...(isTest ? ['devtest'] : [])],
        // AI 生成结果统一归入 ai-generation 分类,与用户素材(user)隔离,
        // 避免被前端素材库 /resources?category=user 拉到画布外的资产库
        category: 'ai-generation',
        lastSyncedAt: new Date(),
      },
    });
  }

  /** 生成文本结果文件名 */
  private makeFilename(dto: GenerateRequestDto, ext: string): string {
    const safePrompt = dto.prompt.slice(0, 12).replace(/[^\w\u4e00-\u9fa5]/g, '_');
    return `${safePrompt || 'ai'}-${Date.now()}.${ext}`;
  }

  private makeTextFilename(dto: GenerateRequestDto): string {
    return this.makeFilename(dto, TEXT_EXT);
  }

  private makeBinaryFilename(dto: GenerateRequestDto, ext: string): string {
    return this.makeFilename(dto, ext);
  }
}
