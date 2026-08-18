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
import { parseWhitelist } from '../throttler.config';

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
   * 白名单 IP 跳过限流(内网 + 配置的 THROTTLE_WHITELIST)
   */
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const { req } = this.getRequestResponse(context);
    const ip = this.extractClientIp(req as AuthenticatedRequest);
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
    const tier = (detail.key?.split('-').pop() ?? 'default').toString();

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
