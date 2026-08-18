/**
 * Throttle 装饰器 - 业务级限流档位
 *
 * 通过 @nestjs/throttler 的 Throttle 装饰器,提供语义化档位:
 * - @ShortThrottle()    60 秒 100 次(防 CC)
 * - @MediumThrottle()   5 分钟 500 次
 * - @LongThrottle()     1 小时 3000 次
 * - @LoginThrottle()    5 次/分/IP(防爆破)
 * - @UploadThrottle()   30 次/分/用户(防滥用)
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
 * 通用装饰器工厂
 */
function tierDecorator(
  tier: keyof typeof THROTTLE_TIERS,
  config: { ttl: number; limit: number },
) {
  return applyDecorators(
    SetMetadata(THROTTLE_TIER_META, tier),
    Throttle({
      // 同时设置同名档(覆盖全局默认)+ 短/中/长档兜底
      // 核心档覆盖(同名短档优先匹配自定义 ttl/limit)
      short: { ttl: config.ttl, limit: config.limit },
      medium: { ttl: config.ttl, limit: config.limit },
      long: { ttl: config.ttl, limit: config.limit },
    }),
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

/** 上传:30 次/分 */
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
