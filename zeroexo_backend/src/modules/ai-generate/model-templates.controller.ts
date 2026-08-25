import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ErrorCode } from '../../common/errors/error-codes';
import { badRequest } from '../../common/errors/app-exception';
import {
  TemplateRegistryService,
  MAX_TEMPLATE_JSON_BYTES,
} from './templates/registry.service';

/**
 * 模型模板库管理 API（admin）
 *
 * 用户（admin）可导入自己的模型模板 JSON，校验通过后全站可用：
 * 生成面板自动渲染参数、后端按模板协议执行（含异步轮询、AK/SK 签名）。
 */
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/model-templates')
export class ModelTemplatesController {
  constructor(private readonly registry: TemplateRegistryService) {}

  /** 全部模板（内置 + 自定义，isBuiltIn 标记） */
  @Get()
  @HttpCode(HttpStatus.OK)
  async list() {
    return { items: await this.registry.list() };
  }

  /** 导入模板：校验 → 落库 → 导入即生效 */
  @Post()
  @HttpCode(HttpStatus.OK)
  async create(@Body() body: unknown) {
    const size = JSON.stringify(body ?? {}).length;
    if (size > MAX_TEMPLATE_JSON_BYTES) {
      throw badRequest(
        ErrorCode.BAD_REQUEST,
        `模板 JSON 超过大小上限（${Math.round(MAX_TEMPLATE_JSON_BYTES / 1024)}KB）`,
      );
    }
    const template = await this.registry.create(body);
    return { success: true, template };
  }

  /** 删除模板（仅自定义模板可删） */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    await this.registry.remove(id);
    return { success: true };
  }
}
