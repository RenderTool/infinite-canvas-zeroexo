import { Injectable, Logger } from '@nestjs/common';
import { AlertEvent, AlertHook } from './alert-hook.interface';

/**
 * Email 告警实现(占位)
 *
 * 设计目标: 通过 EmailAdapter(基于 ApiProvider.email 渠道)发送告警邮件给运维。
 * 当前为占位实现,未实际发邮件,后续可注入 EmailAdapter 后启用。
 */
@Injectable()
export class EmailAlertHook implements AlertHook {
  readonly name = 'email';

  private readonly logger = new Logger(EmailAlertHook.name);

  async fire(_event: AlertEvent): Promise<void> {
    // 当前阶段不发送任何邮件,仅记录一条信息
    this.logger.warn('EmailAlertHook 尚未启用,跳过本次告警');
  }
}
