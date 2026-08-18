import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Logger, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ResourceService } from '../../assets/resource.service';
import { MinioService } from '../../assets/minio.service';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/projects')
export class CanvasAdminController {
  private readonly logger = new Logger(CanvasAdminController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resourceService: ResourceService,
    private readonly minioService: MinioService,
  ) {}

  /** 项目统计 */
  @Get('stats')
  @HttpCode(HttpStatus.OK)
  async getStats() {
    const total = await this.prisma.project.count();
    return { total };
  }

  /**
   * 查看指定用户的项目列表（分页）
   * @deprecated 请使用 GET /admin/resources/list?userId=xxx&category=project 替代
   */
  @Get('user/:userId')
  @HttpCode(HttpStatus.OK)
  async listUserProjects(
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const take = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where: { ownerId: userId },
        orderBy: { updatedAt: 'desc' },
        take,
        skip,
        select: {
          id: true,
          title: true,
          version: true,
          tags: true,
          isPublic: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.project.count({ where: { ownerId: userId } }),
    ]);
    return { items, total, page: Math.max(Number(page) || 1, 1), pageSize: take };
  }

  /** 删除单个画布(管理员) */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteProject(@Param('id') id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: { id: true, title: true, scene: true, ownerId: true },
    });
    if (!project) {
      throw new Error('画布不存在');
    }

    // 减少场景中所有资源的引用计数
    const keys = this.resourceService.extractStorageKeysFromScene(project.scene);
    for (const key of keys) {
      await this.resourceService.decrementRef(key);
    }

    await this.prisma.project.delete({ where: { id } });

    // 尝试删除快照文件
    try {
      const STORAGE_ROOT = this.minioService.getStorageRoot();
      const snapshotPath = path.join(STORAGE_ROOT, 'resources', 'front', 'canvases', project.ownerId, project.id, 'scene.json');
      await fs.unlink(snapshotPath);
    } catch {
      // 快照文件不存在则忽略
    }

    this.logger.log(`[Admin] 删除用户${project.ownerId}的画布: ${project.title}`);
    return { message: '画布已删除' };
  }

  /** 批量删除画布 */
  @Post('batch-delete')
  @HttpCode(HttpStatus.OK)
  async deleteProjects(@Body() body: { ids: string[] }) {
    if (!body.ids || body.ids.length === 0) {
      throw new Error('ids 不能为空');
    }

    const projects = await this.prisma.project.findMany({
      where: { id: { in: body.ids } },
      select: { id: true, title: true, scene: true, ownerId: true },
    });

    let deletedCount = 0;
    for (const project of projects) {
      try {
        const keys = this.resourceService.extractStorageKeysFromScene(project.scene);
        for (const key of keys) {
          await this.resourceService.decrementRef(key);
        }
        await this.prisma.project.delete({ where: { id: project.id } });
        try {
          const STORAGE_ROOT = this.minioService.getStorageRoot();
          const snapshotPath = path.join(STORAGE_ROOT, 'resources', 'front', 'canvases', project.ownerId, project.id, 'scene.json');
          await fs.unlink(snapshotPath);
        } catch {
          // 快照文件不存在则忽略
        }
        deletedCount++;
      } catch (err) {
        this.logger.warn(`[Admin] 批量删除画布失败(id=${project.id}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logger.log(`[Admin] 批量删除画布完成: ${deletedCount}/${projects.length} 个`);
    return { message: `已删除 ${deletedCount} 个画布`, deletedCount };
  }

  /** 清空指定用户的所有画布 */
  @Post('user/:userId/clear')
  @HttpCode(HttpStatus.OK)
  async clearUserProjects(@Param('userId') userId: string) {
    const projects = await this.prisma.project.findMany({
      where: { ownerId: userId },
      select: { id: true, title: true, scene: true, ownerId: true },
    });

    let deletedCount = 0;
    for (const project of projects) {
      try {
        const keys = this.resourceService.extractStorageKeysFromScene(project.scene);
        for (const key of keys) {
          await this.resourceService.decrementRef(key);
        }
        await this.prisma.project.delete({ where: { id: project.id } });
        try {
          const STORAGE_ROOT = this.minioService.getStorageRoot();
          const snapshotPath = path.join(STORAGE_ROOT, 'resources', 'front', 'canvases', project.ownerId, project.id, 'scene.json');
          await fs.unlink(snapshotPath);
        } catch {
          // 快照文件不存在则忽略
        }
        deletedCount++;
      } catch (err) {
        this.logger.warn(`[Admin] 清空画布失败(id=${project.id}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logger.log(`[Admin] 清空用户${userId}画布完成: ${deletedCount}/${projects.length} 个`);
    return { message: `已清空 ${deletedCount} 个画布`, deletedCount };
  }

  /**
   * 获取指定画布的完整场景图(节点树结构),用于后台查看画布数据结构
   * GET /admin/projects/:id/graph
   */
  @Get(':id/graph')
  @HttpCode(HttpStatus.OK)
  async getProjectGraph(@Param('id') id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        scene: true,
        connections: true,
        viewport: true,
        ownerId: true,
        version: true,
        updatedAt: true,
      },
    });
    if (!project) {
      throw new Error('画布不存在');
    }

    const scene = Array.isArray(project.scene) ? (project.scene as Array<Record<string, unknown>>) : [];
    const connections = Array.isArray(project.connections) ? project.connections : [];

    // 构建节点树: 基于 parentId 关联父子关系
    const nodes = scene.map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title ?? '',
      parentId: node.parentId ?? null,
      data: node.data ?? null,
      hidden: node.hidden ?? false,
      locked: node.locked ?? false,
      updatedAt: node.updatedAt ?? null,
    }));

    return {
      project: {
        id: project.id,
        title: project.title,
        ownerId: project.ownerId,
        version: project.version,
        updatedAt: project.updatedAt,
      },
      totalNodes: nodes.length,
      nodes,
      connections,
    };
  }
}
