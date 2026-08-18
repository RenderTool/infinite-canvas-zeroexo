/**
 * SettingsService - 应用配置管理(后台管理页面设置)
 *
 * 职责:
 * - 管理 JSON 配置文件(config/settings.json)
 * - 启动时加载配置并应用到 MinioService(存储路径)
 * - 提供运行时读取/修改配置的 API
 * - 提供存储路径迁移功能(复制旧路径文件到新路径)
 *
 * 配置文件格式:
 * ```json
 * {
 *   "storageRoot": "/absolute/path/to/storage",
 *   "updatedAt": "2026-07-07T..."
 * }
 * ```
 *
 * 版本迁移考虑:
 * - 配置文件含 version 字段(预留),后续版本可做迁移
 * - 迁移操作幂等(copyFile 覆盖),失败时旧路径不删除
 * - 路径变更前先复制,成功后才切换,避免数据丢失
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MinioService } from '../assets/minio.service';
import { LogsService } from '../logs/logs.service';
import { StorageService } from '../storage/storage.service';
import type { StorageConfig } from '../storage/storage-driver.interface';

/** 配置文件目录(相对 process.cwd) */
const CONFIG_DIR = path.resolve(process.cwd(), 'config');
/** 配置文件路径 */
const CONFIG_FILE = path.join(CONFIG_DIR, 'settings.json');

/** OAuth 配置结构 */
export interface OAuthConfig {
  qq?: {
    appId?: string;
    appKey?: string;
    redirectUri?: string;
    appKeyConfigured?: boolean;
  };
  wechat?: {
    appId?: string;
    appSecret?: string;
    redirectUri?: string;
    appSecretConfigured?: boolean;
  };
}

/** SMTP 配置结构 */
export interface SmtpConfig {
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  fromName?: string;
  /** 允许的邮箱域名列表（空数组或未设置表示无限制） */
  allowedDomains?: string[];
  /** 是否已配置密钥(用于回显时保护明文,运行时由 maskSensitiveFields 注入) */
  passConfigured?: boolean;
}

/** 定时任务配置 */
export interface ScheduleConfig {
  /** 资源 GC 计划 */
  resourceGc: {
    /** cron 表达式,默认每天凌晨 3:00 */
    cron: string;
    /** 是否启用 */
    enabled: boolean;
    /** 孤儿资源保留天数(软删除后多少天物理清理) */
    retentionDays: number;
  };
  /** 回收站清理计划 */
  userCleanup: {
    /** cron 表达式,默认每天凌晨 3:00 */
    cron: string;
    /** 是否启用 */
    enabled: boolean;
    /** 用户回收站保留天数 */
    retentionDays: number;
  };
}

/** 应用配置结构 */
export interface AppSettings {
  /** 文件存储根目录(绝对路径) - 已废弃,改用 storage.primary 块 */
  storageRoot?: string;
  /** 最后更新时间(ISO 字符串) */
  updatedAt: string;
  /** 配置版本号(预留,后续版本迁移用) */
  version?: number;
  /** OAuth 第三方登录配置 */
  oauth?: OAuthConfig;
  /** SMTP 邮件配置 */
  smtp?: SmtpConfig;
  /** 定时任务配置 */
  schedules?: ScheduleConfig;
  /** 存储后端配置(新,主推) */
  storage?: StorageConfig;
}

/** 当前配置版本号(后续 schema 变更时递增) */
const CURRENT_CONFIG_VERSION = 1;

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly minio: MinioService,
    private readonly logsService: LogsService,
    private readonly storageService: StorageService,
  ) {}

  /** 模块初始化时加载配置文件,应用到 MinioService */
  async onModuleInit(): Promise<void> {
    try {
      const settings = await this.readConfig();
      if (settings.storageRoot) {
        const curRoot = this.minio.getStorageRoot();
        const cfgRoot = path.resolve(settings.storageRoot);
        if (cfgRoot !== curRoot) {
          await this.applyStorageRoot(settings, settings.storageRoot);
        }
      }
    } catch (err) {
      // 配置文件不存在时静默忽略(首次启动正常)
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(
          `加载配置文件失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * 应用存储根目录(支持项目目录迁移)
   *
   * 策略:
   * - 相对路径:直接基于 process.cwd 解析,项目移动后自动跟随新位置
   * - 绝对路径:目录存在时尊重用户配置;目录已失效(项目迁移遗留旧绝对路径)
   *   时自动回退到项目内相对路径 "storage",并写回配置,避免资源写入不存在的旧目录
   */
  private async applyStorageRoot(settings: AppSettings, root: string): Promise<void> {
    if (!path.isAbsolute(root)) {
      await this.minio.setStorageRoot(root);
      this.logger.log(`从配置文件加载存储路径: ${root}`);
      return;
    }
    try {
      await fs.access(root);
      await this.minio.setStorageRoot(root);
      this.logger.log(`从配置文件加载存储路径: ${root}`);
    } catch {
      const fallback = 'storage';
      try {
        await fs.access(path.resolve(fallback));
        await this.minio.setStorageRoot(fallback);
        await this.writeConfig({
          ...settings,
          storageRoot: fallback,
          updatedAt: new Date().toISOString(),
          version: CURRENT_CONFIG_VERSION,
        });
        this.logger.warn(
          `配置的存储根目录不存在(${root}),已自动回退至项目内相对路径: ${path.resolve(fallback)}`,
        );
      } catch {
        this.logger.warn(
          `配置的存储根目录不存在(${root})且项目内无 ${fallback} 目录,保留原配置`,
        );
      }
    }
  }

  /** 获取当前配置(配置文件不存在时返回运行时值) */
  async getSettings(): Promise<AppSettings> {
    let settings: AppSettings;
    try {
      settings = await this.readConfig();
    } catch {
      // 配置文件不存在时返回当前运行时值
      const currentStorage = this.storageService.getConfig();
      settings = {
        storageRoot: this.minio.getStorageRoot(),
        storage: currentStorage,
        updatedAt: new Date().toISOString(),
        version: CURRENT_CONFIG_VERSION,
      };
    }
    return this.maskSensitiveFields(settings);
  }

  /**
   * 屏蔽敏感字段,防止密钥通过 API 回显泄露
   * - SMTP pass 仅返回是否存在布尔标志(不返回明文)
   * - OAuth appKey / appSecret 仅返回是否存在
   * - 仍保留 host / user / fromName / appId / redirectUri 等非敏感字段
   * - Storage driver 的 accessKey/secretKey 等敏感字段也屏蔽
   */
  private maskSensitiveFields(settings: AppSettings): AppSettings {
    const masked: AppSettings = { ...settings };
    if (masked.smtp?.pass) {
      masked.smtp = {
        ...masked.smtp,
        pass: undefined,
        passConfigured: true,
      } as SmtpConfig & { passConfigured?: boolean };
    }
    if (masked.oauth?.qq?.appKey) {
      masked.oauth = {
        ...masked.oauth,
        qq: {
          ...masked.oauth.qq,
          appKey: undefined,
          appKeyConfigured: true,
        },
      };
    }
    if (masked.oauth?.wechat?.appSecret) {
      masked.oauth = {
        ...masked.oauth,
        wechat: {
          ...masked.oauth.wechat,
          appSecret: undefined,
          appSecretConfigured: true,
        },
      };
    }
    if (masked.storage) {
      masked.storage = this.maskStorageConfig(masked.storage);
    }
    return masked;
  }

  /**
   * 屏蔽 storage 配置中的密钥
   * - accessKey / secretKey / accessKeyId / accessKeySecret 等保留前缀 + 长度信息
   */
  private maskStorageConfig(cfg: StorageConfig): StorageConfig {
    const mask = (opt: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = { ...opt };
      for (const key of ['accessKey', 'secretKey', 'accessKeyId', 'accessKeySecret', 'secretId']) {
        if (typeof out[key] === 'string' && (out[key] as string).length > 0) {
          const v = out[key] as string;
          out[key] = `${v.slice(0, 4)}***${v.slice(-4)}(${v.length})`;
        }
      }
      return out;
    };
    return {
      ...cfg,
      primary: { ...cfg.primary, options: mask(cfg.primary.options) },
      secondary: cfg.secondary
        ? { ...cfg.secondary, options: mask(cfg.secondary.options) }
        : undefined,
    };
  }

  /**
   * 更新配置(合并写入配置文件)
   * 支持更新 storageRoot / oauth / smtp / schedules 等任意字段。
   * 调用方如需迁移文件,应额外调用 migrateStorage。
   */
  async updateSettings(
    patch: Partial<Pick<AppSettings, 'storageRoot' | 'oauth' | 'smtp' | 'schedules'>>,
  ): Promise<AppSettings> {
    const current = await this.readConfig();
    const updated: AppSettings = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
      version: CURRENT_CONFIG_VERSION,
    };
    // oauth/smtp/schedules 是嵌套对象,需要深层合并而非直接覆盖
    if (patch.oauth && current.oauth) {
      updated.oauth = { ...current.oauth, ...patch.oauth };
    }
    if (patch.smtp && current.smtp) {
      updated.smtp = { ...current.smtp, ...patch.smtp };
    }
    if (patch.schedules && current.schedules) {
      updated.schedules = {
        resourceGc: { ...current.schedules.resourceGc, ...patch.schedules.resourceGc },
        userCleanup: { ...current.schedules.userCleanup, ...patch.schedules.userCleanup },
      };
    }
    await this.writeConfig(updated);
    this.logsService.log('system', `更新配置: ${JSON.stringify({ ...patch, smtp: patch.smtp ? { ...patch.smtp, pass: '***' } : undefined })}`, {});
    return this.maskSensitiveFields(updated);
  }

  /**
   * 更新 OAuth 配置(QQ / 微信),保存到 config/settings.json 的 oauth 字段。
   */
  async updateOAuthConfig(
    patch: { qq?: { appId?: string; appKey?: string; redirectUri?: string }; wechat?: { appId?: string; appSecret?: string; redirectUri?: string } },
  ): Promise<AppSettings> {
    const current = await this.getSettings();
    const updated: AppSettings = {
      ...current,
      oauth: {
        ...(current.oauth || {}),
        ...(patch.qq !== undefined ? { qq: patch.qq } : {}),
        ...(patch.wechat !== undefined ? { wechat: patch.wechat } : {}),
      },
      updatedAt: new Date().toISOString(),
    };
    await this.writeConfig(updated);
    this.logsService.log('system', '更新 OAuth 配置', {});
    return updated;
  }

  /** 获取 SMTP 配置 */
  async getSmtpConfig(): Promise<SmtpConfig | null> {
    try {
      const settings = await this.readConfig();
      return settings.smtp ?? null;
    } catch {
      return null;
    }
  }

  /** 更新 SMTP 配置 */
  async updateSmtpConfig(smtp: SmtpConfig): Promise<AppSettings> {
    const current = await this.readConfig();
    const updated: AppSettings = {
      ...current,
      smtp: {
        ...(current.smtp || {}),
        ...smtp,
      },
      updatedAt: new Date().toISOString(),
    };
    await this.writeConfig(updated);
    this.logsService.log('system', '更新 SMTP 配置', {});
    return this.maskSensitiveFields(updated);
  }

  /**
   * 迁移存储:将旧路径下所有文件复制到新路径,然后切换 storageRoot
   * (向后兼容方法,新方案请使用 switchStorageDriver + 数据迁移服务)
   *
   * 流程:
   * 1. 校验新路径与旧路径不同
   * 2. 递归复制旧目录所有文件到新目录(覆盖同名文件)
   * 3. 调用 minio.setStorageRoot 切换到新路径
   * 4. 持久化到配置文件
   *
   * 注意:迁移成功后旧路径文件保留(不自动删除),用户可手动清理
   *
   * @param newRoot 新存储根目录(相对路径基于 process.cwd 解析)
   * @returns 迁移统计(文件数 + 旧路径 + 新路径)
   */
  async migrateStorage(newRoot: string): Promise<{
    migrated: number;
    from: string;
    to: string;
  }> {
    const oldRoot = this.minio.getStorageRoot();
    const resolvedNew = path.resolve(newRoot);

    if (oldRoot === resolvedNew) {
      throw new Error('新路径与当前路径相同,无需迁移');
    }

    // 确保新目录存在
    await fs.mkdir(resolvedNew, { recursive: true });

    // 递归复制旧目录下所有文件到新目录
    let migratedCount = 0;
    const copyDir = async (src: string, dest: string): Promise<void> => {
      const entries = await fs.readdir(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          await fs.mkdir(destPath, { recursive: true });
          await copyDir(srcPath, destPath);
        } else {
          await fs.copyFile(srcPath, destPath);
          migratedCount++;
        }
      }
    };

    try {
      await copyDir(oldRoot, resolvedNew);
    } catch (err) {
      this.logger.error(
        `迁移文件失败: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new Error(
        `迁移文件失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 更新 minio 存储路径
    await this.minio.setStorageRoot(resolvedNew);

    // 持久化到配置文件
    await this.writeConfig({
      storageRoot: resolvedNew,
      updatedAt: new Date().toISOString(),
      version: CURRENT_CONFIG_VERSION,
    });

    this.logsService.log(
      'system',
      `存储迁移完成: ${oldRoot} → ${resolvedNew} (${migratedCount} 个文件)`,
      {},
    );

    return { migrated: migratedCount, from: oldRoot, to: resolvedNew };
  }

  /** 读取配置文件 */
  private async readConfig(): Promise<AppSettings> {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as AppSettings;
  }

  /** 写入配置文件 */
  private async writeConfig(settings: AppSettings): Promise<void> {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  }

  // ──────── 存储 driver 切换相关(新增) ────────

  /**
   * 切换存储 driver
   *
   * 流程:
   * 1. 校验新 driver 配置可连通(healthCheck)
   * 2. 写入 settings.json 与 storage.json
   * 3. 调用 StorageService.switchDriver 切换
   * 4. 旧 driver 数据保留(由用户在 UI 触发迁移)
   *
   * @param newConfig 新的 storage 配置(primary 必须,secondary 可选用于迁移期)
   * @returns 切换结果 + 新 driver 健康状态
   */
  async switchStorageDriver(newConfig: StorageConfig): Promise<{
    health: import('../storage/storage-driver.interface').DriverHealth[];
    storage: StorageConfig;
  }> {
    // 1. 构造 driver 实例并校验
    const { createDriver } = await import('../storage/storage.service');
    const driver = createDriver(newConfig.primary);
    const err = await driver.validateConfig();
    if (err) {
      throw new Error(`driver 配置校验失败: ${err}`);
    }
    try {
      await driver.init();
      const health = await driver.healthCheck();
      if (!health.ok) {
        throw new Error(`driver 健康检查失败: ${health.error}`);
      }
      await driver.dispose?.();
    } catch (err) {
      throw new Error(`driver 初始化失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. 写入 settings.json
    const current = await this.getSettings();
    const updated: AppSettings = {
      ...current,
      storage: newConfig,
      // 兼容旧字段:local driver 时同步
      storageRoot:
        newConfig.primary.driver === 'local'
          ? String((newConfig.primary.options as { root?: string }).root ?? '')
          : current.storageRoot,
      updatedAt: new Date().toISOString(),
      version: CURRENT_CONFIG_VERSION,
    };
    await this.writeConfig(updated);

    // 3. 切换 driver(同时落 storage.json)
    await this.storageService.switchDriver(newConfig);
    const healthList = await this.storageService.healthCheckAll();

    this.logsService.log(
      'system',
      `切换存储 driver: ${this.storageService.getSecondaryDriverName() ?? '?'} → ${newConfig.primary.driver}`,
      {},
    );

    return { health: healthList, storage: newConfig };
  }
}
