/**
 * ApiThrottlerGuard - 自定义 API 限流 Guard
 *
 * 继承 NestJS ThrottlerGuard,实现以下增强:
 * 1. 覆盖 getTracker():优先用 userId(JWT 已认证),未认证时回退到 IP
 * 2. 覆盖 shouldSkip():对显式配置的 THROTTLE_WHITELIST 跳过限流
 *    (不再内置内网 IP 段白名单——反代部署下所有请求都命中内网前缀,
 *    会导致限流形同虚设;内网信任请通过 THROTTLE_WHITELIST 显式配置)
 * 3. 覆盖 throwThrottlingException():抛出标准化 429 响应,含
 *    retryAfter / limit / remaining / resetAt 等字段
 * 4. 触发限流时调用 ThrottlerMonitorService 记录 + 告警
 *
 * 使用方式:
 *   - 在 AppModule 中通过 APP_GUARD 全局注册即可,
 *     各 Controller 可通过 @Throttle() / @ShortThrottle() 等装饰器覆盖档位
 */

import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import {
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { ThrottlerMonitorService } from '../services/throttler-monitor.service';
import { parseWhitelist, THROTTLE_TIERS } from '../throttler.config';
import { THROTTLE_TIER_META, type BusinessTierConfig } from '../decorators/throttle.decorator';

/**
 * 接口:req.user 结构(取自 JwtAuthGuard)
 */
interface AuthenticatedRequest extends Record<string, unknown> {
  ip?: string;
  ips?: string[];
  user?: {
    id?: string;
    sub?: string;
  };
  method?: string;
  originalUrl?: string;
  url?: string;
}

/** 兜底 IP(解析失败时使用,确保不与正常用户撞 key) */
const FALLBACK_IP = '0.0.0.0';

@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  /** 静态白名单缓存(避免每次请求解析) */
  private static cachedWhitelist: string[] | null = null;
  private static cachedWhitelistAt = 0;
  private static readonly WHITELIST_CACHE_TTL_MS = 60_000;

  /** 当前请求正在执行的业务档位名(供 429 响应诊断使用;请求结束后 context 被 GC,无泄漏) */
  private readonly activeTierByContext = new WeakMap<ExecutionContext, string>();

  constructor(
    @Optional() options: any,
    @Optional() storageService: ThrottlerStorage,
    @Optional() reflector: Reflector,
    @Optional() private readonly configService?: ConfigService,
    @Optional() private readonly monitor?: ThrottlerMonitorService,
  ) {
    super(options, storageService, reflector);
  }

  /**
   * 限流追踪键:优先 userId,未认证回退到 IP
   */
  protected async getTracker(req: AuthenticatedRequest): Promise<string> {
    const userId = req.user?.id ?? req.user?.sub;
    if (userId) {
      return `user:${userId}`;
    }
    const ip = this.extractClientIp(req);
    return `ip:${ip}`;
  }

  /**
   * 业务档动态限流(修复 2026-08-19 叠加误伤回归):
   *
   * v6 guard 会把 forRoot.throttlers 数组应用到所有端点。若把业务档
   * (sms 1次/分、register 5次/天…)注册进该数组,所有接口都会被叠加
   * 卡死(fullSync 等正常请求报 429)。因此业务档不进 forRoot,
   * 改由本方法按档位元数据动态执行:命中业务档装饰器的端点仅受
   * 自身档位约束(独立计数器),不叠加全局三档也不叠加其它业务档。
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const classRef = context.getClass();
    const tierMeta = this.reflector?.getAllAndOverride<BusinessTierConfig | string>(
      THROTTLE_TIER_META,
      [handler, classRef],
    );
    const tierName = typeof tierMeta === 'string' ? tierMeta : tierMeta?.tier;
    const isBusinessTier =
      !!tierName && tierName !== 'short' && tierName !== 'medium' && tierName !== 'long';
    if (!isBusinessTier) {
      // 无装饰器 / 全局三档装饰器:走 v6 标准循环(short/medium/long)
      return super.canActivate(context);
    }
    if (await this.shouldSkip(context)) return true;

    const tierCfg =
      typeof tierMeta === 'object' && typeof tierMeta.ttl === 'number' && typeof tierMeta.limit === 'number'
        ? tierMeta
        : THROTTLE_TIERS[tierName as keyof typeof THROTTLE_TIERS];
    if (!tierCfg) {
      // 未知档位元数据:退回全局三档标准循环,避免限流失效
      return super.canActivate(context);
    }
    this.activeTierByContext.set(context, tierName);
    return this.handleRequest({
      context,
      limit: tierCfg.limit,
      ttl: tierCfg.ttl,
      throttler: { name: tierName, ttl: tierCfg.ttl, limit: tierCfg.limit },
      blockDuration: tierCfg.ttl,
      getTracker: this.commonOptions.getTracker ?? this.getTracker.bind(this),
      generateKey: this.commonOptions.generateKey ?? this.generateKey.bind(this),
    });
  }

  /**
   * 提取客户端真实 IP(兼容 X-Forwarded-For)
   */
  private extractClientIp(req: AuthenticatedRequest): string {
    if (Array.isArray(req.ips) && req.ips.length > 0 && req.ips[0]) {
      return req.ips[0];
    }
    if (typeof req.ip === 'string' && req.ip.length > 0) {
      return req.ip;
    }
    return FALLBACK_IP;
  }

  /**
   * 白名单 IP 跳过限流(配置的 THROTTLE_WHITELIST)
   */
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const { req } = this.getRequestResponse(context);
    const request = req as AuthenticatedRequest;
    const ip = this.extractClientIp(request);
    if (this.isWhitelisted(ip)) {
      return true;
    }
    return super.shouldSkip(context);
  }

  /**
   * 判断 IP 是否在白名单(仅用户显式配置的 THROTTLE_WHITELIST)
   */
  private isWhitelisted(ip: string): boolean {
    const whitelist = this.getWhitelistFromConfig();
    if (whitelist.length > 0) {
      for (const w of whitelist) {
        if (w === ip) return true;
        // 支持简单 CIDR 后缀(只比对前缀,如 192.168.1.)
        if (w.endsWith('.') && ip.startsWith(w)) return true;
        if (w.includes('/')) {
          if (this.matchCidr(ip, w)) return true;
        }
      }
    }
    return false;
  }

  /**
   * 极简 CIDR 匹配(支持 IPv4 /xx ≤ 32,IPv6 简化处理)
   */
  private matchCidr(ip: string, cidr: string): boolean {
    if (cidr.includes(':')) {
      // IPv6 简化:仅比对前缀
      const [prefix] = cidr.split('/');
      return ip.startsWith(prefix ?? '');
    }
    const [base, bitsStr] = cidr.split('/');
    const bits = Number(bitsStr);
    if (!base || isNaN(bits) || bits < 0 || bits > 32) return false;
    if (bits === 0) return true;
    const octets = base.split('.').map(Number);
    if (octets.length !== 4 || octets.some((o) => isNaN(o))) return false;
    const mask = (~((1 << (32 - bits)) - 1)) >>> 0;
    const baseInt = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
    const target = ip.split('.').map(Number);
    if (target.length !== 4 || target.some((o) => isNaN(o))) return false;
    const targetInt = ((target[0] << 24) | (target[1] << 16) | (target[2] << 8) | target[3]) >>> 0;
    return (baseInt & mask) === (targetInt & mask);
  }

  /**
   * 读取并缓存 THROTTLE_WHITELIST 配置
   */
  private getWhitelistFromConfig(): string[] {
    const now = Date.now();
    if (
      ApiThrottlerGuard.cachedWhitelist !== null &&
      now - ApiThrottlerGuard.cachedWhitelistAt < ApiThrottlerGuard.WHITELIST_CACHE_TTL_MS
    ) {
      return ApiThrottlerGuard.cachedWhitelist;
    }
    const raw = this.configService?.get<string>('THROTTLE_WHITELIST');
    const list = parseWhitelist(raw);
    ApiThrottlerGuard.cachedWhitelist = list;
    ApiThrottlerGuard.cachedWhitelistAt = now;
    return list;
  }

  /**
   * 触发限流时抛出标准化 429 响应
   */
  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { req, res } = this.getRequestResponse(context);
    const request = req as AuthenticatedRequest;
    const ip = this.extractClientIp(request);
    const userId = request.user?.id ?? request.user?.sub;
    const method = request.method ?? 'GET';
    const url = request.originalUrl ?? request.url ?? '';
    // 档位名:优先取本请求的业务档记录;全局三档触发时 v6 detail 未携带
    // throttler 名,key 为 sha256 不可逆,回退 unknown(前端 NET 面板可辨)
    const tier = this.activeTierByContext.get(context) ?? 'global';

    const retryAfter = Math.max(1, Math.ceil((detail.timeToBlockExpire ?? detail.timeToExpire) / 1000));
    const limit = detail.limit;
    const totalHits = detail.totalHits ?? limit;
    const remaining = Math.max(0, limit - totalHits);
    const resetAt = new Date(Date.now() + (detail.timeToBlockExpire ?? detail.timeToExpire)).toISOString();

    // 1. 记录到监控(日志 + 告警)
    try {
      this.monitor?.record({
        ip,
        userId: userId ?? undefined,
        method,
        path: url,
        tier,
        limit,
        ttl: detail.ttl,
        timestamp: new Date(),
      });
    } catch {
      // 监控失败不应阻塞 429 响应
    }

    // 2. 设置标准 RateLimit 响应头
    if (res && typeof (res as any).header === 'function') {
      try {
        (res as any).header('Retry-After', retryAfter);
        (res as any).header('X-RateLimit-Limit', limit);
        (res as any).header('X-RateLimit-Remaining', remaining);
        (res as any).header('X-RateLimit-Reset', resetAt);
      } catch {
        // 忽略 header 写入失败
      }
    }

    // 3. 抛出标准化 429 异常(由全局 AllExceptionsFilter 捕获)
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'RATE_LIMITED',
        message: 'Too many requests, please try again later',
        error: 'Too Many Requests',
        retryAfter,
        limit,
        remaining,
        resetAt,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
