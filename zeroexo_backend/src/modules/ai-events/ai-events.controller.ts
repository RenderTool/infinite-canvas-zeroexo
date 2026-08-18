/**
 * ai-events.controller - AI 事件 SSE 端点
 *
 * Admin 页面通过此端点实时接收 AI 生成状态变更。
 * 路由: GET /api/ai-events (Sse)
 */

import { Controller, Get, UseGuards, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AiEventsService, AiEvent } from './ai-events.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SseJwtGuard } from './guards/sse-jwt.guard';

@Controller('ai-events')
@UseGuards(SseJwtGuard)
export class AiEventsController {
  constructor(private readonly aiEventsService: AiEventsService) {}

  @Get()
  @Sse()
  stream(@CurrentUser() user: { id: string }): Observable<AiEvent> {
    // 仅 admin 角色可以访问? 通过 Guard 统一校验即可, SseJwtGuard 已做 JWT 验证
    return this.aiEventsService.subscribe(user.id);
  }
}
