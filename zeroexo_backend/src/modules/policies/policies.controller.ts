import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PoliciesService } from './policies.service';

@ApiTags('Policies')
@Controller('policies')
export class PoliciesController {
  constructor(private readonly policiesService: PoliciesService) {}

  @Get()
  @ApiOperation({ summary: '获取所有已发布政策文档列表' })
  @ApiQuery({ name: 'lang', required: false, description: '语言: zh | en | ja' })
  list(@Query('lang') lang?: string) {
    return this.policiesService.list(false, lang);
  }

  @Get(':key')
  @ApiOperation({ summary: '根据 key 获取已发布政策文档内容（支持语言选择）' })
  @ApiQuery({ name: 'lang', required: false, description: '语言: zh | en | ja' })
  findByKey(@Param('key') key: string, @Query('lang') lang?: string) {
    return this.policiesService.findByKey(key, lang);
  }
}