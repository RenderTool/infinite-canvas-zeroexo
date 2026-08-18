import { Injectable } from '@nestjs/common';
import { ApiProvider } from '@prisma/client';
import { StorageService } from '../../storage/storage.service';
import { BaseApiAdapter, HealthResult } from './base.adapter';
import { ErrorCode } from '../../../common/errors/error-codes';
import { badRequest } from '../../../common/errors/app-exception.js';

/**
 * 存储渠道支持的服务商标识
 * - local: 本地文件系统
 * - s3:    S3 兼容(MinIO / AWS S3)
 * - oss:   阿里云 OSS
 * - cos:   腾讯云 COS
 *
 * 注:存储渠道在 Stage A 设计上由 StorageService 统一管理(切换/迁移/双写),
 * 本适配器仅负责:健康检查、URL 预签发、put/read/remove 业务动作的桥接。
 */
const SUPPORTED = ['local', 's3', 'oss', 'cos'] as const;

/**
 * Storage 适配器 - 桥接 StorageService 与 ApiProvider 抽象
 *
 * 职责:
 * 1. healthCheck: 委托 StorageService.healthCheck()(底层 driver 自检)
 * 2. invokeAction: 桥接 put / read / remove / presign 操作到 StorageService
 * 3. 存储渠道的 driver 切换/迁移由 Stage A 的 SettingsService 触发,
 *    本适配器不直接处理 storage config 的重写
 */
@Injectable()
export class StorageAdapter extends BaseApiAdapter {
  readonly type = 'storage' as const;
  readonly supportedProviders: string[] = [...SUPPORTED];

  constructor(private readonly storage: StorageService) {
    super();
  }

  /**
   * 校验公开配置
   * - driver 必填且在支持列表
   * - 各 driver 必填项:bucket(对象存储) / root(本地)
   */
  async validateConfig(config: Record<string, any>): Promise<string | null> {
    // provider 已在 ApiProvidersService.validateTypeAndProvider 中校验,config 中不含 provider 字段
    // 根据配置字段推断渠道类型
    if (config.root !== undefined) {
      if (!config.root) return 'local 渠道缺少 root';
    } else {
      if (config.bucket !== undefined && !config.bucket) return '渠道缺少 bucket';
      if (config.region !== undefined && !config.region) return '渠道缺少 region';
    }
    return null;
  }

  /**
   * 健康检查 - 委托给 StorageService
   * - StorageService 已封装 primary + secondary 双 driver 检查
   * - 任一 driver 失败则标记 down
   */
  async healthCheck(provider: ApiProvider): Promise<HealthResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    if (!provider.enabled) {
      return { ok: false, status: 'down', error: '渠道已禁用', checkedAt };
    }
    try {
      const results = await this.storage.healthCheckAll();
      const primary = results[0];
      const ok = primary?.ok ?? false;
      return {
        ok,
        status: ok ? 'healthy' : 'down',
        latencyMs: Date.now() - start,
        error: ok ? undefined : primary?.error,
        checkedAt,
        details: {
          primary: primary?.driver,
          primaryOk: primary?.ok,
          secondary: results[1]?.driver,
          secondaryOk: results[1]?.ok,
          results,
        },
      };
    } catch (err) {
      return {
        ok: false,
        status: 'down',
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
        checkedAt,
      };
    }
  }

  /**
   * 业务动作分发
   * - presign-put:  生成上传预签 URL
   * - presign-get:  生成下载预签 URL
   * - put:          直传 Buffer
   * - read:         读取 Buffer
   * - remove:       删除对象
   * - exists:       检查存在
   */
  async invokeAction(
    _provider: ApiProvider,
    action: string,
    params: Record<string, any>,
  ): Promise<any> {
    switch (action) {
      case 'presign-put':
        return this.storage.presignPut(
          params.key,
          params.contentType ?? 'application/octet-stream',
          params.expirySeconds,
        );
      case 'presign-get':
        return this.storage.presignGet(params.key, params.expirySeconds);
      case 'put': {
        const buffer = Buffer.isBuffer(params.buffer)
          ? params.buffer
          : Buffer.from(params.buffer ?? params.data ?? '');
        const result = await this.storage.putBuffer(
          params.key,
          buffer,
          params.contentType ?? 'application/octet-stream',
        );
        return { ok: true, ...result };
      }
      case 'read': {
        const buf = await this.storage.readFile(params.key);
        if (!buf) return { ok: false, found: false };
        return { ok: true, found: true, buffer: buf, size: buf.length };
      }
      case 'remove':
        await this.storage.removeObject(params.key);
        return { ok: true };
      case 'exists':
        return { ok: true, exists: await this.storage.exists(params.key) };
      default:
        throw badRequest(ErrorCode.BAD_REQUEST, `Storage adapter does not support action: ${action}`);
    }
  }

  /** 存储类型上报指标 */
  getUsageMetrics(): string[] {
    return ['byte', 'request', 'storage_used'];
  }

  /**
   * 存储公开配置字段
   * - driver 切换由 SettingsService 触发,不在此处暴露 driver 字段
   * - 这里只暴露 bucket/region/endpoint(供 API Provider 配置展示)
   */
  getConfigFields() {
    return [
      {
        key: 'bucket',
        label: 'Bucket 名称',
        type: 'text' as const,
        placeholder: 'zeroexo-assets',
        description: '对象存储渠道必填,local 渠道不适用',
      },
      {
        key: 'region',
        label: '区域',
        type: 'text' as const,
        placeholder: 'oss-cn-hangzhou',
      },
      {
        key: 'endpoint',
        label: '自定义 Endpoint',
        type: 'text' as const,
        placeholder: 'https://oss-cn-hangzhou.aliyuncs.com',
        description: 'S3/MinIO 兼容时使用',
      },
    ];
  }

  /** 凭证字段 - 对象存储 accessKey */
  getCredentialsFields() {
    return [
      {
        key: 'accessKey',
        label: 'Access Key',
        type: 'text' as const,
        required: true,
      },
      {
        key: 'secretKey',
        label: 'Secret Key',
        type: 'password' as const,
        required: true,
      },
    ];
  }
}
