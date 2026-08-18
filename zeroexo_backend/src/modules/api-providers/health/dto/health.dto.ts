/**
 * 健康检查 DTO 定义
 *
 * 提供 API Provider 健康检查相关的类型与查询参数对象。
 * - HealthStatus: 数据库与前端约定的健康状态枚举
 * - HealthCheckResult: 一次健康检查的结构化结果
 * - HealthHistoryQuery: 查询历史日志时的入参
 */

/** 健康状态枚举 */
export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

/**
 * 一次健康检查的结果
 *
 * 字段说明:
 * - providerId: 被检查的 provider 主键
 * - providerName/providerType/providerLabel: 冗余字段,便于直接展示
 * - status: 当前健康状态
 * - latencyMs: 本次检查耗时(毫秒)
 * - error: 失败时的错误信息(已脱敏)
 * - checkedAt: 检查时间(ISO 字符串)
 * - consecutiveFailures: 截至本次的连续失败次数(成功会清零)
 * - fromStatus: 变化前状态(用于判断 healthy -> down 等告警场景)
 */
export interface HealthCheckResult {
  providerId: string;
  providerName: string;
  providerType: string;
  providerLabel: string;
  status: HealthStatus;
  latencyMs?: number;
  error?: string;
  checkedAt: string;
  consecutiveFailures: number;
  fromStatus?: HealthStatus;
}

/**
 * 健康历史查询参数
 *
 * - days: 查询最近多少天的记录(默认 7,上限 90 防止爆库)
 * - status: 可选,按状态过滤
 * - limit: 可选,限制返回条数(默认 500)
 */
export class HealthHistoryQuery {
  /** 查询最近多少天的日志(默认 7,最大 90) */
  days?: number = 7;

  /** 按状态过滤(可选) */
  status?: HealthStatus;

  /** 最大返回条数(默认 500) */
  limit?: number = 500;
}

/**
 * 当前健康概览(列出所有 provider 的最新状态)
 */
export interface HealthOverviewItem {
  providerId: string;
  name: string;
  type: string;
  provider: string;
  enabled: boolean;
  isDefault: boolean;
  health: HealthStatus;
  healthLatencyMs: number | null;
  healthCheckedAt: string | null;
  healthError: string | null;
  consecutiveFailures: number;
  lastError: string | null;
}
