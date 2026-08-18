import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ResourceService } from '../assets/resource.service';
import { MinioService } from '../assets/minio.service';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * 回收站过期用户清理服务 - 永久删除回收站中超过保留期的用户及其关联数据。
 * 定时触发由 GcScheduleService 管理(settings 模块),不再使用 @Cron 装饰器。
 *
 * 保留期通过 ScheduleConfig.userCleanup.retentionDays 配置(默认 30 天)。
 */
@Injectable()
export class UserCleanupService {
  private readonly logger = new Logger(UserCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resourceService: ResourceService,
    private readonly minioService: MinioService,
  ) {}

  /**
   * 执行回收站清理
   * @param retentionDays 保留天数(默认 30)
   */
  async cleanupExpiredUsers(retentionDays = 30): Promise<number> {
    const cutoff = new Date(
      Date.now() - retentionDays * 24 * 60 * 60 * 1000,
    );

    this.logger.log(`回收站清理任务启动,清理 deletedAt < ${cutoff.toISOString()} 的用户(retentionDays=${retentionDays})...`);

    const expiredUsers = await this.prisma.user.findMany({
      where: {
        deletedAt: { not: null, lt: cutoff },
      },
      select: { id: true, username: true, email: true },
    });

    if (expiredUsers.length === 0) {
      this.logger.log('没有过期用户需要清理');
      return 0;
    }

    let deleted = 0;
    for (const user of expiredUsers) {
      try {
        await this.cleanupUserResources(user.id);
        await this.prisma.user.delete({ where: { id: user.id } });
        deleted++;
        this.logger.log(`过期用户已永久删除: "${user.username}"(${user.id})`);
      } catch (err) {
        this.logger.error(
          `清理过期用户失败(id=${user.id}, username=${user.username}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    this.logger.log(`回收站清理完成: 删除了 ${deleted}/${expiredUsers.length} 个过期用户`);
    return deleted;
  }

  /** 内部:清理用户关联的所有资源文件 */
  private async cleanupUserResources(userId: string): Promise<void> {
    // 1. 获取所有 Asset → 递减 Resource refCount
    const assets = await this.prisma.asset.findMany({
      where: { ownerId: userId },
      select: { storageKey: true },
    });
    const storageKeys = assets.map((a) => a.storageKey).filter(Boolean);
    for (const key of storageKeys) {
      await this.resourceService.decrementRef(key);
    }

    // 2. 删除画布快照文件
    const projects = await this.prisma.project.findMany({
      where: { ownerId: userId },
      select: { id: true, ownerId: true },
    });
    const storageRoot = this.minioService.getStorageRoot();
    for (const project of projects) {
      const snapshotDir = path.join(storageRoot, 'resources', 'front', 'canvases', project.ownerId, project.id);
      try {
        await fs.rm(snapshotDir, { recursive: true, force: true });
      } catch {
        // 文件不存在则忽略
      }
    }
  }
}
