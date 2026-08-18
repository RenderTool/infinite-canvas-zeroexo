/**
 * BrandingAdminController - 管理员品牌配置接口
 *
 * GET    /api/admin/branding           → 获取完整配置(管理员)
 * PUT    /api/admin/branding           → 更新配置(管理员)
 * POST   /api/admin/branding/upload   → 上传品牌素材(视频/图片)
 * DELETE /api/admin/branding/file     → 删除已上传的品牌文件
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { BrandingService, type BrandingConfig } from './branding.service';
import { MinioService } from '../assets/minio.service';
import { badRequest } from '../../common/errors/app-exception.js';
import { createHash } from 'node:crypto';

const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/x-matroska', 'video/quicktime'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.mkv', '.mov'];
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/bmp'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.bmp'];
const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500 MB
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;  // 20 MB

@ApiTags('Admin Branding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/branding')
export class BrandingAdminController {
  private readonly logger = new Logger(BrandingAdminController.name);

  constructor(
    private readonly brandingService: BrandingService,
    private readonly minioService: MinioService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '管理员获取品牌配置' })
  async getBranding() {
    return this.brandingService.getConfig();
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '管理员更新品牌配置' })
  async updateBranding(@Body() body: Partial<BrandingConfig>) {
    return this.brandingService.updateConfig(body);
  }

  /**
   * 上传品牌素材(视频或图片)
   * 通过 ?category= 指定存储子目录:hero(视频) / fallback(回退图片)
   * 通过 ?type= 指定类型:video(视频) / image(图片) / auto(自动识别,默认)
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: MAX_VIDEO_SIZE },
    fileFilter: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, acceptFile: boolean) => void) => {
      const ext = '.' + file.originalname.split('.').pop()?.toLowerCase();
      const isVideo = VIDEO_MIME_TYPES.includes(file.mimetype) || VIDEO_EXTENSIONS.includes(ext);
      const isImage = IMAGE_MIME_TYPES.includes(file.mimetype) || IMAGE_EXTENSIONS.includes(ext);

      if (isVideo || isImage) {
        cb(null, true);
      } else {
        cb(badRequest('BAD_REQUEST', 'Unsupported format. Video: mp4/webm/ogg/mkv/mov. Image: jpg/png/webp/gif/svg'), false);
      }
    },
  }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传品牌素材(视频/图片)' })
  async uploadAsset(
    @UploadedFile() file: Express.Multer.File,
    @Query() query: { category?: string; type?: string },
    @Req() req: Request,
  ) {
    if (!file || file.size === 0) {
      throw badRequest('BAD_REQUEST', 'File is empty');
    }

    const ext = '.' + file.originalname.split('.').pop()?.toLowerCase();
    const isVideo = VIDEO_MIME_TYPES.includes(file.mimetype) || VIDEO_EXTENSIONS.includes(ext);
    const isImage = IMAGE_MIME_TYPES.includes(file.mimetype) || IMAGE_EXTENSIONS.includes(ext);

    // 根据类型检查大小限制
    if (isVideo && file.size > MAX_VIDEO_SIZE) {
      throw badRequest('BAD_REQUEST', `Video file too large, max ${Math.round(MAX_VIDEO_SIZE / 1024 / 1024)}MB supported`);
    }
    if (isImage && file.size > MAX_IMAGE_SIZE) {
      throw badRequest('BAD_REQUEST', `Image file too large, max ${Math.round(MAX_IMAGE_SIZE / 1024 / 1024)}MB supported`);
    }

    // CAS 去重: 计算 SHA-256 哈希,用哈希作为文件名
    const category = query.category || (isVideo ? 'hero' : 'images');
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    const storageKey = `resources/public/branding/${category}/${hash}${ext}`;

    // 检查是否已存在相同内容的文件
    const existing = await this.minioService.readFile(storageKey);
    if (existing) {
      this.logger.log(`CAS 命中,复用已有文件: ${storageKey}`);
    } else {
      await this.minioService.putBuffer(storageKey, file.buffer, file.mimetype || 'application/octet-stream');
      this.logger.log(`品牌素材已上传(CAS): ${storageKey} (${file.size} bytes, ${isVideo ? 'video' : 'image'})`);
    }

    const baseUrl = this.getBaseUrl(req);
    const publicUrl = `${baseUrl}/api/storage/get?key=${encodeURIComponent(storageKey)}`;

    return {
      url: publicUrl,
      storageKey,
      originalName: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      type: isVideo ? 'video' : 'image',
    };
  }

  /** 删除已上传的品牌文件 */
  @Delete('file')
  @ApiOperation({ summary: '删除品牌配置中使用的文件' })
  async deleteFile(@Query('key') key: string) {
    if (!key || !key.startsWith('resources/public/branding/')) {
      throw badRequest('BAD_REQUEST', 'Invalid file key');
    }
    try {
      await this.minioService.removeObject(key);
      this.logger.log(`品牌文件已删除: ${key}`);
    } catch {
      // 文件不存在时静默处理
    }
    return { success: true };
  }

  /** 获取请求的 base URL,用于拼接文件访问 URL */
  private getBaseUrl(req: Request): string {
    const protocol = req.protocol || 'http';
    const host = req.get('host') || 'localhost:3000';
    return `${protocol}://${host}`;
  }
}