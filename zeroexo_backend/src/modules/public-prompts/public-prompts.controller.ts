import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PublicPromptsService } from './public-prompts.service';
import { QueryPublicPromptDto } from './dto/public-prompt.dto';

/**
 * 公共提示词 - 公开只读接口,无需登录认证。
 * 供所有用户(含未登录)浏览公共提示词库。
 */
@ApiTags('Public Prompts')
@Controller('public/prompts')
export class PublicPromptsController {
  constructor(private readonly publicPromptsService: PublicPromptsService) {}

  @Get()
  @ApiOperation({ summary: '分页查询公共提示词(offset 分页,返回 total,可按 category/keyword 过滤)' })
  list(@Query() query: QueryPublicPromptDto, @Req() req: Request) {
    // 如果用户已登录(由 JwtAuthGuard 可选守卫注入),则查询收藏状态
    const userId = (req as any).user?.id;
    return this.publicPromptsService.list(
      query.page ? Number(query.page) : undefined,
      query.limit ? Number(query.limit) : undefined,
      query.category,
      query.keyword,
      userId,
      query.order,
      query.seed,
    );
  }

  @Get('counts')
  @ApiOperation({ summary: '获取各分类提示词数量统计' })
  getCounts() {
    return this.publicPromptsService.getCategoryCounts();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取公共提示词详情' })
  findOne(@Param('id') id: string, @Req() req: Request) {
    const userId = (req as any).user?.id;
    return this.publicPromptsService.findOne(id, userId);
  }
}