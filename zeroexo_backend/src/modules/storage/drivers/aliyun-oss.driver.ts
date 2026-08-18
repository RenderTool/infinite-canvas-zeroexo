/**
 * AliyunOssDriver - 阿里云 OSS / OBS(对象存储)驱动
 *
 * 适用:
 * - 阿里云 OSS(主)
 * - 华为云 OBS(S3 协议,通过 S3CompatibleDriver 适配)
 * - 其它兼容阿里云 OSS SDK 的存储(如金山云 KS3、青云 QingStor 通过兼容模式)
 *
 * 配置:
 * {
 *   driver: 'oss',
 *   options: {
 *     region: 'oss-cn-hangzhou',
 *     bucket: 'zeroexo-assets',
 *     accessKeyId: 'LTAI...',
 *     accessKeySecret: 'xxx',
 *     endpoint: 'oss-cn-hangzhou.aliyuncs.com',  // 可选,默认 oss-{region}.aliyuncs.com
 *     internal: false,                            // 是否内网
 *     cdnDomain: 'https://cdn.example.com',       // 可选 CDN 加速
 *     secure: true                                // HTTPS
 *   }
 * }
 *
 * 依赖:
 * - 需要安装 ali-oss SDK: pnpm add ali-oss
 * - 若 SDK 未安装,本类在加载时抛出友好错误
 */

import { Logger } from '@nestjs/common';
import type {
  DriverHealth,
  IStorageDriver,
  PutBufferResult,
  StorageObject,
} from '../storage-driver.interface';

/** 延迟加载 ali-oss - 避免未安装 SDK 时启动失败 */
let _ossClientCtor: any = null;
function loadOssClient(): any {
  if (_ossClientCtor) return _ossClientCtor;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('ali-oss');
    _ossClientCtor = mod.default || mod;
    return _ossClientCtor;
  } catch (err) {
    throw new Error(
      'ali-oss SDK 未安装,请执行: pnpm add ali-oss\n' +
        '或切换到 s3 driver(S3 兼容模式,无需额外 SDK)',
    );
  }
}

export class AliyunOssDriver implements IStorageDriver {
  readonly name = 'oss' as const;
  private readonly logger = new Logger(AliyunOssDriver.name);
  private client!: any;
  private readonly options: Record<string, any>;

  constructor(options: Record<string, any>) {
    this.options = options;
  }

  async init(): Promise<void> {
    const OSS = loadOssClient();
    if (
      !this.options.bucket ||
      !this.options.accessKeyId ||
      !this.options.accessKeySecret ||
      !this.options.region
    ) {
      throw new Error('OSS driver: 缺少 region/bucket/accessKeyId/accessKeySecret');
    }
    const endpoint =
      this.options.endpoint ||
      (this.options.internal
        ? `oss-${this.options.region}-internal.aliyuncs.com`
        : `oss-${this.options.region}.aliyuncs.com`);
    this.client = new OSS({
      region: this.options.region,
      endpoint,
      bucket: this.options.bucket,
      accessKeyId: this.options.accessKeyId,
      accessKeySecret: this.options.accessKeySecret,
      secure: this.options.secure ?? true,
    });

    // 探测 bucket 可达性
    try {
      await this.client.getBucketInfo(this.options.bucket);
      this.logger.log(`阿里云 OSS driver 已就绪,endpoint: ${endpoint}`);
    } catch (err) {
      this.logger.error(`OSS driver 初始化失败: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  async validateConfig(): Promise<string | null> {
    if (!this.options.region) return '缺少 region';
    if (!this.options.bucket) return '缺少 bucket';
    if (!this.options.accessKeyId) return '缺少 accessKeyId';
    if (!this.options.accessKeySecret) return '缺少 accessKeySecret';
    return null;
  }

  async presignPut(key: string, contentType?: string, expirySeconds = 3600): Promise<string> {
    const url = this.client.signatureUrl(key, {
      method: 'PUT',
      expires: expirySeconds,
      'Content-Type': contentType,
    });
    return this.maybeCdn(url);
  }

  async presignGet(key: string, expirySeconds = 3600): Promise<string> {
    const url = this.client.signatureUrl(key, { expires: expirySeconds });
    return this.maybeCdn(url);
  }

  /** CDN 域名替换(若配置) */
  private maybeCdn(url: string): string {
    if (!this.options.cdnDomain) return url;
    try {
      const u = new URL(url);
      const cdn = new URL(this.options.cdnDomain);
      return `${cdn.protocol}//${cdn.host}${u.pathname}${u.search}`;
    } catch {
      return url;
    }
  }

  async putBuffer(key: string, buffer: Buffer, contentType?: string): Promise<PutBufferResult> {
    const result = await this.client.put(key, buffer, {
      headers: { 'Content-Type': contentType },
    });
    return {
      storageKey: key,
      size: buffer.length,
      etag: result.res?.headers?.etag,
    };
  }

  async readFile(key: string): Promise<Buffer | null> {
    try {
      const result = await this.client.get(key);
      // ali-oss 返回的是 stream 或 buffer,做兼容
      if (Buffer.isBuffer(result.content)) return result.content;
      if (result.content instanceof Uint8Array) return Buffer.from(result.content);
      if (typeof result.content === 'string') return Buffer.from(result.content, 'utf8');
      // stream
      const chunks: Buffer[] = [];
      return await new Promise<Buffer>((resolve, reject) => {
        result.content.on('data', (c: Buffer) => chunks.push(c));
        result.content.on('end', () => resolve(Buffer.concat(chunks)));
        result.content.on('error', reject);
      });
    } catch (err: any) {
      if (err?.code === 'NoSuchKey' || err?.status === 404) return null;
      throw err;
    }
  }

  async removeObject(key: string): Promise<void> {
    try {
      await this.client.delete(key);
    } catch (err: any) {
      if (err?.code === 'NoSuchKey' || err?.status === 404) return;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.head(key);
      return true;
    } catch (err: any) {
      if (err?.code === 'NoSuchKey' || err?.status === 404) return false;
      throw err;
    }
  }

  async *listAllKeys(prefix = ''): AsyncIterable<StorageObject[]> {
    const BATCH = 1000;
    let marker: string | null = null;
    do {
      const result: any = await this.client.list(
        {
          prefix,
          'max-keys': String(BATCH),
          marker: marker || undefined,
        },
        {},
      );
      const objs = result.objects || result;
      const batch: StorageObject[] = objs.map((o: any) => ({
        key: o.name,
        size: o.size ?? 0,
        lastModified: o.lastModified,
      }));
      if (batch.length > 0) yield batch;
      marker = result.nextMarker || null;
    } while (marker);
  }

  async copyObject(srcKey: string, destKey: string): Promise<void> {
    // ali-oss 0.x: copy
    await this.client.copy(destKey, srcKey);
  }

  async healthCheck(): Promise<DriverHealth> {
    const start = Date.now();
    try {
      await this.client.getBucketInfo(this.options.bucket);
      return {
        driver: this.name,
        ok: true,
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        driver: this.name,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
