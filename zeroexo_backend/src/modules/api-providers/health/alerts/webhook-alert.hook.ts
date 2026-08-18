import { Injectable, Logger } from '@nestjs/common';
import { AlertEvent, AlertHook } from './alert-hook.interface';

/**
 * Webhook 告警实现(占位)
 *
 * 设计目标: 把 AlertEvent POST 到管理员配置的 URL(钉钉/飞书/Slack/自建)。
 * 当前为占位实现,未启用真实请求,后续可注入 HttpService / ConfigService 后启用。
 */
@Injectable()
export class WebhookAlertHook implements AlertHook {
  readonly name = 'webhook';

  private readonly logger = new Logger(WebhookAlertHook.name);

  async fire(_event: AlertEvent): Promise<void> {
    // 当前阶段不发送任何 HTTP,仅记录一条信息
    this.logger.warn('WebhookAlertHook 尚未启用,跳过本次告警');
  }
}
