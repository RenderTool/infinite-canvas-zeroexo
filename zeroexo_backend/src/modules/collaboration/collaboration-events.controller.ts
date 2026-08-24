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
    // 审核制（2026-08-25 审核制漏洞修复）：非 owner 的 offline 成员重连 = 重新进入，
    // 须转 pending 重新申请——原实现直接置 online 绕过 requiresApproval
    // （"先协作后开审核"旧成员重进不触发审核，与 joinByInvite/autoJoin 三入口对齐）
    let becamePending = false;
    try {
      const room = await this.prisma.collaborationRoom.findFirst({
        where: { canvasId, status: 'active' },
        select: { id: true, ownerId: true, requiresApproval: true },
      });
      if (room) {
        const requireReapproval = room.requiresApproval && user.id !== room.ownerId;
        const updated = await this.prisma.collaborationMember.updateMany({
          where: { roomId: room.id, userId: user.id, status: 'offline' },
          data: { status: requireReapproval ? 'pending' : 'online', lastActiveAt: new Date() },
        });
        becamePending = updated.count > 0 && requireReapproval;
        if (becamePending) {
          this.logger.log(`[SSE] 审核制房间 ${room.id} 中用户 ${user.id} 重连被转为待审(曾离屏)`);
          // 通知房主刷新待审列表（申请人自己的连接尚未订阅，由下方 membership_pending 单独送达）
          this.eventsService.broadcastToRoom(canvasId, {
            type: 'join_application',
            userId: user.id,
            meta: { roomId: room.id },
          });
        }
      }
    } catch {
      // 状态变更失败不阻断 SSE 连接（仅影响在线状态展示）
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
      if (becamePending) {
        // 告知申请人自己：已被转为待审，等待房主批准（前端据此显示"等待审核"覆盖层）
        subscriber.next({
          type: 'membership_pending',
          canvasId,
          userId: user.id,
          timestamp: Date.now(),
        });
      }
      return () => {
        sub.unsubscribe();
        // 连接关闭时注销计数
        CollaborationSseGuard.decrementConnection(user.id, canvasId);
        this.logger.debug(`[SSE] 用户 ${user.id} 断开房间 ${canvasId}`);
      };
    }) as Observable<CollaborationEvent>;
  }
}
