/**
 * Throttle 装饰器 - 业务级限流档位
 *
 * 通过 @nestjs/throttler 的 Throttle 装饰器,提供语义化档位:
 * - @ShortThrottle()    60 秒 100 次(防 CC)
 * - @MediumThrottle()   5 分钟 500 次
 * - @LongThrottle()     1 小时 3000 次
 * - @LoginThrottle()    5 次/分/IP(防爆破)
 * - @UploadThrottle()   1000 次/分/用户(覆盖批量上传,保留粗粒度防刷)
 * - @AiThrottle()       20 次/分/用户(成本保护)
 * - @EmailThrottle()    10 次/小时/IP(防垃圾邮件)
 * - @SmsThrottle()      1 次/分/手机号
 * - @RegisterThrottle() 5 次/天/IP
 *
 * 使用方式:装饰在 Controller 方法上,覆盖全局默认档位。
 *   @Post('login')
 *   @LoginThrottle()
 *   login(@Body() dto: LoginDto) { ... }
 */

import { applyDecorators, SetMetadata } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_TIERS } from '../throttler.config';

/**
 * 元数据 key,标识装饰器档位(供监控/调试)
 */
export const THROTTLE_TIER_META = 'throttler:tier';

/**
 * 业务档元数据载体:tier 名 + 生效的 ttl/limit。
 * ApiThrottlerGuard 按此元数据动态执行独立计数。
 */
export interface BusinessTierConfig {
  tier: string;
  ttl: number;
  limit: number;
}

/**
 * 通用装饰器工厂
 *
 * v6 语义修正(2026-08-19,二次修正):
 * - 一版修正把业务档注册进 forRoot throttlers + SkipThrottle,但 v6 guard
 *   会把 forRoot 数组应用到所有端点,导致 sms/register 等业务档叠加
 *   卡死全部接口(fullSync 429 回归)。已回滚。
 * - 现行方案:全局三档用 @Throttle 覆盖同名 throttler(v6 标准语义);
 *   业务档仅写 THROTTLE_TIER_META 元数据(含 ttl/limit,支持
 *   AiThrottle 参数覆盖),由 ApiThrottlerGuard.canActivate 动态执行
 *   独立计数——不叠加全局三档、不叠加其它业务档,也不影响无装饰器端点。
 */
function tierDecorator(
  tier: keyof typeof THROTTLE_TIERS,
  config: { ttl: number; limit: number },
) {
  // 全局三档装饰器:直接覆盖同名全局 throttler,不跳过其它档
  if (tier === 'short' || tier === 'medium' || tier === 'long') {
    return applyDecorators(SetMetadata(THROTTLE_TIER_META, tier), Throttle({ [tier]: { ttl: config.ttl, limit: config.limit } }));
  }
  // 业务档位:只写元数据,由 ApiThrottlerGuard 动态独立计数
  return applyDecorators(
    SetMetadata(THROTTLE_TIER_META, { tier, ttl: config.ttl, limit: config.limit } satisfies BusinessTierConfig),
  );
}

/** 短时:60 秒 100 次 */
export const ShortThrottle = () => tierDecorator('short', THROTTLE_TIERS.short);

/** 中时:5 分钟 500 次 */
export const MediumThrottle = () => tierDecorator('medium', THROTTLE_TIERS.medium);

/** 长时:1 小时 3000 次 */
export const LongThrottle = () => tierDecorator('long', THROTTLE_TIERS.long);

/** 登录:5 次/分(防爆破) */
export const LoginThrottle = () => tierDecorator('login', THROTTLE_TIERS.login);

/** 上传:1000 次/分(覆盖批量上传) */
export const UploadThrottle = () => tierDecorator('upload', THROTTLE_TIERS.upload);

/**
 * AI:20 次/分(成本保护,默认档位)
 *
 * 支持覆盖参数以适配不同端点的成本保护策略:
 *   @AiThrottle()                              // 默认 60s 20 次
 *   @AiThrottle({ limit: 3 })                  // 60s 3 次(generate 提交)
 *   @AiThrottle({ ttl: 60_000, limit: 5 })     // 60s 5 次(cancel 取消)
 *
 * @param override 可选,覆盖默认 ttl(ms)/limit,未传字段回退 THROTTLE_TIERS.ai
 */
export const AiThrottle = (override?: { ttl?: number; limit?: number }) => {
  const base = THROTTLE_TIERS.ai;
  return tierDecorator('ai', {
    ttl: override?.ttl ?? base.ttl,
    limit: override?.limit ?? base.limit,
  });
};

/** 邮件:10 次/小时(防垃圾邮件) */
export const EmailThrottle = () => tierDecorator('email', THROTTLE_TIERS.email);

/** 短信:1 次/分(防骚扰) */
export const SmsThrottle = () => tierDecorator('sms', THROTTLE_TIERS.sms);

/** 注册:5 次/天(防批量注册) */
export const RegisterThrottle = () =>
  tierDecorator('register', THROTTLE_TIERS.register);

/** 画布读操作:300 次/分(列表/详情/graph 分页,高频但轻量) */
export const CanvasReadThrottle = () =>
  tierDecorator('canvasRead', THROTTLE_TIERS.canvasRead);

/** 画布写操作:120 次/分(防抖快照落库 PATCH + 删除,防恶意高频写) */
export const CanvasWriteThrottle = () =>
  tierDecorator('canvasWrite', THROTTLE_TIERS.canvasWrite);

/** 画布创建:5 次/分(防批量创建) */
export const CanvasCreateThrottle = () =>
  tierDecorator('canvasCreate', THROTTLE_TIERS.canvasCreate);

/** 资源预签名:1000 次/分(覆盖批量 presign) */
export const PresignThrottle = () =>
  tierDecorator('presign', THROTTLE_TIERS.presign);

/**
 * 媒体下载:3000 次/分。
 * 资源加载是用户可感知的关键路径,必须远离限流体验;
 * 仅作为匿名可读前缀与极端滥用的粗粒度防线。
 */
export const MediaReadThrottle = () =>
  tierDecorator('mediaRead', THROTTLE_TIERS.mediaRead);
