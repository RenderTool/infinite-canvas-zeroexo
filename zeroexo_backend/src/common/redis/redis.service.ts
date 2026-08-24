/**
 * redis.service - Redis 服务封装
 *
 * 用于会话锁存储(替换内存 Map,支持多实例部署)、TTL 自动过期。
 * 使用 ioredis,通过环境变量 REDIS_URL 连接。
 */

import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isEnabled = false;
  /** 本实例唯一标识(用于 Pub/Sub 消息过滤自身回环,避免双送达) */
  private readonly instanceId: string = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (redisUrl) {
      try {
        this.client = new Redis(redisUrl, {
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => {
            if (times > 3) return null; // 重试3次后放弃
            return Math.min(times * 200, 2000);
          },
          lazyConnect: true,
        });
        this.isEnabled = true;
        this.logger.log('Redis 连接已创建');
      } catch (err) {
        this.logger.warn(`Redis 连接失败,降级为内存模式: ${err}`);
        this.isEnabled = false;
      }
    } else {
      this.logger.warn('REDIS_URL 未配置,降级为内存模式');
      this.isEnabled = false;
    }
  }

  /** 是否启用 Redis */
  get enabled(): boolean {
    return this.isEnabled && this.client !== null;
  }

  /** 本实例唯一标识 */
  get id(): string {
    return this.instanceId;
  }

  // ─── Generic Operations ───

  async get(key: string): Promise<string | null> {
    if (!this.enabled || !this.client) return null;
    return await this.client.get(key);
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    if (!this.enabled || !this.client) return;
    if (ttlMs) {
      await this.client.set(key, value, 'PX', ttlMs);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.enabled || !this.client) return;
    await this.client.del(key);
  }

  /** 健康检测 */
  async ping(): Promise<boolean> {
    if (!this.enabled || !this.client) return false;
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  // ─── Pub/Sub Operations ───

  /**
   * 向给定频道发布消息
   * 仅当 Redis 启用时有效
   */
  async publish(channel: string, message: string): Promise<void> {
    if (!this.enabled || !this.client) return;
    await this.client.publish(channel, message);
  }

  /**
   * 订阅频道的消息回调
   * @returns 取消订阅的函数
   */
  async subscribe(channel: string, callback: (message: string, channel: string) => void): Promise<() => void> {
    if (!this.enabled || !this.client) return () => {};
    const sub = this.client.duplicate();
    sub.on('error', () => {}); // 静默处理连接错误,防止进程崩溃
    await sub.subscribe(channel);
    sub.on('message', (ch, msg) => {
      if (ch === channel) callback(msg, ch);
    });
    return () => {
      sub.unsubscribe(channel).catch(() => {});
      sub.disconnect();
    };
  }

  /**
   * 按模式订阅(glob 风格,如 `ai-events:*`)
   * @returns 取消订阅的函数
   */
  async psubscribe(pattern: string, callback: (message: string, channel: string) => void): Promise<() => void> {
    if (!this.enabled || !this.client) return () => {};
    const sub = this.client.duplicate();
    sub.on('error', () => {}); // 静默处理连接错误,防止进程崩溃
    await sub.psubscribe(pattern);
    sub.on('pmessage', (_pattern, ch, msg) => {
      if (_pattern === pattern) callback(msg, ch);
    });
    return () => {
      sub.punsubscribe(pattern).catch(() => {});
      sub.disconnect();
    };
  }

  onModuleDestroy(): void {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
  }
}
