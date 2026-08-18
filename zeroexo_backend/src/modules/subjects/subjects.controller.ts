import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubjectsService } from './subjects.service';
import { CreateSubjectDto, UpdateSubjectDto, QuerySubjectDto } from './dto/subject.dto';
import type { Request } from 'express';

interface AuthedRequest extends Request {
  user: { id: string };
}

/**
 * 主体 REST 端点
 * GET    /api/subjects              列表(游标分页 + type/folderId/keyword 筛选)
 * POST   /api/subjects              新建
 * GET    /api/subjects/:id          详情
 * PATCH  /api/subjects/:id          更新
 * DELETE /api/subjects/:id          删除
 *
 * 注意:全局已通过 main.ts 的 app.setGlobalPrefix('api') 统一加 /api 前缀,
 * 此处不要重复写 'api/'。
 */
@Controller('subjects')
@UseGuards(JwtAuthGuard)
export class SubjectsController {
  constructor(private readonly subjectsService: SubjectsService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query() query: QuerySubjectDto) {
    return this.subjectsService.list(req.user.id, query);
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() dto: CreateSubjectDto) {
    return this.subjectsService.create(req.user.id, dto);
  }

  @Get(':id')
  findOne(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.subjectsService.findOne(req.user.id, id);
  }

  @Patch(':id')
  update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: UpdateSubjectDto) {
    return this.subjectsService.update(req.user.id, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.subjectsService.remove(req.user.id, id);
  }
}
