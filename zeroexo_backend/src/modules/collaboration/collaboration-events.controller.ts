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
import { PrismaService } from '../../common/prisma/prisma.service';

@Controller('collaboration')
@UseGuards(CollaborationSseGuard)
export class CollaborationEventsController {
  private readonly logger = new Logger(CollaborationEventsController.name);

  constructor(
    private readonly eventsService: CollaborationEventsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 订阅画布协作房间的实时事件流
   */
  @Get('rooms/:canvasId/events')
  @Sse()
  async stream(
    @Param('canvasId') canvasId: string,
    @CurrentUser() user: { id: string },
  ): Promise<Observable<CollaborationEvent>> {
    // 注册 SSE 连接（前置守卫已通过，计数在连接建立时递增）
    CollaborationSseGuard.incrementConnection(user.id, canvasId);
    this.logger.debug(`[SSE] 用户 ${user.id} 连接房间 ${canvasId}`);

    // Plan#38 验收热修：SSE 建立 = 进入协作，把该用户 offline 成员置回 online
    // （离屏≠退出：离开/刷新画布页时 cleanup 会置 offline，重进必须能恢复活性）
    try {
      const room = await this.prisma.collaborationRoom.findFirst({
        where: { canvasId, status: 'active' },
        select: { id: true },
      });
      if (room) {
        await this.prisma.collaborationMember.updateMany({
          where: { roomId: room.id, userId: user.id, status: 'offline' },
          data: { status: 'online', lastActiveAt: new Date() },
        });
      }
    } catch {
      // 置 online 失败不阻断 SSE 连接（仅影响在线状态展示）
    }

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
