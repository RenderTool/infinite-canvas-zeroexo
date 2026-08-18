/**
 * collaboration-events.controller - 协作实时事件 SSE 端点
 *
 * 路由: GET /api/collaboration/rooms/:canvasId/events (Sse)
 *
 * 客户端通过 EventSource 连接，携带 ?token=JWT 完成鉴权。
 * 连接建立后收到该画布协作房间的实时事件（成员加入/离开、消息、权限变更等）。
 */

import { Controller, Get, Param, UseGuards, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { CollaborationEventsService, CollaborationEvent } from './collaboration-events.service';
import { CollaborationSseGuard } from './collaboration-sse.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('collaboration')
@UseGuards(CollaborationSseGuard)
export class CollaborationEventsController {
  constructor(private readonly eventsService: CollaborationEventsService) {}

  /**
   * 订阅画布协作房间的实时事件流
   */
  @Get('rooms/:canvasId/events')
  @Sse()
  stream(
    @Param('canvasId') canvasId: string,
    @CurrentUser() user: { id: string },
  ): Observable<CollaborationEvent> {
    const events = this.eventsService.subscribe(canvasId);

    // 连接建立后先发送欢迎事件，让客户端确认已进入房间事件流
    return new Observable<CollaborationEvent>((subscriber) => {
      const sub = events.subscribe(subscriber);
      subscriber.next({
        type: 'welcome',
        canvasId,
        userId: user.id,
        timestamp: Date.now(),
        meta: { connectedAt: Date.now() },
      });
      return () => sub.unsubscribe();
    });
  }
}
