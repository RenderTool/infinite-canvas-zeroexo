/**
 * Resources Admin Controller - 资源管理后台接口
 *
 * @deprecated 请使用 ResourceClassificationController 的统一查询 API：
 *   GET /admin/resources/list?userId=xxx&category=material
 *
 * 保留此 Controller 仅用于向后兼容（presign / create / delete / cleanup-orphans 等写操作仍需使用）。
 *
 * 接口:
 *   POST   /api/admin/resources/cleanup-orphans           清理孤儿资源
 *   GET    /api/admin/resources/user/:userId               查看用户资源列表 (已废弃,请使用新 API)
 *   POST   /api/admin/resources/user/:userId/presign       获取预签名上传 URL
 *   POST   /api/admin/resources/user/:userId/asset         创建资产元数据
 *   DELETE /api/admin/resources/:id                        删除资产
 */

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Logger, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { MinioService } from './minio.service';
import { ResourceService } from './resource.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AssetsService } from './assets.service';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/resources')
export class AssetsAdminController {
  private readonly logger = new Logger(AssetsAdminController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minioService: MinioService,
    private readonly resourceService: ResourceService,
    private readonly assetsService: AssetsService,
  ) {}

  // ========== 用户资源管理 ==========

  /** 查看指定用户的资源列表（分页） */
  @Get('user/:userId')
  @HttpCode(HttpStatus.OK)
  async listUserAssets(
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('category') category?: string,
    @Query('kind') kind?: string,
  ) {
    const take = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    // 根据 category 切换 storageKey 前缀，确保不同类型资源正确筛选
    const isAiGeneration = category === 'ai-generation' || category === 'ai-test';
    const storageKeyPrefix = isAiGeneration
      ? 'resources/admin/ai-gen/'
      : 'resources/front/assets/';

    // AI 生成标签页：展示所有 storageKey 以 ai-gen/ 开头的资源（不限 category 字段）
    // 这样用户通过 API 生成的（category=user）和管理员测试生成的（category=ai-generation）
    // 都能归入 AI 生成标签页
    const where: Record<string, unknown> = {
      ownerId: userId,
      storageKey: { startsWith: storageKeyPrefix },
    };
    if (!isAiGeneration && category) {
      where.category = category;
    }
    if (kind) {
      where.kind = kind;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        select: {
          id: true,
          kind: true,
          filename: true,
          storageKey: true,
          mimeType: true,
          size: true,
          width: true,
          height: true,
          duration: true,
          tags: true,
          createdAt: true,
        },
      }),
      this.prisma.asset.count({ where }),
    ]);

    // 为 AI 生成资源计算来源标记
    const enrichedItems = isAiGeneration
      ? items.map((item) => ({
          ...item,
          source: (item.tags as string[])?.includes('devtest')
            ? '后台管理测试'
            : 'AI 生成',
        }))
      : items;

    return { items: enrichedItems, total, page: Math.max(Number(page) || 1, 1), pageSize: take };
  }

  /** 为指定用户获取预签名上传 URL */
  @Post('user/:userId/presign')
  @HttpCode(HttpStatus.OK)
  async presignForUser(
    @Param('userId') userId: string,
    @Body() body: { filename: string; mimeType: string; size: number; contentHash?: string; scope?: 'private' | 'public' },
  ) {
    return this.assetsService.presign(userId, {
      filename: body.filename,
      mimeType: body.mimeType,
      size: body.size,
      contentHash: body.contentHash,
      scope: body.scope,
    });
  }

  /** 为指定用户创建资产元数据(上传完成后调用) */
  @Post('user/:userId/asset')
  @HttpCode(HttpStatus.CREATED)
  async createAssetForUser(
    @Param('userId') userId: string,
    @Body()
    body: {
      kind: string;
      filename: string;
      storageKey: string;
      mimeType: string;
      size: number;
      width?: number;
      height?: number;
      duration?: number;
      thumbnailKey?: string;
      text?: string;
      tags?: string[];
      category?: string;
    },
  ) {
    return this.assetsService.create(userId, {
      kind: body.kind,
      filename: body.filename,
      storageKey: body.storageKey,
      mimeType: body.mimeType,
      size: body.size,
      ...(body.width !== undefined ? { width: body.width } : {}),
      ...(body.height !== undefined ? { height: body.height } : {}),
      ...(body.duration !== undefined ? { duration: body.duration } : {}),
      ...(body.thumbnailKey !== undefined ? { thumbnailKey: body.thumbnailKey } : {}),
      ...(body.text !== undefined ? { text: body.text } : {}),
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      ...((body as any).category !== undefined ? { category: (body as any).category } : {}),
    });
  }

  /** 删除指定资产(管理员可删除任意用户的资产) */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteAsset(@Param('id') id: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      select: { id: true, ownerId: true, storageKey: true, filename: true },
    });
    if (!asset) {
      throw new Error('资产不存在');
    }

    // 减少资源引用计数
    await this.resourceService.decrementRef(asset.storageKey);
    await this.prisma.asset.delete({ where: { id } });

    this.logger.log(`[Admin] 删除用户${asset.ownerId}的资产: ${asset.filename}`);
    return { message: '资产已删除' };
  }

  /** 批量删除资产 */
  @Post('batch-delete')
  @HttpCode(HttpStatus.OK)
  async deleteAssets(@Body() body: { ids: string[] }) {
    if (!body.ids || body.ids.length === 0) {
      throw new Error('ids 不能为空');
    }

    const assets = await this.prisma.asset.findMany({
      where: { id: { in: body.ids } },
      select: { id: true, storageKey: true, filename: true, ownerId: true },
    });

    let deletedCount = 0;
    for (const asset of assets) {
      try {
        await this.resourceService.decrementRef(asset.storageKey);
        await this.prisma.asset.delete({ where: { id: asset.id } });
        deletedCount++;
      } catch (err) {
        this.logger.warn(`[Admin] 批量删除资产失败(id=${asset.id}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logger.log(`[Admin] 批量删除完成: ${deletedCount}/${assets.length} 个`);
    return { message: `已删除 ${deletedCount} 个资产`, deletedCount };
  }

  /** 清空指定用户的所有资产 */
  @Post('user/:userId/clear')
  @HttpCode(HttpStatus.OK)
  async clearUserAssets(@Param('userId') userId: string) {
    const assets = await this.prisma.asset.findMany({
      where: { ownerId: userId },
      select: { id: true, storageKey: true, filename: true },
    });

    let deletedCount = 0;
    for (const asset of assets) {
      try {
        await this.resourceService.decrementRef(asset.storageKey);
        await this.prisma.asset.delete({ where: { id: asset.id } });
        deletedCount++;
      } catch (err) {
        this.logger.warn(`[Admin] 清空资产失败(id=${asset.id}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logger.log(`[Admin] 清空用户${userId}资产完成: ${deletedCount}/${assets.length} 个`);
    return { message: `已清空 ${deletedCount} 个资产`, deletedCount };
  }

  // ========== 原有清理孤儿资源接口 ==========

  /**
   * 清理孤儿资源
   *
   * 扫描 storage/resources/ 下所有文件,检查是否被 Asset/Project/Resource 引用。
   * 未被引用的文件视为孤儿,可删除以回收存储空间。
   *
   * 安全机制:
   * - 跳过最近 1 小时内修改的文件(避免清理正在同步的文件)
   * - 只清理 storage/resources/ 目录
   * - 设置 body.dryRun = true 仅预览不删除
   */
  @Post('cleanup-orphans')
  async cleanupOrphanAssets(@Body() body: { dryRun?: boolean }) {
    const dryRun = body?.dryRun === true;
    const STORAGE_ROOT = this.minioService.getStorageRoot();
    const RESOURCES_DIR = path.join(STORAGE_ROOT, 'resources');
    const RECENT_THRESHOLD_MS = 60 * 60 * 1000;

    this.logger.log(`[Admin] 开始${dryRun ? '预览' : '清理'}孤儿资源...`);

    // 1. 收集所有被引用的 storageKey
    const assets = await this.prisma.asset.findMany({ select: { storageKey: true } });
    const assetKeys = new Set(assets.map(a => a.storageKey));
    this.logger.log(`[Admin] Asset.storageKey: ${assetKeys.size} 个`);

    const projects = await this.prisma.project.findMany({ select: { scene: true } });
    const projectKeys = new Set<string>();
    for (const p of projects) {
      const scene = p.scene as unknown;
      if (!Array.isArray(scene)) continue;
      for (const node of scene) {
        if (!node || typeof node !== 'object' || !('data' in node)) continue;
        const data = (node as { data?: { storageKey?: string } }).data;
        if (data?.storageKey && typeof data.storageKey === 'string') {
          projectKeys.add(data.storageKey);
        }
      }
    }
    this.logger.log(`[Admin] Project.scene storageKey: ${projectKeys.size} 个`);

    const resources = await this.prisma.resource.findMany({ select: { storageKey: true } });
    const resourceKeys = new Set(resources.map(r => r.storageKey));
    this.logger.log(`[Admin] Resource.storageKey: ${resourceKeys.size} 个`);

    const referencedKeys = new Set<string>([...assetKeys, ...projectKeys, ...resourceKeys]);
    this.logger.log(`[Admin] 合计被引用: ${referencedKeys.size} 个`);

    // 2. 扫描 storage/resources/ 目录
    let files: string[] = [];
    try {
      await fs.access(RESOURCES_DIR);
      files = await this.listFilesRecursive(RESOURCES_DIR);
    } catch {
      return { success: true, dryRun, referencedCount: referencedKeys.size, orphanCount: 0, orphanSize: 0, deletedCount: 0, deletedSize: 0, message: 'resources 目录不存在,无需清理' };
    }
    this.logger.log(`[Admin] 发现 ${files.length} 个文件`);

    // 3. 识别孤儿文件
    const now = Date.now();
    let referencedCount = 0;
    let orphanCount = 0;
    let referencedSize = 0;
    let orphanSize = 0;
    const orphansToDelete: string[] = [];

    for (const file of files) {
      const stat = await fs.stat(file);
      // 跳过最近修改的文件
      if (now - stat.mtimeMs < RECENT_THRESHOLD_MS) continue;

      const relativeKey = path.relative(STORAGE_ROOT, file).replace(/\\/g, '/');

      // 跳过品牌配置文件夹(不在资源引用追踪体系内)
      if (relativeKey.startsWith('resources/public/branding/')) {
        referencedCount++;
        referencedSize += stat.size;
        continue;
      }

      if (referencedKeys.has(relativeKey)) {
        referencedCount++;
        referencedSize += stat.size;
      } else {
        orphanCount++;
        orphanSize += stat.size;
        orphansToDelete.push(file);
      }
    }

    // 4. 预览模式:不执行删除
    let deletedCount = 0;
    let deletedSize = 0;

    if (!dryRun) {
      for (const file of orphansToDelete) {
        try {
          const stat = await fs.stat(file);
          await fs.unlink(file);
          deletedCount++;
          deletedSize += stat.size;
        } catch (err) {
          this.logger.warn(`[Admin] 删除失败: ${file} - ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 5. 清理空目录
      await this.cleanupEmptyDirs(RESOURCES_DIR);
    }

    const message = dryRun
      ? `扫描完成,发现 ${orphanCount} 个孤儿文件(${this.formatSize(orphanSize)}),可回收空间`
      : `已删除 ${deletedCount} 个孤儿文件,回收 ${this.formatSize(deletedSize)} 空间`;
    this.logger.log(`[Admin] ${message}`);

    return {
      success: true,
      dryRun,
      referencedCount,
      referencedSize,
      orphanCount,
      orphanSize,
      deletedCount,
      deletedSize,
      message,
    };
  }

  private async listFilesRecursive(dir: string): Promise<string[]> {
    const result: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        result.push(...(await this.listFilesRecursive(full)));
      } else if (entry.isFile()) {
        result.push(full);
      }
    }
    return result;
  }

  private async cleanupEmptyDirs(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const full = path.join(dir, entry.name);
        await this.cleanupEmptyDirs(full);
        const subEntries = await fs.readdir(full);
        if (subEntries.length === 0) {
          await fs.rmdir(full);
        }
      }
    }
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
}
