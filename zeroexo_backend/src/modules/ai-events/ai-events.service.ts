/**
 * ai-events.service - AI 事件 SSE 服务 (仅用于 Admin 页面实时展示 AI 生成状态)
 *
 * 替代原有的 SyncEventsService,仅保留 AI 生成相关事件。
 * 与 canvas/asset/prompt 同步完全解耦。
 *
 * 支持多实例部署:
 * - 本地使用 Subject 分发(单实例无额外开销)
 * - Redis 启用时通过 Pub/Sub 跨实例广播
 */

import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { RedisService } from '../../common/redis/redis.service';

export type AiEventType =
  | 'ai_generation_submitted'
  | 'ai_generation_completed'
  | 'agent:step'
  | 'agent:tool_call'
  | 'agent:tool_result'
  | 'agent:progress'
  | 'agent:complete'
  | 'agent:error';

export interface AiEvent {
  type: AiEventType;
  userId: string;
  resourceId: string;
  timestamp: number;
  meta?: Record<string, unknown>;
}

@Injectable()
export class AiEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(AiEventsService.name);
  private userConnections = new Map<string, Map<number, Subject<AiEvent>>>();
  private connectionCounter = 0;
  private unsubRedis: (() => void) | null = null;
  private readonly REDIS_CHANNEL_PREFIX = 'ai-events:';

  constructor(private readonly redisService: RedisService) {
    this.initRedisSubscriber();
  }

  private initRedisSubscriber(): void {
    if (!this.redisService.enabled) return;

    const pattern = `${this.REDIS_CHANNEL_PREFIX}*`;
    this.redisService.psubscribe(pattern, (message, channel) => {
      try {
        const parsed = JSON.parse(message) as AiEvent & { __src?: string };
        // 过滤本实例发布的消息(Redis Pub/Sub 会回环给发布者,否则本地连接双送达)
        if (parsed.__src === this.redisService.id) return;
        const { __src: _src, ...event } = parsed;
        const userId = channel.replace(this.REDIS_CHANNEL_PREFIX, '');
        if (event.userId !== userId) return;

        // 将 Redis 收到的跨实例事件转发给本地连接
        const userConns = this.userConnections.get(event.userId);
        if (!userConns) return;
        for (const subject of userConns.values()) {
          subject.next(event);
        }
      } catch (err) {
        this.logger.warn(`Redis Pub/Sub 消息解析失败: ${err}`);
      }
    }).then((unsub) => {
      this.unsubRedis = unsub;
      this.logger.log('Redis Pub/Sub 订阅已就绪 (ai-events:*)');
    }).catch((err) => {
      this.logger.warn(`Redis Pub/Sub 订阅失败: ${err}`);
    });
  }

  subscribe(userId: string): Observable<AiEvent> {
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Map());
    }

    const userConns = this.userConnections.get(userId)!;
    const connId = ++this.connectionCounter;
    const subject = new Subject<AiEvent>();

    userConns.set(connId, subject);

    const cleanup = () => {
      userConns.delete(connId);
      subject.complete();
      if (userConns.size === 0) {
        this.userConnections.delete(userId);
      }
    };

    subject.subscribe({
      complete: cleanup,
      error: cleanup,
    });

    return subject.asObservable();
  }

  broadcast(event: AiEvent): void {
    // 本地分发
    const userConns = this.userConnections.get(event.userId);
    if (userConns) {
      for (const subject of userConns.values()) {
        subject.next(event);
      }
    }

    // 跨实例广播(Redis Pub/Sub)
    if (this.redisService.enabled) {
      const channel = `${this.REDIS_CHANNEL_PREFIX}${event.userId}`;
      // 携带 __src 实例标识,供订阅端过滤自身回环(Redis Pub/Sub 会发给发布者自己)
      this.redisService.publish(channel, JSON.stringify({ ...event, __src: this.redisService.id })).catch((err) => {
        this.logger.warn(`Redis Pub/Sub 发布失败: ${err}`);
      });
    }
  }

  onModuleDestroy(): void {
    if (this.unsubRedis) {
      this.unsubRedis();
      this.unsubRedis = null;
    }
    for (const userConns of this.userConnections.values()) {
      for (const subject of userConns.values()) {
        subject.complete();
      }
      userConns.clear();
    }
    this.userConnections.clear();
  }
}
