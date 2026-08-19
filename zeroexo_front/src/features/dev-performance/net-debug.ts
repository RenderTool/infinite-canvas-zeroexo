/**
 * net-debug.ts - 网络/上传链路调试数据总线(与 React 解耦,可在 api-client/services 中埋点)
 *
 * 设计原则(与 collab-debug.ts 一致):
 * - 所有埋点均为 O(1) 计数/时间戳/环形缓冲,零字符串拼接;
 * - 面板组件通过 snapshot() 拉取快照渲染,数据源与 UI 解耦;
 * - 埋点位置:
 *   1. api-client  rawFetch     → recordRequest(HTTP 请求计数/耗时/限流头/429)
 *   2. api-client  apiPutBinary → recordUpload(PUT 二进制上传吞吐)
 *   3. backend-upload/sync-resources → recordCas(CAS 去重命中反馈)
 *   4. api-client  presign 调用  → recordPresign(预签名耗时)
 */

/** 限流配额快照(解析自后端 RateLimit-* 响应头,RFC 9239 / GitHub 惯例) */
export interface RateLimitSnapshot {
  /** 端点分类 key(如 presign / resources / storage / default) */
  key: string;
  limit: number;
  remaining: number;
  /** 窗口重置时刻(unix 秒,后端返回 ISO 字符串需转 epoch) */
  resetAt: number;
  /** 记录时刻(performance.now),用于面板倒计时推算 */
  recordedAt: number;
}

/** 最近一次 429 事件诊断(后端 429 body 已带 tier/path/limit,直接透传展示) */
export interface ThrottleEvent {
  at: number; // performance.now
  path: string;
  tier: string;
  limit: number;
  remaining: number;
  retryAfter: number;
  autoRetried: boolean; // 是否已由 api-client 自动退避重试
}

export interface NetDebugSnapshot {
  totals: {
    requests: number;
    presignCalls: number;
    casHits: number; // CAS 去重命中(跳过 PUT)
    casMisses: number; // 正常上传
    uploads: number; // PUT 二进制完成数
    uploadBytes: number;
    http429: number;
    autoRetries: number; // 自动退避重试次数
  };
  /** 请求耗时环形缓冲(ms) */
  latencyRing: number[];
  /** presign 耗时环形缓冲(ms) */
  presignLatencyRing: number[];
  /** 各端点分类的最新限流配额 */
  rateLimits: RateLimitSnapshot[];
  /** 最近一次 429(无则 null) */
  last429: ThrottleEvent | null;
  /** 最近 8 次 429 事件(诊断列表) */
  throttleEvents: ThrottleEvent[];
  /** 瞬时上传吞吐 MB/s(基于最近 2 秒窗口) */
  uploadMBps: number;
}

const RING_SIZE = 60;
const EVENT_KEEP = 8;
/** 吞吐窗口:最近 2 秒内的上传字节数累计 */
const THROUGHPUT_WINDOW_MS = 2000;

/**
 * 监听总开关:默认关闭(面板默认收起 → 零监听开销)。
 * DevPerformancePanel 展开时 setEnabled(true),收起时关闭;
 * 关闭期间所有 record* 埋点立即返回,不写任何计数器/环形缓冲。
 */
let enabled = false;

const totals = {
  requests: 0,
  presignCalls: 0,
  casHits: 0,
  casMisses: 0,
  uploads: 0,
  uploadBytes: 0,
  http429: 0,
  autoRetries: 0,
};

const latencyRing: number[] = [];
let latencyCursor = 0;

const presignLatencyRing: number[] = [];
let presignCursor = 0;

/** key → 最新限流配额(Map 保持插入顺序) */
const rateLimits = new Map<string, RateLimitSnapshot>();

const throttleEvents: ThrottleEvent[] = [];

/** 吞吐滑窗:[performance.now, bytes][] 环形记录,超出窗口的惰性丢弃 */
const throughputWindow: Array<[number, number]> = [];

function pushRing(ring: number[], cursor: number, v: number): number {
  ring[cursor] = v;
  return (cursor + 1) % RING_SIZE;
}

function pushEvent(e: ThrottleEvent): void {
  throttleEvents.push(e);
  if (throttleEvents.length > EVENT_KEEP) throttleEvents.shift();
}

/** 计算瞬时吞吐:窗口内字节数 / 窗口实际跨度 */
function calcUploadMBps(now: number): number {
  // 清理过期样本
  while (throughputWindow.length > 0 && now - throughputWindow[0]![0] > THROUGHPUT_WINDOW_MS) {
    throughputWindow.shift();
  }
  if (throughputWindow.length === 0) return 0;
  let bytes = 0;
  for (const [, b] of throughputWindow) bytes += b;
  const spanMs = Math.max(100, now - throughputWindow[0]![0]);
  return bytes / 1024 / 1024 / (spanMs / 1000);
}

export const netDebug = {
  /** 监听开关(由面板展开/收起状态驱动;关闭时全部埋点 no-op) */
  setEnabled(v: boolean): void {
    enabled = v;
  },

  /** HTTP 请求完成埋点(含限流头解析结果与耗时) */
  recordRequest(opts: {
    path: string;
    status: number;
    durationMs: number;
    rateLimit?: { key: string; limit: number; remaining: number; resetAt: number };
    is429?: boolean;
    retryAfter?: number;
    autoRetried?: boolean;
    tier?: string;
  }): void {
    if (!enabled) return;
    totals.requests += 1;
    latencyCursor = pushRing(latencyRing, latencyCursor, opts.durationMs);
    if (opts.rateLimit) {
      rateLimits.set(opts.rateLimit.key, {
        ...opts.rateLimit,
        recordedAt: performance.now(),
      });
    }
    if (opts.is429) {
      totals.http429 += 1;
      if (opts.autoRetried) totals.autoRetries += 1;
      pushEvent({
        at: performance.now(),
        path: opts.path,
        tier: opts.tier ?? 'unknown',
        limit: opts.rateLimit?.limit ?? 0,
        remaining: opts.rateLimit?.remaining ?? 0,
        retryAfter: opts.retryAfter ?? 0,
        autoRetried: opts.autoRetried ?? false,
      });
    }
  },

  /** presign 调用埋点 */
  recordPresign(durationMs: number): void {
    if (!enabled) return;
    totals.presignCalls += 1;
    presignCursor = pushRing(presignLatencyRing, presignCursor, durationMs);
  },

  /** CAS 去重命中反馈(hit=true 表示后端已存在该哈希,跳过上传) */
  recordCas(hit: boolean): void {
    if (!enabled) return;
    if (hit) totals.casHits += 1;
    else totals.casMisses += 1;
  },

  /** PUT 二进制上传完成埋点 */
  recordUpload(bytes: number, durationMs: number): void {
    if (!enabled) return;
    totals.uploads += 1;
    totals.uploadBytes += bytes;
    const now = performance.now();
    throughputWindow.push([now, bytes]);
    latencyCursor = pushRing(latencyRing, latencyCursor, durationMs);
  },

  snapshot(): NetDebugSnapshot {
    return {
      totals: { ...totals },
      latencyRing: latencyRing.slice(),
      presignLatencyRing: presignLatencyRing.slice(),
      rateLimits: Array.from(rateLimits.values()),
      last429: throttleEvents.length > 0 ? throttleEvents[throttleEvents.length - 1]! : null,
      throttleEvents: throttleEvents.slice(),
      uploadMBps: calcUploadMBps(performance.now()),
    };
  },
};
