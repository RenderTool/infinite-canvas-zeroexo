import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PublicPromptsService } from './public-prompts.service';
import { CreatePublicPromptDto, UpdatePublicPromptDto, ImportPublicPromptDto, QueryPublicPromptDto } from './dto/public-prompt.dto';

@ApiTags('Admin Public Prompts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/public-prompts')
export class PublicPromptsAdminController {
  constructor(private readonly publicPromptsService: PublicPromptsService) {}

  @Get()
  @ApiOperation({ summary: '分页查询公共提示词(Admin)' })
  list(@Query() query: QueryPublicPromptDto) {
    return this.publicPromptsService.list(
      query.page ? Number(query.page) : undefined,
      query.limit ? Number(query.limit) : undefined,
      query.category,
      query.keyword,
    );
  }

  @Get('counts')
  @ApiOperation({ summary: '获取各分类提示词数量统计(Admin)' })
  getCounts() {
    return this.publicPromptsService.getCategoryCounts();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取公共提示词详情(Admin)' })
  findOne(@Param('id') id: string) {
    return this.publicPromptsService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: '创建公共提示词' })
  create(@Body() dto: CreatePublicPromptDto) {
    return this.publicPromptsService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新公共提示词' })
  update(@Param('id') id: string, @Body() dto: UpdatePublicPromptDto) {
    return this.publicPromptsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除公共提示词' })
  remove(@Param('id') id: string) {
    return this.publicPromptsService.remove(id);
  }

  @Post('batch-delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '批量删除公共提示词' })
  batchRemove(@Body() body: { ids: string[] }) {
    return this.publicPromptsService.batchRemove(body.ids || []);
  }

  @Post('clear')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '清空全部公共提示词' })
  clearAll() {
    return this.publicPromptsService.clearAll();
  }

  @Post('import')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '批量导入公共提示词' })
  batchImport(@Body() dto: ImportPublicPromptDto) {
    return this.publicPromptsService.batchImport(dto);
  }
}
