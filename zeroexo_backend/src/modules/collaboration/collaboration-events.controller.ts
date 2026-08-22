/**
 * collaboration-events.controller - 协作实时事件 SSE 端点
 *
 * 路由: GET /api/collaboration/rooms/:canvasId/events (Sse)
 *
 * 客户端通过 EventSource 连接，携带 ?token=JWT 完成鉴权。
 * 连接建立后收到该画布协作房间的实时事件（成员加入/离开、消息、权限变更等）。
 */

import { Controller, Get, Param, UseGuards, Sse, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { CollaborationEventsService, CollaborationEvent } from './collaboration-events.service';
import { CollaborationSseGuard } from './collaboration-sse.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('collaboration')
@UseGuards(CollaborationSseGuard)
export class CollaborationEventsController {
  private readonly logger = new Logger(CollaborationEventsController.name);

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
    // 注册 SSE 连接（前置守卫已通过，计数在连接建立时递增）
    CollaborationSseGuard.incrementConnection(user.id, canvasId);
    this.logger.debug(`[SSE] 用户 ${user.id} 连接房间 ${canvasId}`);

    const events = this.eventsService.subscribe(canvasId);

    return new Observable<CollaborationEvent>((subscriber) => {
      const sub = events.subscribe(subscriber);
      subscriber.next({
        type: 'welcome',
        canvasId,
        userId: user.id,
        timestamp: Date.now(),
        meta: { connectedAt: Date.now() },
      });
      return () => {
        sub.unsubscribe();
        // 连接关闭时注销计数
        CollaborationSseGuard.decrementConnection(user.id, canvasId);
        this.logger.debug(`[SSE] 用户 ${user.id} 断开房间 ${canvasId}`);
      };
    }) as Observable<CollaborationEvent>;
  }
}
