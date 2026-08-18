/**
 * ThrottlerMonitorService - 限流触发监控与告警
 *
 * 职责:
 * 1. 记录每次限流触发到 logs(http 分类,warn 级别)
 * 2. 同一 IP 在 1 小时内累计触发 N 次以上时,console.error 告警
 * 3. 提供查询接口(供监控后台)
 *
 * 设计:
 * - 使用 Map 按 IP 聚合触发时间戳,周期清理过期记录
 * - 不持久化,只做内存级告警(系统重启会重置,符合"近实时"语义)
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { LogsService } from '../../../modules/logs/logs.service';

export interface ThrottleEvent {
  ip: string;
  userId?: string;
  method: string;
  path: string;
  tier: string;
  limit: number;
  ttl: number;
  timestamp: Date;
}

/** 告警阈值:1 小时内同一 IP 触发限流次数 */
const ALERT_THRESHOLD = 10;
/** 告警窗口(毫秒):1 小时 */
const ALERT_WINDOW_MS = 3_600_000;

@Injectable()
export class ThrottlerMonitorService {
  private readonly logger = new Logger(ThrottlerMonitorService.name);
  /** IP → 触发时间戳数组 */
  private readonly ipEvents = new Map<string, number[]>();

  constructor(@Optional() private readonly logsService?: LogsService) {}

  /**
   * 记录一次限流触发
   */
  record(event: ThrottleEvent): void {
    // 1. 写日志(http 分类,便于后台查询)
    try {
      this.logsService?.log('http', '触发 API 限流', {
        level: 'warn',
        userId: event.userId,
        meta: {
          ip: event.ip,
          method: event.method,
          path: event.path,
          tier: event.tier,
          limit: event.limit,
          ttl: event.ttl,
        },
      });
    } catch (err) {
      this.logger.warn(
        `记录限流日志失败: ${(err as Error).message}`,
      );
    }

    // 2. 按 IP 聚合,触发告警
    const list = this.ipEvents.get(event.ip) ?? [];
    list.push(event.timestamp.getTime());
    // 仅保留窗口内的
    const cutoff = Date.now() - ALERT_WINDOW_MS;
    while (list.length > 0 && list[0] < cutoff) {
      list.shift();
    }
    this.ipEvents.set(event.ip, list);

    if (list.length >= ALERT_THRESHOLD) {
      this.logger.error(
        `[限流告警] IP ${event.ip} 在 1 小时内累计触发 ${list.length} 次限流(>= ${ALERT_THRESHOLD}),可能存在恶意攻击`,
      );
    }
  }

  /**
   * 查询 IP 的当前累计触发次数(用于调试/后台)
   */
  getCountForIp(ip: string): number {
    const list = this.ipEvents.get(ip) ?? [];
    const cutoff = Date.now() - ALERT_WINDOW_MS;
    return list.filter((t) => t >= cutoff).length;
  }

  /**
   * 清理所有统计(测试用)
   */
  reset(): void {
    this.ipEvents.clear();
  }
}
