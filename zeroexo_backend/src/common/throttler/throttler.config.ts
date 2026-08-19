/**
 * Throttler 配置工厂
 *
 * 设计目标:
 * - 防止应用层 DDoS / 暴力破解 / 滥用,通过多档位限流分散风险。
 * - 短时档:防止瞬时 CC 攻击。
 * - 中时档:防止短时间内的持续滥用。
 * - 长时档:防止长时间持续抓取 / 撞库。
 *
 * 档位定义(全局默认,各 Controller 可通过自定义装饰器覆盖):
 * - short: 60 秒 100 次(防 CC)
 * - medium: 5 分钟 500 次
 * - long: 1 小时 3000 次
 *
 * 存储:默认使用 NestJS 自带内存存储(ThrottlerStorageService),
 *      单实例部署已足够,多实例部署可后续替换为 Redis 分布式存储
 *      (实现 ThrottlerStorage 接口注入即可,无需改动业务代码)。
 *
 * 白名单:通过 THROTTLE_WHITELIST 环境变量配置(逗号分隔的 CIDR/IP 列表)。
 *         不再默认放行内网 IP(反代部署下所有请求均命中内网前缀会导致限流失效),
 *         内网信任场景请显式配置 THROTTLE_WHITELIST。
 */

import { registerAs } from '@nestjs/config';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';

export const THROTTLER_CONFIG_KEY = 'throttler';

/**
 * 默认限流档位(毫秒)
 * - 短时 60 秒 / 100 次
 * - 中时 5 分钟 / 500 次
 * - 长时 1 小时 / 3000 次
 */
export const DEFAULT_TIERS = {
  short: { ttl: 60_000, limit: 100 },
  medium: { ttl: 300_000, limit: 500 },
  long: { ttl: 3_600_000, limit: 3_000 },
} as const;

/**
 * 解析白名单配置(逗号分隔字符串 → 数组,支持空字符串)
 */
export function parseWhitelist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Throttler 工厂 - 装配 ThrottlerModuleOptions,供 forRootAsync 注入
 */
export const throttlerConfig = registerAs(THROTTLER_CONFIG_KEY, () => {
  const whitelist = parseWhitelist(process.env.THROTTLE_WHITELIST);

  const options: ThrottlerModuleOptions = {
    throttlers: [
      { name: 'short', ttl: DEFAULT_TIERS.short.ttl, limit: DEFAULT_TIERS.short.limit },
      { name: 'medium', ttl: DEFAULT_TIERS.medium.ttl, limit: DEFAULT_TIERS.medium.limit },
      { name: 'long', ttl: DEFAULT_TIERS.long.ttl, limit: DEFAULT_TIERS.long.limit },
      // ⚠️ 业务档位(login/upload/ai/…)禁止注册到此数组:v6 guard 会把 forRoot
      //    throttlers 应用到所有端点,业务档(如 sms 1次/分、register 5次/天)
      //    会叠加误伤全部接口。业务档由 ApiThrottlerGuard 按档位元数据
      //    动态独立计数,详见 throttle.decorator.ts / api-throttler.guard.ts。
    ],
    /**
     * 全局 getTracker:优先用 userId,未登录时回退到 IP。
     * 由 ApiThrottlerGuard.getTracker 覆盖实现,此处只作为兜底占位。
     */
    getTracker: (req: Record<string, any>) => req?.ip ?? 'unknown',
    /**
     * 错误信息生成:由 ApiThrottlerGuard 抛出标准化 429 响应,
     * 此处的 errorMessage 仅作为兜底。
     */
    errorMessage: '请求过于频繁,请稍后再试',
  };

  return {
    options,
    whitelist,
    tiers: DEFAULT_TIERS,
  };
});

/**
 * 业务级限流档位(供各 Controller 装饰器使用)
 */
export const THROTTLE_TIERS = {
  /** 短时:60 秒 100 次(默认全局档) */
  short: { ttl: 60_000, limit: 100 },
  /** 中时:5 分钟 500 次 */
  medium: { ttl: 300_000, limit: 500 },
  /** 长时:1 小时 3000 次 */
  long: { ttl: 3_600_000, limit: 3_000 },
  /** 登录:5 次/分(防爆破) */
  login: { ttl: 60_000, limit: 5 },
  /**
   * 上传:2000 次/分。
   * presign 已走批量端点(≤100 条/请求,前端同步推送仅需 ⌈N/100⌉ 次);
   * 但 PUT 二进制仍是 1 资源 1 请求,1000 节点全量推送 = 1000 次 PUT 恰好压线,
   * 叠加重试与其它上传端点后必然溢出,故留 2 倍余量,仍保留粗粒度防刷。
   */
  upload: { ttl: 60_000, limit: 2000 },
  /** AI:20 次/分(成本保护) */
  ai: { ttl: 60_000, limit: 20 },
  /** 邮件:10 次/小时(防垃圾邮件) */
  email: { ttl: 3_600_000, limit: 10 },
  /** 短信:1 次/分(防骚扰) */
  sms: { ttl: 60_000, limit: 1 },
  /** 注册:5 次/天(防批量注册) */
  register: { ttl: 86_400_000, limit: 5 },
  /**
   * 画布读操作:60 秒 300 次(列表 / 详情 / graph 分页)。
   * 读取轻量且高频(编辑器轮询 + 多项目切换),全局 100/分 会误伤正常交互。
   */
  canvasRead: { ttl: 60_000, limit: 300 },
  /**
   * 画布写操作:60 秒 120 次(防抖后的快照落库 PATCH + 删除)。
   * 实时编辑走 Yjs WebSocket,HTTP 写只负责防抖落库与删除,
   * 120/分 覆盖 2s 防抖的理论峰值(~30/分),并保留对恶意高频写的拦截。
   */
  canvasWrite: { ttl: 60_000, limit: 120 },
  /**
   * 画布创建:5 次/分(防批量创建空项目)
   */
  canvasCreate: { ttl: 60_000, limit: 5 },
  /**
   * 资源预签名:1000 次/分(单条端点兼容旧客户端;前端同步链路已改走
   * presign-batch 批量端点,正常流量下此配额几乎不会被触碰)
   */
  presign: { ttl: 60_000, limit: 1000 },
  /**
   * 媒体下载:3000 次/分。资源加载是用户可感知的关键路径(画布平移/缩放时
   * 节点按需拉取 LOD 档位),绝不能让正常浏览撞限流导致"图片加载不出来";
   * 仅作为匿名可读前缀(resources/public/*)与极端滥用的粗粒度防线。
   * 业务档独立计数,不叠加全局 short 100/分。
   */
  mediaRead: { ttl: 60_000, limit: 3000 },
} as const;

export type ThrottleTierName = keyof typeof THROTTLE_TIERS;

/** 全局默认三档名(业务档装饰器端点由 Guard 动态处理,不再叠加全局档) */
export const GLOBAL_TIER_NAMES = ['short', 'medium', 'long'] as const;

/**
 * 业务档位配置列表(排除全局三档)。
 * ⚠️ 仅供 tierDecorator 兜底查表与 ApiThrottlerGuard 动态档位读取;
 * 不得注册进 forRoot throttlers 数组(会导致所有端点叠加业务档限流,
 * sms 1次/分/register 5次/天 会直接卡死正常请求)。
 */
export const BUSINESS_THROTTLERS = (
  Object.entries(THROTTLE_TIERS) as Array<[string, { ttl: number; limit: number }]>
)
  .filter(([name]) => !(GLOBAL_TIER_NAMES as readonly string[]).includes(name))
  .map(([name, cfg]) => ({ name, ttl: cfg.ttl, limit: cfg.limit }));
