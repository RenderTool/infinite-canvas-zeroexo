import { Module } from '@nestjs/common';
import { CollaborationController } from './collaboration.controller';
import { CollaborationEventsController } from './collaboration-events.controller';
import { CollaborationService } from './collaboration.service';
import { InviteService } from './invite.service';
import { CollaborationMemberService } from './collaboration-member.service';
import { CollaborationAgentService } from './collaboration-agent.service';
import { CollaborationEventsService } from './collaboration-events.service';
import { CollaborationSseGuard } from './collaboration-sse.guard';
import { AgentModule } from '../agent/agent.module';

/**
 * 协作模块 - 提供协作房间管理、邀请码生成/验证、成员管理、实时事件广播等功能。
 * 支持 invite-only / public / auto-self (同账户多设备自动加入) 三种模式。
 * 引入 AgentModule 以复用画布 Agent 执行能力(协作共享记忆群聊)。
 */
@Module({
  imports: [AgentModule],
  controllers: [CollaborationController, CollaborationEventsController],
  providers: [
    CollaborationService,
    InviteService,
    CollaborationMemberService,
    CollaborationAgentService,
    CollaborationEventsService,
    CollaborationSseGuard,
  ],
  exports: [CollaborationService, InviteService, CollaborationEventsService, CollaborationAgentService],
})
export class CollaborationModule {}
