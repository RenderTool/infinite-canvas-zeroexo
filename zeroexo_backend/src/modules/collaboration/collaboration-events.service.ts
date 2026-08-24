/**
 * collaboration-events.service - 协作实时事件 SSE 服务
 *
 * 基于 RxJS Subject 实现按画布房间维度的实时广播：
 * - 成员加入/离开
 * - 房间设置变更
 * - 成员权限变更
 * - 聊天消息发送/删除
 *
 * 采用 SSE（Server-Sent Events）而非 WebSocket，原因：
 * 1. 复用现有 ai-events 的成熟 SSE 基础设施与 SseJwtGuard 鉴权
 * 2. 协作广播是单向服务端→客户端，SSE 天然适配，无需引入 socket.io 依赖
 * 3. 浏览器 EventSource 原生支持自动重连
 *
 * 支持多实例部署：
 * - 本地使用 Subject 分发（单实例无额外开销）
 * - Redis 启用时通过 Pub/Sub 跨实例广播（房间维度）
 */

import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { RedisService } from '../../common/redis/redis.service';

export type CollaborationEventType =
  | 'member_joined'
  | 'member_left'
  | 'join_application' // Phase 8：新的待审加入申请到达（房主端提示）
  | 'room_updated'
  | 'member_updated'
  | 'message'
  | 'message_deleted'
  | 'room_closed'
  | 'agent_thinking'
  | 'agent_tool_call'
  | 'agent_result'
  | 'welcome';

export interface CollaborationEvent {
  type: CollaborationEventType;
  /** 画布/房间 ID（事件归属） */
  canvasId: string;
  /** 触发者用户 ID（可为空，如系统事件） */
  userId?: string;
  timestamp: number;
  meta?: Record<string, unknown>;
}

@Injectable()
export class CollaborationEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(CollaborationEventsService.name);
  /** canvasId → Map<connId, Subject> */
  private roomConnections = new Map<string, Map<number, Subject<CollaborationEvent>>>();
  private connectionCounter = 0;
  private unsubRedis: (() => void) | null = null;
  private readonly REDIS_CHANNEL_PREFIX = 'collab-events:';

  constructor(private readonly redisService: RedisService) {
    this.initRedisSubscriber();
  }

  private initRedisSubscriber(): void {
    if (!this.redisService.enabled) return;

    const pattern = `${this.REDIS_CHANNEL_PREFIX}*`;
    this.redisService.psubscribe(pattern, (message, channel) => {
      try {
        const parsed = JSON.parse(message) as CollaborationEvent & { __src?: string };
        // 过滤本实例发布的消息(Redis Pub/Sub 会回环给发布者,否则本地连接双送达)
        if (parsed.__src === this.redisService.id) return;
        const { __src: _src, ...event } = parsed;
        const canvasId = channel.replace(this.REDIS_CHANNEL_PREFIX, '');
        if (event.canvasId !== canvasId) return;

        // 将 Redis 收到的跨实例事件转发给本地连接
        const conns = this.roomConnections.get(event.canvasId);
        if (!conns) return;
        for (const subject of conns.values()) {
          subject.next(event);
        }
      } catch (err) {
        this.logger.warn(`Redis Pub/Sub 消息解析失败: ${err}`);
      }
    }).then((unsub) => {
      this.unsubRedis = unsub;
      this.logger.log('Redis Pub/Sub 订阅已就绪 (collab-events:*)');
    }).catch((err) => {
      this.logger.warn(`Redis Pub/Sub 订阅失败: ${err}`);
    });
  }

  /**
   * 订阅画布房间的实时事件
   */
  subscribe(canvasId: string): Observable<CollaborationEvent> {
    if (!this.roomConnections.has(canvasId)) {
      this.roomConnections.set(canvasId, new Map());
    }

    const roomConns = this.roomConnections.get(canvasId)!;
    const connId = ++this.connectionCounter;
    const subject = new Subject<CollaborationEvent>();

    roomConns.set(connId, subject);

    const cleanup = () => {
      roomConns.delete(connId);
      subject.complete();
      if (roomConns.size === 0) {
        this.roomConnections.delete(canvasId);
      }
    };

    subject.subscribe({
      complete: cleanup,
      error: cleanup,
    });

    return subject.asObservable();
  }

  /**
   * 向画布房间所有连接广播事件
   */
  broadcastToRoom(canvasId: string, event: Omit<CollaborationEvent, 'canvasId' | 'timestamp'>): void {
    const full: CollaborationEvent = {
      ...event,
      canvasId,
      timestamp: Date.now(),
    };

    // 本地分发
    const roomConns = this.roomConnections.get(canvasId);
    if (roomConns) {
      for (const subject of roomConns.values()) {
        subject.next(full);
      }
    }

    // 跨实例广播（Redis Pub/Sub）
    if (this.redisService.enabled) {
      const channel = `${this.REDIS_CHANNEL_PREFIX}${canvasId}`;
      // 携带 __src 实例标识,供订阅端过滤自身回环(Redis Pub/Sub 会发给发布者自己)
      this.redisService.publish(channel, JSON.stringify({ ...full, __src: this.redisService.id })).catch((err) => {
        this.logger.warn(`Redis Pub/Sub 发布失败: ${err}`);
      });
    }
  }

  onModuleDestroy(): void {
    if (this.unsubRedis) {
      this.unsubRedis();
      this.unsubRedis = null;
    }
    for (const roomConns of this.roomConnections.values()) {
      for (const subject of roomConns.values()) {
        subject.complete();
      }
      roomConns.clear();
    }
    this.roomConnections.clear();
  }
}
