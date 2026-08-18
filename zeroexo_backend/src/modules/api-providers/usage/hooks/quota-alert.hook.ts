import { ApiProvider } from '@prisma/client';

/**
 * 额度告警等级
 *
 * - ok:       用量正常,无需关注
 * - warning:  达到告警阈值(默认 70%),可继续使用但需提示
 * - critical: 达到或超过硬阈值(默认 95%),应阻断或强提示
 */
export type QuotaAlertLevel = 'ok' | 'warning' | 'critical';

/**
 * 告警事件载荷
 *
 * 由 ApiUsageService.checkQuota 命中阈值时构造,分发到所有 QuotaAlertHook 实现。
 */
export interface QuotaAlertPayload {
  /** 触发告警的 provider */
  provider: ApiProvider;
  /** 触发告警的指标(默认 request,可扩展) */
  metric: string;
  /** 触发的窗口: day | month */
  window: 'day' | 'month';
  /** 当前已用值 */
  used: number;
  /** 上限值(可能为 null,代表未配置硬上限) */
  limit: number | null;
  /** 使用百分比 0-100 */
  percent: number;
  /** 告警等级 */
  level: QuotaAlertLevel;
  /** 触发时的阈值(70/85/95),便于区分提示文案 */
  threshold: 70 | 85 | 95;
  /** 告警时间 */
  triggeredAt: Date;
}

/**
 * 额度告警扩展点
 *
 * 用法:
 * 1. 业务侧实现 QuotaAlertHook 接口并通过 NestJS DI 注册为 provider
 * 2. 通过 ApiUsageService.registerAlertHook(hook) 注入
 * 3. 当用量达到 70/85/95 阈值时,ApiUsageService 会按注册顺序调用 onAlert
 *
 * 默认实现: ConsoleAlertHook(只 console.warn + 写 ApiUsage 表)
 */
export interface QuotaAlertHook {
  /** 钩子名(便于日志标识) */
  readonly name: string;

  /**
   * 触发告警
   * @param payload 告警事件载荷
   */
  onAlert(payload: QuotaAlertPayload): Promise<void> | void;
}
