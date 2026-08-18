/**
 * StorageService - 存储后端门面
 *
 * 职责:
 * 1. 持有当前主 driver(primary) + 可选副 driver(secondary,迁移期双写)
 * 2. 业务侧统一通过本 service 调用存储操作,不知道具体 driver
 * 3. 切读/切写/迁移等高阶操作由 SettingsService 触发
 * 4. 启动时从 storage.json 加载 driver 配置并 init
 *
 * 兼容性:
 * - 保留原有 MinioService 的方法签名(presignPut/presignGet/putBuffer/readFile/removeObject)
 * - 业务模块(assets / ai-generate / storage controller)注入 MinioService 即可,
 *   MinioService 内部委托给本 service
 */

import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { LocalFileDriver } from './drivers/local-file.driver';
import { S3CompatibleDriver } from './drivers/s3-compatible.driver';
import { AliyunOssDriver } from './drivers/aliyun-oss.driver';
import { TencentCosDriver } from './drivers/tencent-cos.driver';
import type {
  DriverConfig,
  DriverHealth,
  IStorageDriver,
  StorageConfig,
} from './storage-driver.interface';

/** 默认 driver 配置(本地存储,无外部依赖) */
const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  primary: { driver: 'local', options: { root: 'storage' } },
  presignExpiry: 3600,
};

/** 配置文件路径(与 SettingsService 共享) */
const CONFIG_DIR = path.resolve(process.cwd(), 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'storage.json');

/** driver 工厂 - 导出供 SettingsService 在切换前做预校验 */
export function createDriver(cfg: DriverConfig): IStorageDriver {
  switch (cfg.driver) {
    case 'local':
      return new LocalFileDriver(cfg.options ?? {});
    case 's3':
      return new S3CompatibleDriver(cfg.options ?? {});
    case 'oss':
      return new AliyunOssDriver(cfg.options ?? {});
    case 'cos':
      return new TencentCosDriver(cfg.options ?? {});
    default:
      throw new Error(`未知的 storage driver: ${cfg.driver}`);
  }
}

@Injectable()
export class StorageService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(StorageService.name);
  private primary?: IStorageDriver;
  private secondary?: IStorageDriver;
  private config: StorageConfig = DEFAULT_STORAGE_CONFIG;
  private initialized = false;

  constructor(_configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.primary?.dispose) await this.primary.dispose();
    if (this.secondary?.dispose) await this.secondary.dispose();
  }

  /**
   * 从配置文件重新加载 driver(启动时 + 切换后)
   * - 关闭旧 driver
   * - 初始化新 driver
   * - 失败时保留旧 driver 不变(降级)
   */
  async reload(): Promise<StorageConfig> {
    let loaded: StorageConfig;
    try {
      const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
      loaded = JSON.parse(raw) as StorageConfig;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(
          `读取 storage.json 失败,使用默认配置: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      loaded = DEFAULT_STORAGE_CONFIG;
    }
    await this.applyConfig(loaded);
    return this.config;
  }

  /** 应用 driver 配置(切换入口) */
  async applyConfig(newConfig: StorageConfig): Promise<void> {
    const nextPrimary = createDriver(newConfig.primary);
    await nextPrimary.init();
    let nextSecondary: IStorageDriver | undefined;
    if (newConfig.secondary) {
      nextSecondary = createDriver(newConfig.secondary);
      await nextSecondary.init();
    }

    // 替换前先释放旧 driver
    if (this.primary?.dispose) {
      try {
        await this.primary.dispose();
      } catch {
        /* 忽略 */
      }
    }
    if (this.secondary?.dispose) {
      try {
        await this.secondary.dispose();
      } catch {
        /* 忽略 */
      }
    }

    this.primary = nextPrimary;
    this.secondary = nextSecondary;
    this.config = newConfig;
    this.initialized = true;
    this.logger.log(
      `Storage driver 已就绪: primary=${this.primary.name}` +
        (this.secondary ? `, secondary=${this.secondary.name}(双写模式)` : ''),
    );
  }

  /** 获取当前 driver 名称 */
  getPrimaryDriverName(): string {
    return this.primary?.name ?? 'local';
  }

  getSecondaryDriverName(): string | null {
    return this.secondary?.name ?? null;
  }

  getConfig(): StorageConfig {
    return this.config;
  }

  /** 获取 driver 实例(供高级场景如迁移使用) */
  getPrimary(): IStorageDriver {
    return this.primary!;
  }

  getSecondary(): IStorageDriver | undefined {
    return this.secondary;
  }

  /** driver 切换入口(供 SettingsService 调用) */
  async switchDriver(newConfig: StorageConfig): Promise<DriverHealth[]> {
    await this.persistConfig(newConfig);
    await this.applyConfig(newConfig);
    return this.healthCheckAll();
  }

  /** 写入配置文件 */
  async persistConfig(cfg: StorageConfig): Promise<void> {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  }

  // ──────── 业务方法(委托给 primary,迁移期同时写 secondary) ────────

  async presignPut(
    key: string,
    contentType: string,
    expirySeconds?: number,
  ): Promise<string> {
    this.ensureReady();
    return this.primary!.presignPut(
      key,
      contentType,
      expirySeconds ?? this.config.presignExpiry,
    );
  }

  async presignGet(key: string, expirySeconds?: number): Promise<string> {
    this.ensureReady();
    return this.primary!.presignGet(key, expirySeconds ?? this.config.presignExpiry);
  }

  /**
   * 上传 Buffer - 迁移期自动双写
   * - 失败策略: primary 失败抛错,secondary 失败仅记录(不阻塞)
   */
  async putBuffer(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<{ storageKey: string; size: number }> {
    this.ensureReady();
    const result = await this.primary!.putBuffer(key, buffer, contentType);
    if (this.secondary) {
      try {
        await this.secondary.putBuffer(key, buffer, contentType);
      } catch (err) {
        this.logger.warn(
          `secondary 写入失败(${this.secondary.name}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { storageKey: result.storageKey, size: result.size };
  }

  /**
   * 读取文件 - 优先 primary,fallback 到 secondary
   * (迁移期 primary 文件可能未复制完成,从 secondary 取)
   */
  async readFile(key: string): Promise<Buffer | null> {
    this.ensureReady();
    const primaryBuffer = await this.primary!.readFile(key);
    if (primaryBuffer) return primaryBuffer;
    if (this.secondary) {
      return this.secondary.readFile(key);
    }
    return null;
  }

  async removeObject(key: string): Promise<void> {
    this.ensureReady();
    await this.primary!.removeObject(key);
    if (this.secondary) {
      try {
        await this.secondary.removeObject(key);
      } catch (err) {
        this.logger.warn(
          `secondary 删除失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    this.ensureReady();
    return (
      (await this.primary!.exists(key)) ||
      (this.secondary ? this.secondary.exists(key) : false)
    );
  }

  async *listAllKeys(
    prefix?: string,
  ): AsyncIterable<Array<{ key: string; size: number | bigint; lastModified?: Date }>> {
    this.ensureReady();
    yield* this.primary!.listAllKeys(prefix);
  }

  async healthCheck(): Promise<DriverHealth> {
    this.ensureReady();
    return this.primary!.healthCheck();
  }

  async healthCheckAll(): Promise<DriverHealth[]> {
    this.ensureReady();
    const results = [await this.primary!.healthCheck()];
    if (this.secondary) {
      results.push(await this.secondary.healthCheck());
    }
    return results;
  }

  private ensureReady(): void {
    if (!this.initialized || !this.primary) {
      throw new Error('StorageService 未初始化');
    }
  }
}
