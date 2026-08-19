/**
 * collab-debug.ts - 协作光标/同步链路调试数据总线(与 React 解耦,可在非组件代码中埋点)
 *
 * 设计原则:
 * - 所有埋点均为 O(1) 计数/时间戳,零字符串拼接,不污染运行时性能;
 * - 面板组件通过 getSnapshot 拉取快照渲染,数据源与 UI 解耦;
 * - 埋点位置:
 *   1. use-editor-state  onPointerMove       → recordPointerEvent
 *   2. use-collaboration setLocalCursor/apply → recordThrottled / recordBroadcast
 *   3. collab-overlay    本地光标 rAF apply   → recordLocalApply
 *   4. collab-overlay    subscribeRemoteAwareness → recordWsAwareness
 */

interface RenderLagStats {
  avgMs: number;
  maxMs: number;
  /** 窗口内超过 LAG_WARN_MS 的采样占比(0-1):单帧尖峰(点击/弹窗等交互)不计异常,持续超时才告警 */
  badRatio: number;
}

interface CollabDebugTotals {
  pointerEvents: number; // 本地指针事件计数(原生事件线)
  broadcasts: number; // 实际广播(节流放行)次数
  throttled: number; // 被节流合并的丢弃次数
  wsAwarenessEvents: number; // 远端 awareness 事件累加条数
}

/** 本地光标渲染延迟采样窗口 */
const LAG_BUF_SIZE = 60;
/** 单次采样超过该值(ms)记为"超时采样"(用于持续异常判定) */
const LAG_WARN_MS = 25;

/**
 * 监听总开关:默认关闭(面板默认收起 → 零监听开销)。
 * DevPerformancePanel 展开时 setEnabled(true),收起时关闭;
 * 关闭期间所有 record* 埋点立即返回。
 */
let enabled = false;

const counter = {
  pointerEvents: 0,
  broadcasts: 0,
  throttled: 0,
  wsAwarenessEvents: 0,
};

/** 最近一次本地指针事件的时刻(performance.now),用于计算渲染延迟 */
let pendingEventAt = 0;

/** 渲染延迟环形缓冲(最近 ~60 次) */
const lagRing: number[] = [];
let lagCursor = 0;

/** 光标世界坐标(供面板回显;仅调试用,不频繁写) */
let lastLocalCursor: { x: number; y: number } | null = null;

export const collabDebug = {
  /** 监听开关(由面板展开/收起状态驱动;关闭时全部埋点 no-op) */
  setEnabled(v: boolean): void {
    enabled = v;
  },

  /** 本地指针事件到达(原生事件线,零节流) */
  recordPointerEvent(cursor: { x: number; y: number } | null, now = performance.now()): void {
    if (!enabled) return;
    counter.pointerEvents += 1;
    pendingEventAt = now;
    if (cursor) lastLocalCursor = cursor;
  },

  /** 本地光标 rAF 实际渲染时刻(用于计算事件→渲染延迟) */
  recordLocalApply(now = performance.now()): void {
    if (!enabled) return;
    if (pendingEventAt > 0) {
      const lag = now - pendingEventAt;
      if (lag >= 0) {
        lagRing[lagCursor] = lag;
        lagCursor = (lagCursor + 1) % LAG_BUF_SIZE;
      }
    }
  },

  /** 广播放行(stringify + 发送) */
  recordBroadcast(): void {
    if (!enabled) return;
    counter.broadcasts += 1;
  },

  /** 进入节流窗口被合并(不发送,仅记录 p 最新位置) */
  recordThrottled(): void {
    if (!enabled) return;
    counter.throttled += 1;
  },

  /** 远端 awareness 事件(WS/BC)到达条数 */
  recordWsAwareness(count: number): void {
    if (!enabled) return;
    counter.wsAwarenessEvents += count;
  },

  totals(): CollabDebugTotals {
    return { ...counter };
  },

  renderLag(): RenderLagStats {
    if (lagRing.length === 0) return { avgMs: 0, maxMs: 0, badRatio: 0 };
    let sum = 0;
    let max = 0;
    let bad = 0;
    for (const v of lagRing) {
      sum += v;
      if (v > max) max = v;
      if (v > LAG_WARN_MS) bad += 1;
    }
    return { avgMs: sum / lagRing.length, maxMs: max, badRatio: bad / lagRing.length };
  },

  lastCursor(): { x: number; y: number } | null {
    return lastLocalCursor;
  },
};