/**
 * TencentCosDriver - 腾讯云 COS(对象存储)驱动
 *
 * 适用:
 * - 腾讯云 COS(主)
 *
 * 配置:
 * {
 *   driver: 'cos',
 *   options: {
 *     region: 'ap-guangzhou',              // COS region
 *     bucket: 'zeroexo-1250000000',         // COS bucket 格式: name-appid
 *     secretId: 'AKID...',
 *     secretKey: 'xxx',
 *     cdnDomain: 'https://cdn.example.com', // 可选 CDN
 *     protocol: 'https:'                    // https: | http:
 *   }
 * }
 *
 * 依赖:
 * - 需要安装 cos-nodejs-sdk-v5: pnpm add cos-nodejs-sdk-v5
 */

import { Logger } from '@nestjs/common';
import type {
  DriverHealth,
  IStorageDriver,
  PutBufferResult,
  StorageObject,
} from '../storage-driver.interface';

/** 延迟加载 cos SDK - 避免未安装时启动失败 */
let _cosCtor: any = null;
function loadCos(): any {
  if (_cosCtor) return _cosCtor;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('cos-nodejs-sdk-v5');
    _cosCtor = mod.COS || mod.default || mod;
    return _cosCtor;
  } catch (err) {
    throw new Error(
      'cos-nodejs-sdk-v5 SDK 未安装,请执行: pnpm add cos-nodejs-sdk-v5\n' +
        '或切换到 s3 driver(Tencent COS 也支持 S3 兼容协议)',
    );
  }
}

export class TencentCosDriver implements IStorageDriver {
  readonly name = 'cos' as const;
  private readonly logger = new Logger(TencentCosDriver.name);
  private client!: any;
  private readonly options: Record<string, any>;

  constructor(options: Record<string, any>) {
    this.options = options;
  }

  async init(): Promise<void> {
    const COS = loadCos();
    if (
      !this.options.bucket ||
      !this.options.secretId ||
      !this.options.secretKey ||
      !this.options.region
    ) {
      throw new Error('COS driver: 缺少 region/bucket/secretId/secretKey');
    }
    this.client = new COS({
      SecretId: this.options.secretId,
      SecretKey: this.options.secretKey,
      SecurityToken: this.options.securityToken,
      Protocol: this.options.protocol ?? 'https:',
    });

    // 探测 bucket 可达性
    try {
      await this.headBucket();
      this.logger.log(`腾讯云 COS driver 已就绪,bucket: ${this.options.bucket}`);
    } catch (err) {
      this.logger.error(`COS driver 初始化失败: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  private headBucket(): Promise<any> {
    return new Promise((resolve, reject) => {
      this.client.headBucket(
        { Bucket: this.options.bucket, Region: this.options.region },
        (err: any, data: any) => (err ? reject(err) : resolve(data)),
      );
    });
  }

  async validateConfig(): Promise<string | null> {
    if (!this.options.region) return '缺少 region';
    if (!this.options.bucket) return '缺少 bucket';
    if (!this.options.secretId) return '缺少 secretId';
    if (!this.options.secretKey) return '缺少 secretKey';
    return null;
  }

  async presignPut(key: string, _contentType?: string, expirySeconds = 3600): Promise<string> {
    // COS SDK 暂未提供原生签名 URL 生成,改用 getObjectUrl 风格的 presign
    // 实际生产推荐用 STS 前端直传,此处给一个回退
    const url = await this.getSignedUrl(key, 'put', expirySeconds);
    return this.maybeCdn(url);
  }

  async presignGet(key: string, expirySeconds = 3600): Promise<string> {
    const url = await this.getSignedUrl(key, 'get', expirySeconds);
    return this.maybeCdn(url);
  }

  private getSignedUrl(key: string, method: 'put' | 'get', expires: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const params = {
        Bucket: this.options.bucket,
        Region: this.options.region,
        Key: key,
        Method: method === 'put' ? 'PUT' : 'GET',
        Expires: expires,
      };
      this.client.getObjectUrl(params, (err: any, data: any) => {
        if (err) return reject(err);
        resolve(data.Url);
      });
    });
  }

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
    return new Promise((resolve, reject) => {
      this.client.putObject(
        {
          Bucket: this.options.bucket,
          Region: this.options.region,
          Key: key,
          Body: buffer,
          ContentLength: buffer.length,
          ContentType: contentType,
        },
        (err: any, data: any) => {
          if (err) return reject(err);
          resolve({
            storageKey: key,
            size: buffer.length,
            etag: data.ETag,
          });
        },
      );
    });
  }

  async readFile(key: string): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
      this.client.getObject(
        {
          Bucket: this.options.bucket,
          Region: this.options.region,
          Key: key,
        },
        (err: any, data: any) => {
          if (err) {
            if (err.statusCode === 404 || err.code === 'NoSuchKey') {
              return resolve(null);
            }
            return reject(err);
          }
          if (Buffer.isBuffer(data.Body)) return resolve(data.Body);
          if (data.Body instanceof Uint8Array) return resolve(Buffer.from(data.Body));
          return resolve(Buffer.from(data.Body, 'utf8'));
        },
      );
    });
  }

  async removeObject(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.deleteObject(
        {
          Bucket: this.options.bucket,
          Region: this.options.region,
          Key: key,
        },
        (err: any) => {
          if (err) {
            if (err.statusCode === 404 || err.code === 'NoSuchKey') return resolve();
            return reject(err);
          }
          resolve();
        },
      );
    });
  }

  async exists(key: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.client.headObject(
        {
          Bucket: this.options.bucket,
          Region: this.options.region,
          Key: key,
        },
        (err: any) => {
          if (err) {
            if (err.statusCode === 404 || err.code === 'NoSuchKey') return resolve(false);
            return reject(err);
          }
          resolve(true);
        },
      );
    });
  }

  async *listAllKeys(prefix = ''): AsyncIterable<StorageObject[]> {
    const BATCH = 1000;
    let marker: string | undefined;
    do {
      const result = await this.listObjects({
        Prefix: prefix,
        MaxKeys: BATCH,
        Marker: marker,
      });
      const contents = result.Contents || [];
      const batch: StorageObject[] = contents.map((c: any) => ({
        key: c.Key,
        size: c.Size ?? 0,
        lastModified: c.LastModified ? new Date(c.LastModified) : undefined,
      }));
      if (batch.length > 0) yield batch;
      marker = result.NextMarker || undefined;
      if (!result.IsTruncated) break;
    } while (marker);
  }

  private listObjects(params: Record<string, any>): Promise<any> {
    return new Promise((resolve, reject) => {
      this.client.getBucket(
        { Bucket: this.options.bucket, Region: this.options.region, ...params },
        (err: any, data: any) => (err ? reject(err) : resolve(data)),
      );
    });
  }

  async copyObject(srcKey: string, destKey: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.putObjectCopy(
        {
          Bucket: this.options.bucket,
          Region: this.options.region,
          Key: destKey,
          CopySource: `${this.options.bucket}.cos.${this.options.region}.myqcloud.com/${srcKey}`,
        },
        (err: any) => (err ? reject(err) : resolve()),
      );
    });
  }

  async healthCheck(): Promise<DriverHealth> {
    const start = Date.now();
    try {
      await this.headBucket();
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
