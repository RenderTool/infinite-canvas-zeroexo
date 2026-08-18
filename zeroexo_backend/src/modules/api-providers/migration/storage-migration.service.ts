import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import {
  IStorageDriver,
  StorageDriverName,
} from '../../storage/storage-driver.interface';
import { ErrorCode } from '../../../common/errors/error-codes';
import { badRequest, notFound } from '../../../common/errors/app-exception.js';

/** 创建迁移任务 DTO */
export interface CreateMigrationDto {
  /** 源 driver 名称 */
  fromDriver: 'local' | 's3' | 'oss' | 'cos';
  /** 目标 driver 名称 */
  toDriver: 'local' | 's3' | 'oss' | 'cos';
  /** 创建者(管理员 ID) */
  createdBy: string;
  /** 源 driver 配置(若不是当前 primary,用于临时构造) */
  sourceConfig?: any;
  /** 目标 driver 配置 */
  destConfig?: any;
  /** 文件过滤条件 */
  filter?: { prefix?: string; ownerId?: string; onlyActive?: boolean };
}

/** 迁移进度结构体(用于 SSE 推送) */
export interface MigrationProgress {
  jobId: string;
  status: string;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  skippedFiles: number;
  percent: number;
  currentFile?: string;
  /** 吞吐(字节/秒) */
  throughput?: number;
  /** 预计剩余时间(秒) */
  eta?: number;
}

/** Job 内部控制器(暂停/取消) */
interface JobControl {
  abort: boolean;
  paused: boolean;
}

/** 校验结果 */
export interface VerifyResult {
  verified: number;
  matched: number;
  mismatched: number;
  missing: number;
  details: Array<{
    storageKey: string;
    status: 'matched' | 'mismatched' | 'missing';
  }>;
}

/**
 * 存储迁移服务 - 跨 driver 数据迁移(Stage F)
 *
 * 核心能力:
 * 1. 扫描源 driver 全部文件,生成 MigrationJob + MigrationJobItem
 * 2. 后台并发 worker(CONCURRENCY=5)将文件从源 driver 拷贝到目标 driver
 * 3. 支持 暂停/恢复/取消
 * 4. 迁移完成后可触发 字节级 diff 校验(sample 50 条 / full 全部)
 * 5. 进度事件通过内置 EventEmitter 广播,SSE 控制器订阅推送给前端
 *
 * 设计要点:
 * - 任务状态持久化在 DB,服务重启后可通过 startJob 恢复
 * - 单个文件失败时重试 3 次,仍失败标记为 failed 并继续后续文件
 * - 实际数据迁移通过 StorageService.getPrimary() / getSecondary() 获取 driver
 *   实例;若 fromDriver/toDriver 不在当前 primary/secondary 中,
 *   当前实现仅支持从配置文件中已加载的 driver(未动态注入 sourceConfig/destConfig)
 */
@Injectable()
export class StorageMigrationService {
  private readonly logger = new Logger(StorageMigrationService.name);
  private readonly eventBus = new EventEmitter();
  private readonly activeJobs = new Map<string, JobControl>();

  /** worker 并发数 */
  private static readonly CONCURRENCY = 5;
  /** 创建 items 时的批量大小 */
  private static readonly BATCH_SIZE = 100;
  /** 每次拉取待处理 items 的数量 */
  private static readonly PULL_BATCH = 50;
  /** 单文件最大重试次数 */
  private static readonly MAX_RETRIES = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ─────────────────── Job 管理 ───────────────────

  /**
   * 创建迁移任务
   * - 扫描源 driver 全部 keys,生成 job + items 记录
   * - 不会自动启动,需调用 startJob
   */
  async createJob(dto: CreateMigrationDto): Promise<any> {
    if (dto.fromDriver === dto.toDriver) {
      throw badRequest(ErrorCode.BAD_REQUEST, 'Source and destination driver cannot be the same');
    }

    // 1. 扫描源 driver 文件
    const sourceDriver = this.resolveSourceDriver(dto.fromDriver);
    const files: Array<{ storageKey: string; size: number }> = [];

    for await (const batch of sourceDriver.listAllKeys(dto.filter?.prefix)) {
      for (const obj of batch) {
        files.push({ storageKey: obj.key, size: Number(obj.size) });
      }
    }

    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

    // 2. 创建 job
    const job = await this.prisma.migrationJob.create({
      data: {
        fromDriver: dto.fromDriver,
        toDriver: dto.toDriver,
        totalFiles: files.length,
        totalBytes: BigInt(totalBytes),
        createdBy: dto.createdBy,
        status: 'pending',
      },
    });

    // 3. 批量创建 items
    const batchSize = StorageMigrationService.BATCH_SIZE;
    for (let i = 0; i < files.length; i += batchSize) {
      const chunk = files.slice(i, i + batchSize);
      await this.prisma.migrationJobItem.createMany({
        data: chunk.map((f) => ({
          jobId: job.id,
          storageKey: f.storageKey,
          size: BigInt(f.size),
          status: 'pending',
        })),
      });
    }

    this.logger.log(
      `创建迁移任务: ${job.id} (${files.length} 文件, ${(totalBytes / 1024 / 1024).toFixed(2)} MB)`,
    );

    return job;
  }

  /**
   * 启动/恢复任务
   * - 已经在 running 状态时直接返回(幂等)
   * - 后台异步执行 processJob,立即返回
   */
  async startJob(jobId: string): Promise<void> {
    const job = await this.prisma.migrationJob.findUnique({ where: { id: jobId } });
    if (!job) throw notFound(ErrorCode.NOT_FOUND, 'Migration job not found');
    if (job.status === 'running') return;
    if (!['pending', 'paused', 'failed'].includes(job.status)) {
      throw badRequest(ErrorCode.BAD_REQUEST, `Job status is ${job.status}, cannot start`);
    }

    if (!this.activeJobs.has(jobId)) {
      this.activeJobs.set(jobId, { abort: false, paused: false });
    }

    // 后台执行,不阻塞 API 返回
    this.processJob(jobId).catch((err) => {
      this.logger.error(`任务 ${jobId} 异常: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /** 暂停任务 - 当前正在处理的 item 会跑完,后续 item 不再启动 */
  async pauseJob(jobId: string): Promise<void> {
    const ctrl = this.activeJobs.get(jobId);
    if (ctrl) ctrl.paused = true;
    await this.prisma.migrationJob.update({
      where: { id: jobId },
      data: { status: 'paused' },
    });
  }

  /** 取消任务 - 当前正在处理的 item 会跑完,后续 item 标记为 skipped */
  async cancelJob(jobId: string): Promise<void> {
    const ctrl = this.activeJobs.get(jobId);
    if (ctrl) ctrl.abort = true;
    await this.prisma.migrationJob.update({
      where: { id: jobId },
      data: { status: 'cancelled', completedAt: new Date() },
    });
    await this.prisma.migrationJobItem.updateMany({
      where: { jobId, status: 'pending' },
      data: { status: 'skipped' },
    });
  }

  /** 获取任务实时状态(供 SSE 推送) */
  async getJobStatus(jobId: string): Promise<MigrationProgress> {
    const job = await this.prisma.migrationJob.findUnique({
      where: { id: jobId },
      include: { items: { where: { status: 'running' }, take: 1 } },
    });
    if (!job) throw notFound(ErrorCode.NOT_FOUND, 'Migration job not found');

    const percent =
      job.totalFiles > 0 ? (job.completedFiles / job.totalFiles) * 100 : 0;
    const elapsedSec = job.startedAt
      ? (Date.now() - job.startedAt.getTime()) / 1000
      : 0;
    const throughput =
      elapsedSec > 0 ? Number(job.completedBytes) / elapsedSec : 0;
    const remainingBytes = Number(job.totalBytes) - Number(job.completedBytes);
    const eta = throughput > 0 ? remainingBytes / throughput : undefined;

    return {
      jobId: job.id,
      status: job.status,
      totalFiles: job.totalFiles,
      completedFiles: job.completedFiles,
      failedFiles: job.failedFiles,
      skippedFiles: job.skippedFiles,
      percent: Math.round(percent * 100) / 100,
      currentFile: job.items[0]?.storageKey,
      throughput: Math.round(throughput),
      eta: eta ? Math.round(eta) : undefined,
    };
  }

  /** 列出最近的任务(按创建时间倒序) */
  async listJobs(filter?: { status?: string }): Promise<any[]> {
    return this.prisma.migrationJob.findMany({
      where: filter?.status ? { status: filter.status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * 监听进度事件
   * @returns 取消订阅的函数
   */
  onProgress(callback: (progress: MigrationProgress) => void): () => void {
    const handler = (progress: MigrationProgress) => callback(progress);
    this.eventBus.on('progress', handler);
    return () => this.eventBus.off('progress', handler);
  }

  // ─────────────────── 核心 worker ───────────────────

  /**
   * 后台 worker 主循环
   * - 拉取 pending items,按并发度分批处理
   * - 每个 item 完成后写入 MigrationJobItem + 累加 MigrationJob 计数
   * - 退出条件:queue 空 或 ctrl.abort
   * - 注意:本实现一次性把待处理 items 拉入内存(数量=PULL_BATCH*2),
   *   大量数据场景可改造为分段拉取
   */
  private async processJob(jobId: string): Promise<void> {
    let ctrl = this.activeJobs.get(jobId);
    if (!ctrl) {
      ctrl = { abort: false, paused: false };
      this.activeJobs.set(jobId, ctrl);
    }
    ctrl.abort = false;
    ctrl.paused = false;

    await this.prisma.migrationJob.update({
      where: { id: jobId },
      data: { status: 'running', startedAt: new Date() },
    });

    this.logger.log(`任务 ${jobId} 开始执行`);

    const sourceDriver = await this.getSourceDriverByJob(jobId);
    const destDriver = await this.getDestDriverByJob(jobId);

    const CONCURRENCY = StorageMigrationService.CONCURRENCY;
    const PULL_BATCH = StorageMigrationService.PULL_BATCH;
    const MAX_RETRIES = StorageMigrationService.MAX_RETRIES;

    const processOne = async (item: { id: string; storageKey: string; size: bigint; attempts: number }) => {
      if (ctrl!.abort || ctrl!.paused) return false;
      try {
        // 标记为 running 并累加重试次数
        await this.prisma.migrationJobItem.update({
          where: { id: item.id },
          data: {
            status: 'running',
            startedAt: new Date(),
            attempts: { increment: 1 },
          },
        });
        // 显式变量规避 lint: updated 字段确实会更新
        void item;

        // 读取源文件
        const buffer = await sourceDriver.readFile(item.storageKey);
        if (!buffer) {
          throw new Error('源文件不存在或已删除');
        }

        // 写入目标
        const contentType = this.guessContentType(item.storageKey);
        await destDriver.putBuffer(item.storageKey, buffer, contentType);

        // 计算 MD5 校验值
        const md5 = createHash('md5').update(buffer).digest('hex');

        // 标记 item 完成
        await this.prisma.migrationJobItem.update({
          where: { id: item.id },
          data: {
            status: 'completed',
            completedAt: new Date(),
            checksum: md5,
          },
        });

        // 累加 job 计数
        await this.prisma.migrationJob.update({
          where: { id: jobId },
          data: {
            completedFiles: { increment: 1 },
            completedBytes: { increment: item.size },
          },
        });

        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`迁移文件 ${item.storageKey} 失败: ${msg}`);

        const newAttempts = item.attempts + 1;
        const giveUp = newAttempts >= MAX_RETRIES;

        await this.prisma.migrationJobItem.update({
          where: { id: item.id },
          data: {
            status: giveUp ? 'failed' : 'pending',
            errorMessage: msg,
          },
        });

        if (giveUp) {
          await this.prisma.migrationJob.update({
            where: { id: jobId },
            data: { failedFiles: { increment: 1 } },
          });
        }
        return false;
      }
    };

    // 持续拉取 + 处理,直到 abort 或所有 item 走完
    while (!ctrl.abort) {
      if (ctrl.paused) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      const pendingItems = await this.prisma.migrationJobItem.findMany({
        where: { jobId, status: 'pending' },
        take: PULL_BATCH,
        orderBy: { createdAt: 'asc' },
      });

      if (pendingItems.length === 0) break;

      // 复用 processOne
      const items = pendingItems;
      for (let i = 0; i < items.length && !ctrl.abort && !ctrl.paused; i += CONCURRENCY) {
        if (ctrl.abort || ctrl.paused) break;
        const batch = items.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map((it) => processOne(it as any)),
        );
        // 发送进度事件
        const progress = await this.getJobStatus(jobId);
        this.eventBus.emit('progress', progress);
      }
    }

    if (!ctrl.abort) {
      await this.prisma.migrationJob.update({
        where: { id: jobId },
        data: { status: 'completed', completedAt: new Date() },
      });
      this.logger.log(`任务 ${jobId} 完成`);
    }

    this.activeJobs.delete(jobId);
  }

  // ─────────────────── 校验 ───────────────────

  /**
   * 校验迁移结果 - 字节级 diff
   * @param mode 'sample' 取前 50 条(默认) / 'full' 校验所有
   */
  async verifyJob(
    jobId: string,
    mode: 'sample' | 'full' = 'sample',
  ): Promise<VerifyResult> {
    const items = await this.prisma.migrationJobItem.findMany({
      where: { jobId, status: 'completed' },
    });

    const sourceDriver = await this.getSourceDriverByJob(jobId);
    const destDriver = await this.getDestDriverByJob(jobId);

    const sampleSize = mode === 'sample' ? Math.min(50, items.length) : items.length;
    const sample = items.slice(0, sampleSize);

    let matched = 0;
    let mismatched = 0;
    let missing = 0;
    const details: VerifyResult['details'] = [];

    for (const item of sample) {
      try {
        const srcBuf = await sourceDriver.readFile(item.storageKey);
        const destBuf = await destDriver.readFile(item.storageKey);

        if (!srcBuf) {
          missing++;
          mismatched++;
          details.push({ storageKey: item.storageKey, status: 'missing' });
          continue;
        }
        if (!destBuf) {
          missing++;
          details.push({ storageKey: item.storageKey, status: 'missing' });
          continue;
        }

        const srcMd5 = createHash('md5').update(srcBuf).digest('hex');
        const destMd5 = createHash('md5').update(destBuf).digest('hex');

        if (srcMd5 === destMd5) {
          matched++;
          details.push({ storageKey: item.storageKey, status: 'matched' });
        } else {
          mismatched++;
          details.push({ storageKey: item.storageKey, status: 'mismatched' });
        }
      } catch (err) {
        mismatched++;
        details.push({ storageKey: item.storageKey, status: 'mismatched' });
      }
    }

    return { verified: sample.length, matched, mismatched, missing, details };
  }

  // ─────────────────── Helpers ───────────────────

  /** 根据 job 的 fromDriver 字段取出对应的 driver 实例 */
  private async getSourceDriverByJob(jobId: string): Promise<IStorageDriver> {
    const job = await this.prisma.migrationJob.findUnique({ where: { id: jobId } });
    if (!job) throw notFound(ErrorCode.NOT_FOUND, 'Migration job not found');
    return this.resolveSourceDriver(job.fromDriver as StorageDriverName);
  }

  /** 根据 job 的 toDriver 字段取出对应的 driver 实例 */
  private async getDestDriverByJob(jobId: string): Promise<IStorageDriver> {
    const job = await this.prisma.migrationJob.findUnique({ where: { id: jobId } });
    if (!job) throw notFound(ErrorCode.NOT_FOUND, 'Migration job not found');
    return this.resolveDestDriver(job.toDriver as StorageDriverName);
  }

  /** 解析源 driver - 仅支持当前 primary / secondary 已加载的 driver */
  private resolveSourceDriver(name: StorageDriverName): IStorageDriver {
    const config = this.storage.getConfig();
    if (config.primary.driver === name) {
      return this.storage.getPrimary();
    }
    const secondary = this.storage.getSecondary();
    if (secondary && secondary.name === name) {
      return secondary;
    }
    throw badRequest(
      ErrorCode.BAD_REQUEST,
      `Source driver ${name} is not configured (only primary/secondary migration is supported)`,
    );
  }

  /** 解析目标 driver */
  private resolveDestDriver(name: StorageDriverName): IStorageDriver {
    const config = this.storage.getConfig();
    if (config.primary.driver === name) {
      return this.storage.getPrimary();
    }
    const secondary = this.storage.getSecondary();
    if (secondary && secondary.name === name) {
      return secondary;
    }
    throw badRequest(
      ErrorCode.BAD_REQUEST,
      `Destination driver ${name} is not configured (only primary/secondary migration is supported)`,
    );
  }

  /** 简单的内容类型嗅探(基于文件扩展名) */
  private guessContentType(key: string): string {
    const ext = key.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      mp4: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      pdf: 'application/pdf',
      json: 'application/json',
      txt: 'text/plain',
      html: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
    };
    return map[ext] || 'application/octet-stream';
  }
}
