/**
 * agent-conversation.controller - Agent 对话管理控制器
 *
 * 路由前缀: /api/agents
 * 端点:
 *   POST   /api/agents/conversations              - 创建会话
 *   GET    /api/agents/conversations              - 会话列表
 *   GET    /api/agents/conversations/:id          - 会话详情
 *   DELETE /api/agents/conversations/:id          - 删除会话（级联消息）
 *   GET    /api/agents/conversations/:id/messages - 历史消息分页
 */

import { Controller, Post, Get, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsOptional, IsString } from 'class-validator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentConversationService } from './agent-conversation.service';

export class CreateConversationDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  projectId?: string;
}

@Controller('agents')
@UseGuards(AuthGuard('jwt'))
export class AgentConversationController {
  constructor(private readonly conversationService: AgentConversationService) {}

  /** 创建会话 */
  @Post('conversations')
  async create(@Body() dto: CreateConversationDto, @CurrentUser() user: AuthUser) {
    return this.conversationService.createConversation(user.id, {
      title: dto.title,
      projectId: dto.projectId,
    });
  }

  /** 会话列表 */
  @Get('conversations')
  async list(@Query() query: { limit?: number; offset?: number }, @CurrentUser() user: AuthUser) {
    return this.conversationService.listConversations(user.id, {
      limit: query.limit,
      offset: query.offset,
    });
  }

  /** 会话详情 */
  @Get('conversations/:id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.conversationService.getConversation(id, user.id);
  }

  /** 删除会话 */
  @Delete('conversations/:id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.conversationService.deleteConversation(id, user.id);
  }

  /** 历史消息分页 */
  @Get('conversations/:id/messages')
  async messages(
    @Param('id') id: string,
    @Query() query: { limit?: number; offset?: number },
    @CurrentUser() user: AuthUser,
  ) {
    return this.conversationService.listMessages(id, user.id, {
      limit: query.limit,
      offset: query.offset,
    });
  }
}
