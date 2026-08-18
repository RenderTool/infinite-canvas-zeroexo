import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../../common/errors/error-codes';
import { badRequest, notFound } from '../../../common/errors/app-exception.js';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LogsService } from '../../logs/logs.service';
import { BaseApiAdapter, HealthResult } from '../adapters/base.adapter';
import { AiAdapter } from '../adapters/ai.adapter';
import { EmailAdapter } from '../adapters/email.adapter';
import { OAuthAdapter } from '../adapters/oauth.adapter';
import { StorageAdapter } from '../adapters/storage.adapter';
import { PaymentAdapter } from '../adapters/payment.adapter';
import { decrypt } from '../../../common/crypto/crypto-aes.util';
import {
  HealthCheckResult,
  HealthHistoryQuery,
  HealthOverviewItem,
  HealthStatus,
} from './dto/health.dto';
import { AlertEvent, AlertHook } from './alerts/alert-hook.interface';
import { ConsoleAlertHook } from './alerts/console-alert.hook';

/** 默认连续失败阈值: 连续失败 3 次才标记为 down,避免单次抖动误报 */
const DEFAULT_FAILURE_THRESHOLD = 3;

/** 默认单次检查超时: 10 秒(超过视为失败) */
const DEFAULT_CHECK_TIMEOUT_MS = 10_000;

/** 错误信息最大长度(防止 DB 字段溢出) */
const MAX_ERROR_LENGTH = 500;

/** 敏感模式匹配 - 用于从错误信息中脱敏密钥/Token */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Bearer / Basic 头里的 Token
  { pattern: /(Bearer|Basic)\s+[A-Za-z0-9._\-+/=]{8,}/gi, replacement: '$1 ***' },
  // 形如 sk-... / ghp_... / AKIA... 的 API Key
  { pattern: /\b(sk-[A-Za-z0-9_\-]{8,})/g, replacement: 'sk-***' },
  { pattern: /\b(ghp_[A-Za-z0-9]{8,})/g, replacement: 'ghp_***' },
  { pattern: /\b(AKIA[A-Z0-9]{8,})/g, replacement: 'AKIA***' },
  // ?key=xxx & key=xxx
  { pattern: /([?&](?:api[_-]?key|access[_-]?key|key|token|secret)=)([^&\s]+)/gi, replacement: '$1***' },
  // Authorization 字段
  { pattern: /(authorization['":\s]+)([^'"\s,}]+)/gi, replacement: '$1***' },
  // 长 hex/base64 字符串(>=32 位) 视为可能是密钥
  { pattern: /\b[A-Za-z0-9_\-+/=]{32,}\b/g, replacement: '***' },
];

/**
 * ApiHealthService - 统一 API Provider 健康检查调度服务
 *
 * 职责:
 * 1. 定时(@Cron 5 分钟)遍历所有 enabled=true 的 provider
 * 2. 启动时立即执行一次全量检查
 * 3. 通过对应 type 的 Adapter 执行健康检查
 * 4. 将结果写回 ApiProvider 表的 health / healthLatencyMs / healthCheckedAt / healthError 字段
 * 5. 写入 ApiHealthLog 历史表(保留 90 天)
 * 6. 跟踪连续失败次数,达阈值(默认 3)将状态升级为 down
 * 7. 单次成功后自动恢复为 healthy
 * 8. 状态变化时触发 AlertHook(console 为主,webhook/email 后续)
 *
 * 容错:
 * - 单个 provider 检查失败不影响其他 provider
 * - 单次检查 10 秒超时(可配置)
 * - 错误信息统一脱敏(API Key、Token、Authorization 等)
 * - 告警 hook 内部异常被吞掉,不影响主流程
 */
@Injectable()
export class ApiHealthService implements OnModuleInit {
  private readonly logger = new Logger(ApiHealthService.name);

  /** type -> adapter 路由表 */
  private readonly adapters: Map<string, BaseApiAdapter>;

  /** providerId -> 连续失败次数(内存态,进程重启后清零) */
  private readonly failureStreak: Map<string, number> = new Map();

  /** 连续失败阈值 */
  private readonly failureThreshold: number;

  /** 单次检查超时(毫秒) */
  private readonly checkTimeoutMs: number;

  /** 告警钩子列表(按插入顺序串行触发) */
  private readonly alertHooks: AlertHook[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly logsService: LogsService,
    aiAdapter: AiAdapter,
    emailAdapter: EmailAdapter,
    oauthAdapter: OAuthAdapter,
    storageAdapter: StorageAdapter,
    paymentAdapter: PaymentAdapter,
    consoleAlertHook: ConsoleAlertHook,
  ) {
    this.adapters = new Map<string, BaseApiAdapter>([
      ['ai', aiAdapter],
      ['email', emailAdapter],
      ['oauth', oauthAdapter],
      ['storage', storageAdapter],
      ['payment', paymentAdapter],
    ]);
    this.failureThreshold = Number(
      this.config.get<number>('apiHealth.failureThreshold') ?? DEFAULT_FAILURE_THRESHOLD,
    );
    this.checkTimeoutMs = Number(
      this.config.get<number>('apiHealth.checkTimeoutMs') ?? DEFAULT_CHECK_TIMEOUT_MS,
    );
    this.alertHooks = [consoleAlertHook];
  }

  /**
   * 🔒 绝对禁止: 后端自动调度向任何第三方服务发起主动连接测试
   *
   * 所有外部服务(SMTP/邮件/存储/OAuth/支付/AI)的健康检查
   * 仅允许管理员在 UI 手动点击"测试"按钮触发。
   * 定时 cron 和启动自动检查已完全禁用,避免:
   * - 不必要地消耗第三方 API 配额/Token
   * - 触发服务商限流(如 SMTP 535)
   * - 产生误报告警
   */
  onModuleInit(): void {
    // 无操作 - 启动时不进行任何外部心跳探测
  }

  /**
   * 定时调度: 已禁用
   *
   * 所有第三方服务的健康检查仅允许手动触发。
   * 如需执行全量检查,调用 runHealthChecks()。
   */
  async scheduledHealthCheck(): Promise<void> {
    // 无操作 - 不自动向任何第三方服务发起主动心跳测试
  }

  // ============================================================
  // 公共入口: 批量 / 单次 / 查询
  // ============================================================

  /**
   * 执行一次全量健康检查(遍历所有 enabled=true 的 provider)
   *
   * 流程:
   * 1. 读取所有 enabled provider
   * 2. 并发调用 adapter.healthCheck()(带超时控制)
   * 3. 写回 ApiProvider + 写 ApiHealthLog
   * 4. 状态变化时触发告警
   *
   * @param source 触发来源(用于日志)
   * @returns 每 provider 的检查结果
   */
  async runHealthChecks(source: 'cron' | 'startup' | 'manual' = 'manual'): Promise<HealthCheckResult[]> {
    this.logger.log(`开始全量健康检查(source=${source})`);

    const allEnabled = await this.prisma.apiProvider.findMany({
      where: { enabled: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });

    // 🔒 绝对禁止: 自动检查 AI 渠道(会调用 API 消耗 Token)
    // AI 渠道仅支持管理员手动触发检查
    const providers = allEnabled.filter((p) => p.type !== 'ai');
    const skippedAiCount = allEnabled.length - providers.length;

    if (providers.length === 0) {
      this.logger.log('当前没有启用的非 AI provider,跳过本次检查');
      return [];
    }

    if (skippedAiCount > 0) {
      this.logger.log(`自动调度跳过 ${skippedAiCount} 个 AI provider(手动触发) 以避免 Token 消耗`);
    }

    const results: HealthCheckResult[] = [];
    // 串行执行,避免大量并发请求把出口打满;后续可改并发
    for (const provider of providers) {
      try {
        const result = await this.checkOne(provider.id);
        results.push(result);
      } catch (err) {
        // 单个 provider 失败不影响其他 provider
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`provider ${provider.id} 检查失败: ${msg}`);
      }
    }

    this.logger.log(
      `全量健康检查完成(source=${source}): ${results.length} 个 provider,` +
        `down=${results.filter((r) => r.status === 'down').length}, ` +
        `degraded=${results.filter((r) => r.status === 'degraded').length}, ` +
        `healthy=${results.filter((r) => r.status === 'healthy').length}`,
    );

    return results;
  }

  /**
   * 立即对单个 provider 执行一次健康检查
   *
   * 与 ApiProvidersService.checkHealth 不同的点:
   * - 维护连续失败计数(失败时 +1,成功时清零)
   * - 写 ApiHealthLog + 更新 ApiProvider 表
   * - 状态变化时触发告警
   * - 带超时控制
   *
   * @throws NotFoundException provider 不存在
   * @throws BadRequestException provider 类型未知
   */
  async checkOne(providerId: string): Promise<HealthCheckResult> {
    const provider = await this.prisma.apiProvider.findUnique({ where: { id: providerId } });
    if (!provider) {
      throw notFound(ErrorCode.CHANNEL_NOT_FOUND, `API provider not found: ${providerId}`);
    }
    const adapter = this.adapters.get(provider.type);
    if (!adapter) {
      throw badRequest(ErrorCode.BAD_REQUEST, `Unknown type: ${provider.type}`);
    }

    // 调用 adapter.healthCheck() 并加超时控制
    const rawResult = await this.runWithTimeout(adapter, provider);

    // 脱敏错误信息
    const safeError = rawResult.error ? this.sanitizeError(rawResult.error) : undefined;

    // 维护连续失败计数
    const prevFailures = this.failureStreak.get(providerId) ?? 0;
    const isOk = rawResult.status === 'healthy';
    const nextFailures = isOk ? 0 : prevFailures + 1;
    this.failureStreak.set(providerId, nextFailures);

    // 计算最终状态
    const fromStatus = (provider.health as HealthStatus) || 'unknown';
    const finalStatus = this.computeFinalStatus(rawResult.status, nextFailures);

    // 写 ApiHealthLog
    const checkedAt = new Date();
    try {
      await this.prisma.apiHealthLog.create({
        data: {
          providerId,
          status: finalStatus,
          latencyMs: rawResult.latencyMs ?? null,
          errorMessage: safeError ?? null,
          checkedAt,
        },
      });
    } catch (err) {
      this.logger.error(
        `写入 ApiHealthLog 失败(provider=${providerId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // 写回 ApiProvider 主表
    try {
      await this.prisma.apiProvider.update({
        where: { id: providerId },
        data: {
          health: finalStatus,
          healthLatencyMs: rawResult.latencyMs ?? null,
          healthCheckedAt: checkedAt,
          healthError: safeError ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `更新 ApiProvider 失败(provider=${providerId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // ── 同步配额 ──────────────────────────────────────────────
    // 健康检查成功后,如果 adapter 有自定义 checkQuota(从 API 获取实时配额),
    // 则将获取到的配额写回 provider.quota 字段。
    if (isOk) {
      try {
        const quotaResult = await adapter.checkQuota(provider);
        if (quotaResult.total != null && quotaResult.used != null) {
          const currentQuota = (provider.quota || {}) as Record<string, any>;
          const newQuota = {
            ...currentQuota,
            daily: currentQuota.daily ?? quotaResult.total,
            dailyUsed: quotaResult.used,
            lastSyncedAt: new Date().toISOString(),
          };
          // 仅当 quota 有变化时才更新
          if (
            currentQuota.daily !== newQuota.daily ||
            currentQuota.dailyUsed !== newQuota.dailyUsed
          ) {
            await this.prisma.apiProvider.update({
              where: { id: providerId },
              data: { quota: newQuota },
            });
          }
        }
      } catch (err) {
        this.logger.warn(
          `同步配额失败(provider=${providerId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const result: HealthCheckResult = {
      providerId,
      providerName: provider.name,
      providerType: provider.type,
      providerLabel: `${provider.type}/${provider.provider}`,
      status: finalStatus,
      latencyMs: rawResult.latencyMs,
      error: safeError,
      checkedAt: checkedAt.toISOString(),
      consecutiveFailures: nextFailures,
      fromStatus,
    };

    // 触发告警(状态变化或严重失败)
    if (fromStatus !== finalStatus) {
      await this.dispatchAlert(provider, fromStatus, finalStatus, nextFailures, safeError, rawResult.latencyMs);
    }

    return result;
  }

  /**
   * 列出所有 provider 的当前健康状态概览
   */
  async getOverview(): Promise<HealthOverviewItem[]> {
    const providers = await this.prisma.apiProvider.findMany({
      orderBy: [{ type: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }],
    });

    return providers.map((p) => ({
      providerId: p.id,
      name: p.name,
      type: p.type,
      provider: p.provider,
      enabled: p.enabled,
      isDefault: p.isDefault,
      health: (p.health as HealthStatus) || 'unknown',
      healthLatencyMs: p.healthLatencyMs,
      healthCheckedAt: p.healthCheckedAt ? p.healthCheckedAt.toISOString() : null,
      healthError: p.healthError,
      consecutiveFailures: this.failureStreak.get(p.id) ?? 0,
      lastError: p.healthError,
    }));
  }

  /**
   * 获取单个 provider 的健康详情(包含主表状态 + 最近 1 次日志)
   */
  async getOne(providerId: string) {
    const provider = await this.prisma.apiProvider.findUnique({ where: { id: providerId } });
    if (!provider) {
      throw notFound(ErrorCode.CHANNEL_NOT_FOUND, `API provider not found: ${providerId}`);
    }
    const latestLog = await this.prisma.apiHealthLog.findFirst({
      where: { providerId },
      orderBy: { checkedAt: 'desc' },
    });
    return {
      provider: {
        id: provider.id,
        name: provider.name,
        type: provider.type,
        provider: provider.provider,
        enabled: provider.enabled,
        isDefault: provider.isDefault,
      },
      current: {
        health: (provider.health as HealthStatus) || 'unknown',
        healthLatencyMs: provider.healthLatencyMs,
        healthCheckedAt: provider.healthCheckedAt
          ? provider.healthCheckedAt.toISOString()
          : null,
        healthError: provider.healthError,
        consecutiveFailures: this.failureStreak.get(providerId) ?? 0,
      },
      lastLog: latestLog
        ? {
            status: latestLog.status,
            latencyMs: latestLog.latencyMs,
            errorMessage: latestLog.errorMessage,
            checkedAt: latestLog.checkedAt.toISOString(),
          }
        : null,
    };
  }

  /**
   * 获取单个 provider 的健康历史日志
   */
  async getHistory(providerId: string, query: HealthHistoryQuery = {}) {
    const provider = await this.prisma.apiProvider.findUnique({
      where: { id: providerId },
      select: { id: true, name: true, type: true, provider: true },
    });
    if (!provider) {
      throw notFound(ErrorCode.CHANNEL_NOT_FOUND, `API provider not found: ${providerId}`);
    }

    const days = Math.min(Math.max(query.days ?? 7, 1), 90);
    const since = new Date();
    since.setDate(since.getDate() - days);
    const limit = Math.min(Math.max(query.limit ?? 500, 1), 5000);

    const where: any = { providerId, checkedAt: { gte: since } };
    if (query.status) where.status = query.status;

    const logs = await this.prisma.apiHealthLog.findMany({
      where,
      orderBy: { checkedAt: 'desc' },
      take: limit,
    });

    // 简单统计
    const stats = {
      total: logs.length,
      byStatus: {
        healthy: 0,
        degraded: 0,
        down: 0,
        unknown: 0,
      },
      avgLatencyMs: 0,
    };
    let totalLatency = 0;
    let latencyCount = 0;
    for (const log of logs) {
      const s = log.status as HealthStatus;
      if (stats.byStatus[s] !== undefined) {
        stats.byStatus[s]++;
      }
      if (typeof log.latencyMs === 'number') {
        totalLatency += log.latencyMs;
        latencyCount++;
      }
    }
    stats.avgLatencyMs = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0;

    return {
      provider,
      range: { days, since: since.toISOString() },
      stats,
      logs: logs.map((l) => ({
        id: l.id,
        status: l.status,
        latencyMs: l.latencyMs,
        errorMessage: l.errorMessage,
        checkedAt: l.checkedAt.toISOString(),
      })),
    };
  }

  // ============================================================
  // 内部: 调度、超时、状态计算、告警分发
  // ============================================================

  /**
   * 调用 adapter.healthCheck() 并加 10 秒超时
   * 同时捕获所有异常,统一封装为 HealthResult
   */
  private async runWithTimeout(
    adapter: BaseApiAdapter,
    provider: { id: string; credentials: unknown },
  ): Promise<HealthResult> {
    // 临时注入解密后的 credentials(避免污染数据库值)
    const safeProvider = this.buildAdapterProvider(provider);

    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<HealthResult>((resolve) => {
      timer = setTimeout(() => {
        resolve({
          ok: false,
          status: 'down',
          error: `健康检查超时(>${this.checkTimeoutMs}ms)`,
          checkedAt: new Date().toISOString(),
        });
      }, this.checkTimeoutMs);
    });

    try {
      const result = await Promise.race([adapter.healthCheck(safeProvider as any), timeoutPromise]);
      return result;
    } catch (err) {
      return {
        ok: false,
        status: 'down',
        error: err instanceof Error ? err.message : String(err),
        checkedAt: new Date().toISOString(),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 构造传给 adapter 的 provider 实体(临时解密凭证)
   * 失败时回退到原值,避免抛错阻断检查
   */
  private buildAdapterProvider(provider: { id: string; credentials: unknown }): Record<string, any> {
    const creds = (provider.credentials as Record<string, any>) || {};
    const decrypted: Record<string, any> = {};
    const key = this.config.get<string>('ai.encryptionKey');
    for (const [k, v] of Object.entries(creds)) {
      const isSensitive = /pass|secret|token|key/i.test(k);
      if (isSensitive && typeof v === 'string' && v.length > 0 && key) {
        try {
          decrypted[k] = decrypt(v, key);
        } catch {
          decrypted[k] = '';
        }
      } else {
        decrypted[k] = v;
      }
    }
    return { ...provider, credentials: decrypted };
  }

  /**
   * 计算最终状态
   * - adapter 直接返回 healthy/degraded -> 直接采用
   * - adapter 返回 down 但连续失败不足阈值 -> degraded(降级中)
   * - 连续失败达到阈值 -> down
   * - unknown 一律保持 unknown
   */
  private computeFinalStatus(adapterStatus: HealthStatus, failures: number): HealthStatus {
    if (adapterStatus === 'healthy') return 'healthy';
    if (adapterStatus === 'unknown') return 'unknown';
    if (adapterStatus === 'degraded') {
      // degraded 单次就足够警告
      return 'degraded';
    }
    // down: 看连续失败次数
    if (failures >= this.failureThreshold) return 'down';
    return 'degraded';
  }

  /**
   * 错误信息脱敏 - 防止完整密钥/Token 写入数据库或日志
   */
  private sanitizeError(input: string): string {
    if (!input) return input;
    let text = input;
    for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
      text = text.replace(pattern, replacement);
    }
    // 统一换行与长度
    text = text.replace(/\s+/g, ' ').trim();
    if (text.length > MAX_ERROR_LENGTH) {
      text = text.slice(0, MAX_ERROR_LENGTH) + '...';
    }
    return text;
  }

  /**
   * 分发告警 - 串行调用所有 hook,每个 hook 内部必须自捕获异常
   */
  private async dispatchAlert(
    provider: { id: string; name: string; type: string; provider: string },
    fromStatus: HealthStatus,
    toStatus: HealthStatus,
    consecutiveFailures: number,
    error: string | undefined,
    latencyMs: number | undefined,
  ): Promise<void> {
    // 仅在 down / degraded 转换、或恢复 healthy 时告警;unknown 变化忽略
    const notable = (toStatus === 'down' || toStatus === 'degraded') ||
      (toStatus === 'healthy' && fromStatus !== 'healthy');
    if (!notable) return;

    const severity: AlertEvent['severity'] =
      toStatus === 'down' ? 'critical' : toStatus === 'degraded' ? 'warning' : 'info';
    const message =
      toStatus === 'down'
        ? `API Provider ${provider.name} 已宕机(${fromStatus} -> ${toStatus})`
        : toStatus === 'degraded'
          ? `API Provider ${provider.name} 健康度下降(${fromStatus} -> ${toStatus})`
          : `API Provider ${provider.name} 已恢复(${fromStatus} -> ${toStatus})`;

    const event: AlertEvent = {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      providerKey: provider.provider,
      fromStatus,
      toStatus,
      consecutiveFailures,
      error,
      latencyMs,
      occurredAt: new Date().toISOString(),
      severity,
      message,
    };

    // 同时写一条 logs(system 分类, error 级别)
    this.logsService.log('system', message, {
      level: severity === 'critical' ? 'error' : severity === 'warning' ? 'warn' : 'info',
      meta: {
        providerId: provider.id,
        providerName: provider.name,
        providerType: provider.type,
        providerKey: provider.provider,
        fromStatus,
        toStatus,
        consecutiveFailures,
        error,
        latencyMs,
      },
    });

    for (const hook of this.alertHooks) {
      try {
        await hook.fire(event);
      } catch (err) {
        this.logger.error(
          `告警 hook ${hook.name} 触发失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
