import {
  Controller,
  Get,
  HttpCode,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MinioService } from './minio.service';
import { ImageProcessorService } from './image-processor.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UploadThrottle } from '../../common/throttler/decorators/throttle.decorator';
import { badRequest, forbidden, notFound } from '../../common/errors/app-exception.js';
import { ErrorCode } from '../../common/errors/error-codes';

/** 允许写入的 storageKey 前缀(与 presign 流程生成的路径一致) */
const ALLOWED_WRITE_PREFIXES = ['users/', 'resources/'];
/** 允许匿名读取的公开前缀(白名单),其余路径一律要求 JWT 认证 */
const PUBLIC_READ_PREFIXES = ['resources/public/'];

/**
 * 本地文件存储 HTTP 端点 - 配合 MinioService(本地实现)使用。
 *
 * 路由:
 * - PUT /api/storage/put?key=xxx  客户端直接 PUT 二进制到此 URL
 * - GET  /api/storage/get?key=xxx[&size=thumb|preview]  客户端下载文件
 *
 * 图片变体(sharp 管道):
 *   PUT 接收图片时自动生成 __thumb(48px) 和 __preview(768px) 两个变体,
 *   GET 通过 ?size= 参数返回对应尺寸,实现前端 LOD 渐进式加载。
 *
 * 客户端调用流程(与 MinIO 预签名直传完全一致):
 *   1. POST /api/assets/presign 拿到 uploadUrl 与 storageKey
 *   2. PUT uploadUrl 上传二进制(此 Controller 接收并生成变体)
 *   3. POST /api/assets 创建资产元数据
 *
 * 安全性:
 * - 所有 storageKey 在写入前经 MinioService.resolveFilePath 校验,防止 path traversal
 * - PUT 路由依赖 main.ts 中注册的 express.raw 中间件解析 body 为 Buffer
 */
@Controller('storage')
export class StorageController {
  private readonly logger = new Logger(StorageController.name);

  constructor(
    private readonly minio: MinioService,
    private readonly imageProcessor: ImageProcessorService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /** 客户端 PUT 二进制到此路由,后端写入本地文件 */
  @Put('put')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  @UploadThrottle()
  async put(
    @Query('key') key: string,
    @Req() req: Request,
  ): Promise<void> {
    if (!key) {
      throw badRequest(ErrorCode.STORAGE_KEY_MISSING, 'Missing key parameter');
    }
    const decodedKey = decodeURIComponent(key);
    // 安全校验: 仅允许写入预设前缀下的路径,并拒绝路径穿越
    if (!ALLOWED_WRITE_PREFIXES.some((prefix) => decodedKey.startsWith(prefix))) {
      throw forbidden(
        ErrorCode.STORAGE_AUTH_REQUIRED,
        `Write denied: storageKey must start with ${ALLOWED_WRITE_PREFIXES.join(' or ')}`,
      );
    }
    if (decodedKey.includes('..') || decodedKey.includes('\\') || decodedKey.startsWith('/')) {
      throw badRequest(ErrorCode.BAD_REQUEST, 'Illegal storageKey (path traversal is not allowed)');
    }
    const buffer = this.extractRawBody(req);
    if (buffer.length === 0) {
      throw badRequest(ErrorCode.STORAGE_BODY_EMPTY, 'Request body is empty');
    }
    // 写入原始文件
    await this.minio.putBuffer(decodedKey, buffer, 'application/octet-stream');
    this.logger.log(
      `已上传文件: ${decodedKey} (${buffer.length} bytes)`,
    );

    // 异步生成图片尺寸变体(不阻塞上传返回)
    if (this.imageProcessor.isImageExt(decodedKey)) {
      void this.generateVariants(decodedKey, buffer).catch((err) => {
        this.logger.warn(`图片变体生成失败: ${decodedKey}`, err instanceof Error ? err.message : String(err));
      });
    }
  }

  /**
   * 生成并存储图片的 thumb (48px) 和 preview (768px) 变体
   */
  private async generateVariants(key: string, buffer: Buffer): Promise<void> {
    const variants = await this.imageProcessor.generateAllVariants(buffer);
    for (const [size, variantBuffer] of Object.entries(variants)) {
      const variantKey = this.imageProcessor.variantKey(key, size as 'thumb' | 'preview');
      await this.minio.putBuffer(variantKey, variantBuffer, 'image/jpeg');
      this.logger.log(
        `   ${size}: ${variantKey} (${variantBuffer.length} bytes)`,
      );
    }
  }

  /**
   * 客户端 GET 此路由下载文件(支持 ?size=thumb|preview 参数)
   * 根据文件扩展名返回正确的 Content-Type,避免浏览器 ORB 拦截跨域媒体加载
   *
   * 访问控制(白名单策略):
   * - resources/public/* - 公开访问，无需认证
   * - 其它所有路径(含 resources/front/assets/*) - 需要 JWT 认证
   */
  @Get('get')
  async get(
    @Query('key') key: string,
    @Query('size') size: string = 'full',
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!key) {
      throw badRequest(ErrorCode.STORAGE_KEY_MISSING, 'Missing key parameter');
    }
    const decodedKey = decodeURIComponent(key);

    // 访问控制(白名单策略): 仅显式公开前缀(resources/public/)可匿名读取,
    // 其余路径一律要求 JWT 认证,避免资源/user/* 等私有路径被匿名访问。
    const isPublic = PUBLIC_READ_PREFIXES.some((prefix) => decodedKey.startsWith(prefix));
    if (!isPublic) {
      let token: string | null = null;
      // 优先从 Authorization header 提取 token
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.replace('Bearer ', '');
      } else if (req.query.token) {
        // 兼容方案:从 URL 查询参数提取 token —— 支持 <img>/<video>/<audio> 等标签直接加载
        token = String(req.query.token);
      }
      if (!token) {
        throw forbidden(ErrorCode.STORAGE_AUTH_REQUIRED, 'Authentication required to access private resources');
      }
      try {
        // 密钥已由 jwt.config.ts 集中校验,缺失会导致启动失败,禁止默认密钥兜底
        this.jwtService.verify(token, {
          secret: this.configService.getOrThrow<string>('jwt.secret'),
        });
      } catch {
        throw forbidden(ErrorCode.STORAGE_SESSION_EXPIRED, 'Session expired, please sign in again');
      }
    }

    // 支持 size 参数: thumb / preview / full(或空)
    const resolvedKey =
      size !== 'full' && this.imageProcessor.isImageExt(decodedKey)
        ? this.imageProcessor.variantKey(decodedKey, size as 'thumb' | 'preview')
        : decodedKey;

    const buffer = await this.minio.readFile(resolvedKey);
    if (!buffer) {
      // 如果请求的变体不存在,回退到原始文件
      if (resolvedKey !== decodedKey) {
        const fallback = await this.minio.readFile(decodedKey);
        if (!fallback) {
          throw notFound(ErrorCode.STORAGE_FILE_NOT_FOUND, 'File not found');
        }
        const mimeType = this.getMimeType(decodedKey);
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', fallback.length.toString());
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(fallback);
        return;
      }
      throw notFound(ErrorCode.STORAGE_FILE_NOT_FOUND, 'File not found');
    }
    // 二进制流响应
    const mimeType = this.getMimeType(resolvedKey);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', buffer.length.toString());
    res.setHeader('Cache-Control', 'private, max-age=3600');
    // 跨域支持: 允许前端画布页面加载媒体
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(buffer);
  }

  /** 根据文件扩展名推断 MIME 类型 */
  private getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const mimeMap: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'bmp': 'image/bmp',
      'svg': 'image/svg+xml',
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'ogg': 'video/ogg',
      'mkv': 'video/x-matroska',
      'mov': 'video/quicktime',
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'aac': 'audio/aac',
      'txt': 'text/plain',
      'md': 'text/markdown',
      'html': 'text/html',
      'json': 'application/json',
      'pdf': 'application/pdf',
    };
    return mimeMap[ext] || 'application/octet-stream';
  }

  /** 从 req.body / req 提取原始 Buffer(express.raw 中间件已解析) */
  private extractRawBody(req: Request): Buffer {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (req.body instanceof Uint8Array) return Buffer.from(req.body);
    if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
    if (Array.isArray(req.body)) return Buffer.concat(req.body.map((c) => Buffer.from(c)));
    // 兜底:尝试读 raw body 属性
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    return raw ?? Buffer.alloc(0);
  }
}
