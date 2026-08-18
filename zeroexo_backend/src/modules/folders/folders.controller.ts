import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FoldersService } from './folders.service';
import { CreateFolderDto, UpdateFolderDto } from './dto/folder.dto';
import type { Request } from 'express';

/** 鉴权后 request.user 类型(简化) */
interface AuthedRequest extends Request {
  user: { id: string };
}

/**
 * 文件夹 REST 端点
 * GET    /api/folders             列出当前用户所有文件夹(平铺)
 * GET    /api/folders/system      列出系统根目录
 * POST   /api/folders             新建
 * PATCH  /api/folders/:id         重命名 / 移动 / 排序
 * DELETE /api/folders/:id         删除
 *
 * 注意:全局已通过 main.ts 的 app.setGlobalPrefix('api') 统一加 /api 前缀,
 * 此处不要重复写 'api/'。
 */
@Controller('folders')
@UseGuards(JwtAuthGuard)
export class FoldersController {
  constructor(private readonly foldersService: FoldersService) {}

  @Get()
  async list(@Req() req: AuthedRequest) {
    return this.foldersService.findAll(req.user.id);
  }

  @Get('system')
  async system(@Req() req: AuthedRequest) {
    return this.foldersService.findOrCreateRoot(req.user.id);
  }

  @Post()
  async create(@Req() req: AuthedRequest, @Body() dto: CreateFolderDto) {
    return this.foldersService.create(req.user.id, dto);
  }

  @Patch(':id')
  async update(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateFolderDto,
  ) {
    return this.foldersService.update(req.user.id, id, dto);
  }

  @Delete(':id')
  async remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.foldersService.remove(req.user.id, id);
  }
}
