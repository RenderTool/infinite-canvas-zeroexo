/**
 * ai-events.module - AI 事件模块
 *
 * 仅用于 Admin 页面 AI 生成状态实时推送,与 canvas/asset/prompt 同步完全解耦。
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiEventsService } from './ai-events.service';
import { AiEventsController } from './ai-events.controller';
import { SseJwtGuard } from './guards/sse-jwt.guard';

@Module({
  imports: [ConfigModule],
  providers: [AiEventsService, SseJwtGuard],
  controllers: [AiEventsController],
  exports: [AiEventsService],
})
export class AiEventsModule {}
