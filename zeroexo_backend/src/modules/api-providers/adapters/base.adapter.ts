import { Logger } from '@nestjs/common';
import { ApiProvider } from '@prisma/client';

/**
 * 统一 API Provider 适配器抽象基类
 *
 * 设计目标:
 * - 统一 AI / Email / OAuth / Storage / Payment 五类外部服务的调用接口
 * - 每类(type)对应一个具体适配器,内部按 provider 字段分发具体逻辑
 * - 所有方法签名一致,便于 ApiProvidersService 通过 Map<type, adapter> 路由
 *
 * 子类必须实现:
 * - type: 业务类型标识
 * - supportedProviders: 该类型支持的服务商白名单
 * - validateConfig: 校验公开配置(config 字段)
 * - healthCheck: 执行连通性测试,返回健康状态
 * - invokeAction: 执行业务动作(发邮件 / 鉴权跳转 / 上传文件 / 发起支付 等)
 * - getUsageMetrics: 返回该类型支持的用量指标(用于 ApiUsage 记录)
 * - checkQuota: 检查该 provider 当前的限额水位
 */

/** 健康检查结果 */
export interface HealthResult {
  ok: boolean;
  /** healthy | degraded | down | unknown */
  status: 'healthy' | 'degraded' | 'down' | 'unknown';
  /** 检查耗时(ms) */
  latencyMs?: number;
  /** 错误信息(失败时填充) */
  error?: string;
  /** 额外上下文(如服务返回的配额信息) - 别名: meta */
  meta?: Record<string, any>;
  /** 额外上下文详情 - 适配器可选用此字段携带调试信息 */
  details?: Record<string, any>;
  checkedAt: string;
}

/** 限额检查结果 */
export interface QuotaCheckResult {
  level: 'ok' | 'warning' | 'critical';
  /** 已用量 */
  used?: number;
  /** 总量 */
  total?: number;
  /** 使用百分比 0-100 */
  percent?: number;
  /** 提示信息 */
  message?: string;
}

export abstract class BaseApiAdapter {
  /** 日志器,由子类在构造函数中初始化 */
  protected logger!: Logger;

  /** 业务类型标识 */
  abstract readonly type: 'ai' | 'email' | 'oauth' | 'storage' | 'payment';

  /** 该类型支持的服务商白名单(小写) */
  abstract readonly supportedProviders: string[];

  /**
   * 校验公开配置(config 字段)
   * 返回 null 表示通过,返回字符串为错误信息
   */
  abstract validateConfig(config: Record<string, any>): Promise<string | null>;

  /**
   * 健康检查: 探测服务连通性 / 鉴权是否有效
   */
  abstract healthCheck(provider: ApiProvider): Promise<HealthResult>;

  /**
   * 执行业务动作
   * action 字符串由各类型约定(如 email:send / oauth:authorize / storage:putObject / payment:createOrder)
   */
  abstract invokeAction(
    provider: ApiProvider,
    action: string,
    params: Record<string, any>,
  ): Promise<any>;

  /**
   * 该类型支持的用量指标(用于 ApiUsage.metric 字段)
   * 例: AI -> ['request', 'token']; Email -> ['email_sent']
   */
  abstract getUsageMetrics(): string[];

  /**
   * 检查当前 provider 的限额水位
   * 默认实现: 根据 provider.quota 中的 daily/monthly 与已用值计算
   * 子类可按需覆写(如 AI 渠道的 token 限额与 email 的发送条数)
   */
  async checkQuota(provider: ApiProvider): Promise<QuotaCheckResult> {
    const quota = (provider.quota || {}) as Record<string, any>;
    const daily = typeof quota.daily === 'number' ? quota.daily : null;
    const monthly = typeof quota.monthly === 'number' ? quota.monthly : null;
    const dailyUsed = typeof quota.dailyUsed === 'number' ? quota.dailyUsed : 0;
    const monthlyUsed = typeof quota.monthlyUsed === 'number' ? quota.monthlyUsed : 0;

    const dailyPercent = daily ? (dailyUsed / daily) * 100 : 0;
    const monthlyPercent = monthly ? (monthlyUsed / monthly) * 100 : 0;
    const percent = Math.max(dailyPercent, monthlyPercent);

    if (percent >= 95) {
      return { level: 'critical', percent, used: dailyUsed, total: daily ?? undefined, message: '已接近或超过限额' };
    }
    if (percent >= 80) {
      return { level: 'warning', percent, used: dailyUsed, total: daily ?? undefined, message: '用量较高' };
    }
    return { level: 'ok', percent, used: dailyUsed, total: daily ?? undefined };
  }
}
