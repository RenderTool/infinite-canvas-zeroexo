import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ResourceGcService } from '../assets/resource-gc.service';
import { UserCleanupService } from '../users/user-cleanup.service';
import { SettingsService, type ScheduleConfig } from './settings.service';

/** 默认计划配置 */
const DEFAULT_SCHEDULE: ScheduleConfig = {
  resourceGc: {
    cron: '0 0 3 * * *',
    enabled: true,
    retentionDays: 7,
  },
  userCleanup: {
    cron: '0 0 3 * * *',
    enabled: true,
    retentionDays: 30,
  },
};

/** 定时任务名称常量 */
const JOB_NAMES = {
  RESOURCE_GC: 'resource-gc',
  USER_CLEANUP: 'user-cleanup',
} as const;

/**
 * GC 定时任务管理服务
 *
 * 职责:
 * 1. 启动时从 settings.json 读取计划配置 → 注册 cron jobs
 * 2. 运行时接收外部更新 → 重新注册 cron jobs
 * 3. 提供当前配置查询
 *
 * 使用 @nestjs/schedule 的 SchedulerRegistry 实现动态注册/删除/启停。
 */
@Injectable()
export class GcScheduleService implements OnModuleInit {
  private readonly logger = new Logger(GcScheduleService.name);

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly settingsService: SettingsService,
    private readonly resourceGcService: ResourceGcService,
    private readonly userCleanupService: UserCleanupService,
  ) {}

  /** 模块初始化时从配置加载并注册所有定时任务 */
  async onModuleInit(): Promise<void> {
    const config = await this.loadScheduleConfig();
    this.registerJob(JOB_NAMES.RESOURCE_GC, config.resourceGc, () =>
      this.resourceGcService.runGarbageCollection(),
    );
    this.registerJob(JOB_NAMES.USER_CLEANUP, config.userCleanup, () =>
      this.userCleanupService.cleanupExpiredUsers(config.userCleanup.retentionDays),
    );
    this.logger.log(`GC 定时任务已注册: ${JSON.stringify(config)}`);
  }

  /** 获取当前生效的计划配置 */
  async getScheduleConfig(): Promise<ScheduleConfig> {
    return this.loadScheduleConfig();
  }

  /**
   * 更新计划配置 → 停止旧任务 → 移除旧 job → 注册新 job
   */
  async updateScheduleConfig(
    patch: Partial<ScheduleConfig>,
  ): Promise<ScheduleConfig> {
    const current = await this.loadScheduleConfig();

    const updated: ScheduleConfig = {
      resourceGc: {
        ...current.resourceGc,
        ...(patch.resourceGc || {}),
      },
      userCleanup: {
        ...current.userCleanup,
        ...(patch.userCleanup || {}),
      },
    };

    // 重新注册两个任务
    this.reloadJob(JOB_NAMES.RESOURCE_GC, updated.resourceGc, () =>
      this.resourceGcService.runGarbageCollection(),
    );
    this.reloadJob(JOB_NAMES.USER_CLEANUP, updated.userCleanup, () =>
      this.userCleanupService.cleanupExpiredUsers(updated.userCleanup.retentionDays),
    );

    // 持久化到配置文件
    await this.settingsService.updateSettings({ schedules: updated });

    this.logger.log(`GC 定时任务配置已更新: ${JSON.stringify(updated)}`);
    return updated;
  }

  // ========== 内部方法 ==========

  /** 从配置文件加载计划,不存在则使用默认值 */
  private async loadScheduleConfig(): Promise<ScheduleConfig> {
    try {
      const settings = await this.settingsService.getSettings();
      if (settings.schedules) {
        return {
          resourceGc: { ...DEFAULT_SCHEDULE.resourceGc, ...settings.schedules.resourceGc },
          userCleanup: { ...DEFAULT_SCHEDULE.userCleanup, ...settings.schedules.userCleanup },
        };
      }
    } catch {
      // 忽略
    }
    return { ...DEFAULT_SCHEDULE, resourceGc: { ...DEFAULT_SCHEDULE.resourceGc }, userCleanup: { ...DEFAULT_SCHEDULE.userCleanup } };
  }

  /** 注册单个 cron job */
  private registerJob(
    name: string,
    taskCfg: { cron: string; enabled: boolean },
    tick: () => Promise<unknown>,
  ): void {
    try {
      // 可能已存在(热更新时),先移除
      this.schedulerRegistry.deleteCronJob(name);
    } catch {
      // 不存在则忽略
    }

    const job = new CronJob(taskCfg.cron, async () => {
      try {
        await tick();
      } catch (err) {
        this.logger.error(
          `定时任务"${name}"执行失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    this.schedulerRegistry.addCronJob(name, job);

    if (taskCfg.enabled) {
      job.start();
    }
  }

  /** 移除旧 job + 注册新 job */
  private reloadJob(
    name: string,
    taskCfg: { cron: string; enabled: boolean },
    tick: () => Promise<unknown>,
  ): void {
    try {
      const existing = this.schedulerRegistry.getCronJob(name);
      existing.stop();
      this.schedulerRegistry.deleteCronJob(name);
    } catch {
      // 不存在则忽略
    }
    this.registerJob(name, taskCfg, tick);
  }
}
