import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PromptsService } from './prompts.service';
import {
  CreatePromptDto,
  QueryPromptDto,
  UpdatePromptDto,
} from './dto/prompt.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Prompts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('prompts')
export class PromptsController {
  constructor(private readonly promptsService: PromptsService) {}

  @Get()
  @ApiOperation({
    summary: '分页查询提示词列表(游标分页,可按 category/folderId 过滤,keyword 模糊搜索标题)',
  })
  list(
    @CurrentUser('id') userId: string,
    @Query() query: QueryPromptDto,
  ) {
    return this.promptsService.list(
      userId,
      query.cursor,
      query.limit ? Number(query.limit) : undefined,
      query.category,
      query.keyword,
      query.folderId,
      query.type,
    );
  }

  @Post()
  @ApiOperation({ summary: '创建提示词' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreatePromptDto) {
    return this.promptsService.create(userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取提示词详情' })
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.promptsService.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新提示词' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePromptDto,
  ) {
    return this.promptsService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除提示词' })
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.promptsService.remove(userId, id);
  }
}
