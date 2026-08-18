import { HealthStatus } from '../dto/health.dto';

/**
 * 健康状态告警事件
 *
 * 当 provider 状态发生显著变化(healthy -> down / down -> healthy)时,
 * ApiHealthService 会构造一个 AlertEvent 并分发给所有 AlertHook 实现。
 */
export interface AlertEvent {
  /** provider 主键 */
  providerId: string;
  /** provider 显示名 */
  providerName: string;
  /** provider 类型: ai / email / oauth / storage / payment */
  providerType: string;
  /** 服务商标识: openai / smtp / ... */
  providerKey: string;
  /** 变化前状态 */
  fromStatus: HealthStatus;
  /** 变化后状态 */
  toStatus: HealthStatus;
  /** 截至当前的连续失败次数(用于严重度判断) */
  consecutiveFailures: number;
  /** 最近一次错误信息(已脱敏) */
  error?: string;
  /** 最近一次检查耗时 */
  latencyMs?: number;
  /** 事件发生时间(ISO 字符串) */
  occurredAt: string;
  /** 事件等级: critical | warning | info */
  severity: 'critical' | 'warning' | 'info';
  /** 备注: 人类可读描述 */
  message: string;
}

/**
 * 健康告警钩子接口
 *
 * 任何实现该接口的 provider 都会被 ApiHealthService 注入并接收告警事件。
 * 设计原则:
 * - 单一方法 fire(同步/异步均可),无副作用约束
 * - 内部异常必须自捕获,绝不能向上抛出影响主流程
 * - 新增告警方式(钉钉/飞书/企微)只需新增一个实现并加入 providers
 */
export interface AlertHook {
  /** 钩子名称,用于日志与多 hook 区分 */
  readonly name: string;

  /**
   * 处理告警事件
   * 实现内部必须 try/catch 防止影响主调度
   */
  fire(event: AlertEvent): Promise<void>;
}
