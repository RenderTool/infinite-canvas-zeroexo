import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { badRequest, notFound } from '../../common/errors/app-exception.js';
import { Response } from 'express';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import sharp from 'sharp';
import { ApiProvidersService } from './api-providers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditLogService } from '../audit/audit-log.service';
import { AI_BRAND_PRESETS } from './presets/ai-provider-presets';
import { EMAIL_PROVIDER_PRESETS } from './presets/email-provider-presets';
import { OAUTH_PROVIDER_PRESETS } from './presets/oauth-provider-presets';
import { recommendTemplate } from '../ai-generate/templates/built-in-templates';
import { TemplateRegistryService } from '../ai-generate/templates/registry.service';

/**
 * API Provider 管理 Controller(统一入口)
 *
 * 所有路径以 /admin/api-providers 为前缀
 *
 * 权限码:
 * - api:list - 列表/详情
 * - api:manage - 创建/更新/删除
 * - api:test - 测试连接 / 健康检查
 * - api:switch - 切换默认
 * - api:rotate - 轮换凭证(预留)
 * - api:usage - 查看用量
 * - api:health - 查看健康状态
 *
 * 权限策略:
 * - 管理操作 admin 及以上角色均可(@Roles('admin','super_admin'))
 * - 敏感操作(切换默认 / 删除渠道)仅 super_admin(@Roles('super_admin'))
 * - 通过 AdminGuard + RolesGuard 实现访问控制
 */
@Controller('admin/api-providers')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
export class ApiProvidersController {
  constructor(
    private readonly apiProvidersService: ApiProvidersService,
    private readonly auditLog: AuditLogService,
    private readonly templateRegistry: TemplateRegistryService,
  ) {}

  @Get()
  async list(
    @Query('type') type?: string,
    @Query('provider') provider?: string,
    @Query('enabled') enabled?: string,
  ) {
    const items = await this.apiProvidersService.list({
      type,
      provider,
      enabled: enabled === undefined ? undefined : enabled === 'true',
    });
    return { items };
  }

  /**
   * 预置服务商模板(供前端动态表单)
   * GET /admin/api-providers/presets
   */
  @Get('presets')
  presets() {
    return {
      items: [
        ...AI_BRAND_PRESETS.map((p) => ({
          provider: p.provider,
          label: p.label,
          type: 'ai',
          official: p.official,
          apiFormat: p.apiFormat,
          defaultBaseUrl: p.defaultBaseUrl,
          color: p.color,
          description: p.description,
          capabilities: p.capabilities,
        })),
        ...EMAIL_PROVIDER_PRESETS,
        ...OAUTH_PROVIDER_PRESETS,
      ],
    };
  }

  /**
   * 获取指定模型类型的可用模板列表
   * GET /admin/api-providers/templates?type=image
   * 来源：模型模板库（内置 definitions/ + 用户导入 DB），带 isBuiltIn/enabled 标记
   */
  @Get('templates')
  async getTemplates(@Query('type') type: string) {
    const all = await this.templateRegistry.list();
    if (!type) {
      return all;
    }
    return all.filter((t) => t.modelType === type);
  }

  /**
   * 推荐匹配的模板
   * GET /admin/api-providers/templates/recommend?modelId=xxx&type=image
   */
  @Get('templates/recommend')
  recommendTemplate(
    @Query('modelId') modelId: string,
    @Query('type') type: string,
  ) {
    return recommendTemplate(modelId, type) || null;
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.apiProvidersService.getById(id);
  }

  @Post()
  @Roles('admin', 'super_admin')
  async create(
    @Body()
    body: {
      name: string;
      provider: string;
      type: string;
      config?: Record<string, any>;
      credentials?: Record<string, any>;
      capabilities?: string[];
      quota?: Record<string, any>;
      enabled?: boolean;
      isDefault?: boolean;
      notes?: string;
    },
  ) {
    const created = await this.apiProvidersService.create(body);
    await this.auditLog.record({
      actorId: 'system',
      actorName: 'system',
      actorRole: 'admin',
      action: 'API_PROVIDER_CREATE',
      targetType: 'PROVIDER',
      targetId: created.id,
      after: { name: created.name, type: created.type, provider: created.provider },
      sensitive: true,
    });
    return created;
  }

  @Patch(':id')
  @Roles('admin', 'super_admin')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      config?: Record<string, any>;
      credentials?: Record<string, any>;
      capabilities?: string[];
      quota?: Record<string, any>;
      enabled?: boolean;
      isDefault?: boolean;
      notes?: string;
    },
  ) {
    const before = await this.apiProvidersService.getById(id);
    const updated = await this.apiProvidersService.update(id, body);
    await this.auditLog.record({
      actorId: 'system',
      actorName: 'system',
      actorRole: 'admin',
      action: 'API_PROVIDER_UPDATE',
      targetType: 'PROVIDER',
      targetId: id,
      before: { name: before.name, enabled: before.enabled, isDefault: before.isDefault },
      after: { name: updated.name, enabled: updated.enabled, isDefault: updated.isDefault },
      sensitive: body.credentials !== undefined || body.isDefault === true,
    });
    return updated;
  }

  @Delete(':id')
  @Roles('super_admin')
  async remove(@Param('id') id: string) {
    const before = await this.apiProvidersService.getById(id);
    // 删除关联的 LOGO 文件
    const logoUrl: string | undefined = (before.config as any)?.logoUrl;
    if (logoUrl && logoUrl.startsWith('/api/admin/api-providers/logo/file/')) {
      const filename = path.basename(logoUrl);
      const filePath = path.resolve(process.cwd(), 'storage', '_sys', 'logos', filename);
      const resolved = path.resolve(filePath);
      if (resolved.startsWith(path.resolve(process.cwd(), 'storage', '_sys', 'logos'))) {
        try {
          await fs.unlink(resolved);
        } catch (err: any) {
          if (err.code !== 'ENOENT') {
            console.warn(`删除 LOGO 文件失败: ${resolved}`, err.message);
          }
        }
      }
    }
    await this.apiProvidersService.remove(id);
    await this.auditLog.record({
      actorId: 'system',
      actorName: 'system',
      actorRole: 'admin',
      action: 'API_PROVIDER_DELETE',
      targetType: 'PROVIDER',
      targetId: id,
      before: { name: before.name, type: before.type, provider: before.provider },
      sensitive: true,
    });
    return { success: true };
  }

  @Post(':id/default')
  @Roles('super_admin')
  async setDefault(@Param('id') id: string) {
    const before = await this.apiProvidersService.getById(id);
    const result = await this.apiProvidersService.setDefault(id);
    await this.auditLog.record({
      actorId: 'system',
      actorName: 'system',
      actorRole: 'admin',
      action: 'API_PROVIDER_SET_DEFAULT',
      targetType: 'PROVIDER',
      targetId: id,
      before: { isDefault: before.isDefault },
      after: { isDefault: true },
      sensitive: true,
    });
    return result;
  }

  @Post(':id/test')
  @Roles('admin', 'super_admin')
  async test(@Param('id') id: string) {
    return this.apiProvidersService.checkHealth(id);
  }

  /**
   * 刷新渠道余额(Plan#17: 调渠道商官方余额 API → 落库 → 返回)
   * POST /admin/api-providers/:id/balance
   */
  @Post(':id/balance')
  @Roles('admin', 'super_admin')
  async refreshBalance(@Param('id') id: string) {
    return this.apiProvidersService.refreshBalance(id);
  }

  @Post(':id/invoke')
  @Roles('admin', 'super_admin')
  async invoke(
    @Param('id') id: string,
    @Body() body: { action: string; params?: Record<string, any> },
  ) {
    return this.apiProvidersService.invokeAction(id, body.action, body.params || {});
  }

  /**
   * 独立连通性测试(无需 DB 记录)
   * POST /admin/api-providers/test-connectivity
   */
  @Post('test-connectivity')
  async testConnectivity(
    @Body() body: { provider: string; config?: Record<string, any>; credentials?: Record<string, any> },
  ) {
    return this.apiProvidersService.testConnectivityDirect(body);
  }

  /**
   * 获取 AI provider 的模型列表并按类型分类
   * POST /admin/api-providers/:id/fetch-models
   * body 可选: { config?: Record<string, any> } 用于覆盖 baseUrl 等配置
   */
  @Post(':id/fetch-models')
  async fetchModels(
    @Param('id') id: string,
    @Body() body?: { config?: Record<string, any> },
  ) {
    return this.apiProvidersService.fetchModels(id, body?.config);
  }

  /**
   * 更新模型分类（用户手动归类）
   * POST /admin/api-providers/:id/model-types
   */
  @Post(':id/model-types')
  @Roles('admin', 'super_admin')
  async updateModelTypes(
    @Param('id') id: string,
    @Body() body: { modelTypes: Record<string, 'llm' | 'image' | 'video' | 'audio'> },
  ) {
    return this.apiProvidersService.updateModelTypes(id, body.modelTypes);
  }

  /**
   * 自动归类模型（基于模型名称模式匹配）
   * POST /admin/api-providers/:id/auto-classify
   */
  @Post(':id/auto-classify')
  @Roles('admin', 'super_admin')
  async autoClassifyModels(
    @Param('id') id: string,
    @Body() body: { modelIds: string[] },
  ) {
    return this.apiProvidersService.autoClassifyModels(id, body.modelIds);
  }

  /**
   * 手动添加自定义模型
   * POST /admin/api-providers/:id/custom-models
   */
  @Post(':id/custom-models')
  @Roles('admin', 'super_admin')
  async addCustomModel(
    @Param('id') id: string,
    @Body() body: { modelId: string; modelName?: string; type: 'llm' | 'image' | 'video' | 'audio' },
  ) {
    return this.apiProvidersService.addCustomModel(id, body);
  }

  /**
   * 删除自定义模型
   * DELETE /admin/api-providers/:id/custom-models/:modelId
   */
  @Delete(':id/custom-models/:modelId')
  @Roles('admin', 'super_admin')
  async removeCustomModel(
    @Param('id') id: string,
    @Param('modelId') modelId: string,
  ) {
    return this.apiProvidersService.removeCustomModel(id, modelId);
  }

  /**
   * 获取模型的 capability
   * GET /admin/api-providers/:id/model-capability/:modelId
   */
  @Get(':id/model-capability/:modelId')
  async getModelCapability(
    @Param('id') id: string,
    @Param('modelId') modelId: string,
  ) {
    const result = await this.apiProvidersService.getModelCapability(id, modelId);
    if (!result) {
      throw notFound('NOT_FOUND', 'Model capability not found');
    }
    return result;
  }

  /**
   * 保存模型的参数配置
   * POST /admin/api-providers/:id/model-schema/:modelId
   * Body: PersistedParamConfig
   */
  @Post(':id/model-schema/:modelId')
  @Roles('admin', 'super_admin')
  async saveModelSchema(
    @Param('id') id: string,
    @Param('modelId') modelId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.apiProvidersService.saveModelSchema(id, modelId, body);
  }

  /**
   * 获取指定 provider 的品牌配置包列表
   * GET /admin/api-providers/:id/brand-packs
   */
  @Get(':id/brand-packs')
  async getBrandPacks(@Param('id') id: string) {
    const provider = await this.apiProvidersService.getById(id);
    const { getPacksByProvider } = require('../ai-generate/templates/brand-packs');
    return getPacksByProvider(provider.provider);
  }

  /**
   * 应用品牌配置包
   * POST /admin/api-providers/:id/brand-packs/:packId/apply
   */
  @Post(':id/brand-packs/:packId/apply')
  async applyBrandPack(
    @Param('id') id: string,
    @Param('packId') packId: string,
  ) {
    const provider = await this.apiProvidersService.getById(id);

    const { getPackById } = require('../ai-generate/templates/brand-packs');
    const pack = getPackById(packId);
    if (!pack) {
      throw notFound('NOT_FOUND', `Brand pack not found: ${packId}`);
    }

    const cfg = (provider.config as Record<string, any>) || {};

    // 品牌配置包仅填充 baseConfig（协议、地址、能力类型）
    // 模型列表 → 通过 API /models 端点自动拉取
    // 参数预设 → 通过 definitions/*.json 配置
    const updatedConfig = {
      ...cfg,
      baseConfig: {
        ...(cfg.baseConfig || {}),
        apiFormat: pack.baseConfig.apiFormat,
        defaultBaseUrl: pack.baseConfig.defaultBaseUrl,
        capabilities: pack.baseConfig.capabilities,
      },
      activePackId: pack.id,
      activePackVersion: pack.version,
    };

    await this.apiProvidersService.update(id, { config: updatedConfig });

    return {
      ok: true,
      message: `已应用配置包: ${pack.name} v${pack.version}，模型列表请通过自动拉取或手动添加获取。`,
    };
  }

  /**
   * 品牌 LOGO 上传
   * POST /admin/api-providers/logo/upload
   *
   * 上传后的文件存储在 storage/_sys/logos/ 目录下（非用户资源路径），
   * 通过 GET /admin/api-providers/logo/file/:filename 访问。
   */
  @Post('logo/upload')
  @Roles('admin', 'super_admin')
  @UseInterceptors(FileInterceptor('file'))
  async uploadLogo(
    @UploadedFile() file: Express.Multer.File,
    @Query('oldLogoUrl') oldLogoUrl?: string,
  ) {
    if (!file) {
      throw badRequest('BAD_REQUEST', 'Please select an image file to upload');
    }
    const allowedMimes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!allowedMimes.includes(file.mimetype)) {
      throw badRequest('BAD_REQUEST', 'Only PNG / JPEG / WebP / GIF image formats are supported');
    }
    // 删除旧 LOGO 文件（去重：避免历史 LOGO 文件堆积）
    if (oldLogoUrl && oldLogoUrl.startsWith('/api/admin/api-providers/logo/file/')) {
      const oldFilename = path.basename(oldLogoUrl);
      const oldFilePath = path.resolve(process.cwd(), 'storage', '_sys', 'logos', oldFilename);
      const oldResolved = path.resolve(oldFilePath);
      if (oldResolved.startsWith(path.resolve(process.cwd(), 'storage', '_sys', 'logos'))) {
        try {
          await fs.unlink(oldResolved);
        } catch (err: any) {
          if (err.code !== 'ENOENT') {
            console.warn(`删除旧 LOGO 文件失败: ${oldResolved}`, err.message);
          }
        }
      }
    }
    const filename = `${crypto.randomUUID()}.webp`;
    const logosDir = path.resolve(process.cwd(), 'storage', '_sys', 'logos');
    await fs.mkdir(logosDir, { recursive: true });
    // 统一压缩为 WebP，最长边不超过 200px（保持比例）
    const buffer = await sharp(file.buffer)
      .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    await fs.writeFile(path.join(logosDir, filename), buffer);
    return { url: `/api/admin/api-providers/logo/file/${filename}` };
  }

  /**
   * 品牌 LOGO 文件服务
   * GET /admin/api-providers/logo/file/:filename
   */
  @Get('logo/file/:filename')
  async getLogoFile(@Param('filename') filename: string, @Res() res: Response) {
    const logosDir = path.resolve(process.cwd(), 'storage', '_sys', 'logos');
    const filePath = path.join(logosDir, filename);
    // 安全检查：防止目录遍历
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(logosDir)) {
      throw badRequest('BAD_REQUEST', 'Illegal file path');
    }
    try {
      await fs.access(filePath);
    } catch {
      throw badRequest('BAD_REQUEST', 'File not found');
    }
    return res.sendFile(filePath);
  }
}
