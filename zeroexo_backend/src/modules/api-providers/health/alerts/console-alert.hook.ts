import { Injectable, Logger } from '@nestjs/common';
import { AlertEvent, AlertHook } from './alert-hook.interface';

/**
 * 控制台告警实现
 *
 * 当 provider 状态发生变化(healthy <-> down 等)时,本类会:
 * 1. 用 NestJS Logger 将事件输出到控制台
 * 2. 写入 LogsService(分类 system / 级别 error),便于在前端日志面板看到
 *
 * 这是默认开启的告警通道,Webhook / Email 实现将在后续按需补齐。
 */
@Injectable()
export class ConsoleAlertHook implements AlertHook {
  readonly name = 'console';

  private readonly logger = new Logger(ConsoleAlertHook.name);

  /**
   * 控制台告警 - 打印事件 + 写入 LogsService
   *
   * 由于 LogsService 的具体注入由调用方决定,本实现仅依赖 Logger;
   * ApiHealthService 会在调用前完成 LogsService 的写入(避免循环依赖)。
   */
  async fire(event: AlertEvent): Promise<void> {
    try {
      const tag = `[APIProviderHealth] ${event.providerName} (${event.providerType}/${event.providerKey})`;
      const detail = `${event.fromStatus} -> ${event.toStatus} | consecutiveFailures=${event.consecutiveFailures}`;
      const errorPart = event.error ? ` | error=${event.error}` : '';

      const line = `${tag} ${detail}${errorPart}`;
      if (event.severity === 'critical') {
        this.logger.error(line);
      } else if (event.severity === 'warning') {
        this.logger.warn(line);
      } else {
        this.logger.log(line);
      }
    } catch (err) {
      // 告警通道自身失败不能影响主流程
      this.logger.error(
        `ConsoleAlertHook 处理失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
