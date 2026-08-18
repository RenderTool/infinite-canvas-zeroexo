import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ResourceClassificationService } from './resource-classification.service';

/**
 * 配置驱动的资源分类查询控制器
 *
 * 提供两个端点：
 *   1. GET /admin/resource-classification  — 前端拉取分类配置（列定义、筛选选项等）
 *   2. GET /admin/resources/list            — 统一资源查询（旧 assets.admin / projects admin 的替代）
 *
 * 此控制器完全由 resource-classification.config.ts 驱动，
 * 加新分类只需改配置文件，无需新增/修改 Controller 代码。
 */
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class ResourceClassificationController {
  constructor(
    private readonly classificationService: ResourceClassificationService,
  ) {}

  /**
   * 获取资源分类配置
   *
   * 返回完整的 categories 定义，包括：
   * - display（label、icon、emptyText）
   * - columns（列定义 + render 方式）
   * - filters（子筛选选项）
   *
   * 前端根据此配置动态渲染 Tab / Filter / Column。
   */
  @Get('resource-classification')
  @HttpCode(HttpStatus.OK)
  getConfig() {
    return this.classificationService.getConfig();
  }

  /**
   * 统一资源列表查询
   *
   * 替代旧的：
   *   GET /admin/resources/user/:userId  （assets.admin.controller.ts）
   *   GET /admin/projects/user/:userId   （canvas.admin.controller.ts）
   *
   * @param userId  - 用户 ID
   * @param category - 分类标识（material / ai-generation / project / prompt）
   * @param kind    - 子类型筛选（image/video/audio/text）
   * @param type    - project 分类的子类型筛选（canvas）
   * @param page    - 页码
   * @param pageSize - 每页条数
   */
  @Get('resources/list')
  @HttpCode(HttpStatus.OK)
  async listResources(
    @Query('userId') userId: string,
    @Query('category') category: string,
    @Query('kind') kind?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    if (!userId) throw new Error('userId 不能为空');
    if (!category) throw new Error('category 不能为空');

    const filters: Record<string, string | undefined> = {};
    if (kind) filters['kind'] = kind;
    if (type) filters['type'] = type;

    const pageNum = Math.max(Number(page) || 1, 1);
    const pageSizeNum = Math.min(Math.max(Number(pageSize) || 20, 1), 100);

    return this.classificationService.queryByCategory(
      userId,
      category,
      filters,
      pageNum,
      pageSizeNum,
    );
  }
}
