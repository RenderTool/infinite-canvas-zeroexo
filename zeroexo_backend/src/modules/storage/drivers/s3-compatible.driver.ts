/**
 * S3CompatibleDriver - S3 兼容对象存储驱动
 *
 * 适用:
 * - MinIO (开源 S3 兼容)
 * - AWS S3
 * - Ceph RadosGW
 * - 其它 S3 协议兼容存储(华为云 OBS、Azure Blob 等)
 *
 * 配置:
 * {
 *   driver: 's3',
 *   options: {
 *     endpoint: 'http://localhost:9000',   // MinIO/自建; AWS S3 留空
 *     region: 'us-east-1',
 *     bucket: 'zeroexo-assets',
 *     accessKey: 'xxx',
 *     secretKey: 'xxx',
 *     forcePathStyle: true,                  // MinIO 必填 true
 *     publicBaseUrl: 'https://cdn.example.com'  // 可选,CDN 加速
 *   }
 * }
 *
 * 实现说明:
 * - 使用社区 minio SDK(已在 package.json 中)
 * - presignPut/presignGet 走 SDK 的 presignedUrl
 * - 列出 keys 用 listObjectsV2,分页迭代
 */

import { Logger } from '@nestjs/common';
import { Client } from 'minio';
import type {
  DriverHealth,
  IStorageDriver,
  PutBufferResult,
  StorageObject,
} from '../storage-driver.interface';

export class S3CompatibleDriver implements IStorageDriver {
  readonly name = 's3' as const;
  private readonly logger = new Logger(S3CompatibleDriver.name);
  private client!: Client;
  private readonly options: Record<string, any>;
  private bucketExists = false;

  constructor(options: Record<string, any>) {
    this.options = options;
  }

  async init(): Promise<void> {
    if (!this.options.bucket) {
      throw new Error('S3 driver: 缺少 bucket 配置');
    }
    if (!this.options.accessKey || !this.options.secretKey) {
      throw new Error('S3 driver: 缺少 accessKey/secretKey');
    }
    this.client = new Client({
      endPoint: this.options.endpoint ? this.parseHost(this.options.endpoint) : 's3.amazonaws.com',
      port: this.parsePort(this.options.endpoint),
      useSSL: this.options.useSSL ?? (this.options.endpoint?.startsWith('https') ?? true),
      accessKey: this.options.accessKey,
      secretKey: this.options.secretKey,
      region: this.options.region,
      pathStyle: this.options.forcePathStyle ?? false,
    });

    // 启动时确认 bucket 存在(不存在则自动创建,避免运行时才发现)
    try {
      this.bucketExists = await this.client.bucketExists(this.options.bucket);
      if (!this.bucketExists) {
        this.logger.warn(`S3 bucket 不存在,尝试自动创建: ${this.options.bucket}`);
        await this.client.makeBucket(this.options.bucket, this.options.region);
        this.bucketExists = true;
        this.logger.log(`S3 bucket 已自动创建: ${this.options.bucket}`);
      } else {
        this.logger.log(`S3 driver 已就绪,bucket: ${this.options.bucket}`);
      }
    } catch (err) {
      this.logger.error(`S3 driver 初始化失败: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  private parseHost(endpoint: string): string {
    try {
      const u = new URL(endpoint);
      return u.hostname;
    } catch {
      // 形如 'localhost:9000'
      return endpoint.split(':')[0];
    }
  }

  private parsePort(endpoint: string): number {
    if (!endpoint) return 443;
    try {
      const u = new URL(endpoint);
      return u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
    } catch {
      const parts = endpoint.split(':');
      return parts[1] ? Number(parts[1]) : 80;
    }
  }

  async validateConfig(): Promise<string | null> {
    if (!this.options.bucket) return '缺少 bucket';
    if (!this.options.accessKey) return '缺少 accessKey';
    if (!this.options.secretKey) return '缺少 secretKey';
    if (!this.options.region) return '缺少 region';
    return null;
  }

  async presignPut(key: string, _contentType?: string, expirySeconds = 3600): Promise<string> {
    // minio SDK v8: presignedPutObject(bucket, object, expires) 不支持设置 Content-Type
    // 客户端上传时通过 HTTP header 指定 Content-Type,S3 端自动接收
    return this.client.presignedPutObject(this.options.bucket, key, expirySeconds);
  }

  async presignGet(key: string, expirySeconds = 3600): Promise<string> {
    const url = await this.client.presignedGetObject(this.options.bucket, key, expirySeconds);
    // 若配置了 CDN 加速,替换 host
    if (this.options.publicBaseUrl) {
      try {
        const u = new URL(url);
        const cdn = new URL(this.options.publicBaseUrl);
        return `${cdn.protocol}//${cdn.host}${u.pathname}${u.search}`;
      } catch {
        return url;
      }
    }
    return url;
  }

  async putBuffer(key: string, buffer: Buffer, contentType?: string): Promise<PutBufferResult> {
    const result = await this.client.putObject(this.options.bucket, key, buffer, buffer.length, {
      'Content-Type': contentType,
    });
    return {
      storageKey: key,
      size: buffer.length,
      etag: result.etag,
    };
  }

  async readFile(key: string): Promise<Buffer | null> {
    try {
      const stream = await this.client.getObject(this.options.bucket, key);
      const chunks: Buffer[] = [];
      return await new Promise<Buffer | null>((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', (err: any) => {
          if (err?.code === 'NoSuchKey' || err?.code === 'NotFound') {
            resolve(null);
          } else {
            reject(err);
          }
        });
      });
    } catch (err) {
      if ((err as any)?.code === 'NoSuchKey') return null;
      throw err;
    }
  }

  async removeObject(key: string): Promise<void> {
    try {
      await this.client.removeObject(this.options.bucket, key);
    } catch (err) {
      const code = (err as any)?.code;
      if (code !== 'NoSuchKey' && code !== 'NotFound') throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.statObject(this.options.bucket, key);
      return true;
    } catch (err) {
      const code = (err as any)?.code;
      if (code === 'NotFound' || code === 'NoSuchKey') return false;
      throw err;
    }
  }

  async *listAllKeys(prefix = ''): AsyncIterable<StorageObject[]> {
    const BATCH = 1000;
    // minio SDK v8: listObjects(bucket, prefix, recursive, opts)
    const stream = this.client.listObjects(this.options.bucket, prefix, true);
    let batch: StorageObject[] = [];
    for await (const obj of stream) {
      if (!obj.name) continue;
      batch.push({
        key: obj.name,
        size: obj.size ?? 0,
        lastModified: obj.lastModified,
      });
      if (batch.length >= BATCH) {
        yield batch;
        batch = [];
      }
    }
    if (batch.length > 0) yield batch;
  }

  async copyObject(srcKey: string, destKey: string): Promise<void> {
    // S3 自带服务端复制
    await this.client.copyObject(this.options.bucket, destKey, `/${this.options.bucket}/${srcKey}`);
  }

  async healthCheck(): Promise<DriverHealth> {
    const start = Date.now();
    try {
      const exists = await this.client.bucketExists(this.options.bucket);
      return {
        driver: this.name,
        ok: exists,
        error: exists ? undefined : `bucket 不存在: ${this.options.bucket}`,
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
