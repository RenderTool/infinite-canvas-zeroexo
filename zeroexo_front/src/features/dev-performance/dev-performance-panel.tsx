import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { CommandQueue, GraphModel } from '@zeroexo/core';
import { AddNodeCommand, BatchCommand } from '@zeroexo/core';
import { collabDebug } from './collab-debug.js';
import { netDebug } from './net-debug.js';
import type { NetDebugSnapshot } from './net-debug.js';
import { useCollaborationStore } from '@/features/collaboration/use-collaboration-store.js';

// ============================================================================
// 压力测试注入器 — 类型与常量
// ============================================================================

/** 注入模式 */
type InjectMode = 'replace' | 'add';

/** 节点类型 */
type NodeType = 'empty' | 'image' | 'video' | 'audio' | 'text';

/** 媒体源模式 */
type MediaSource = 'empty' | 'publicPrompts' | 'seed';

/** 渐进档位 */
const BATCH_SIZES = [1, 10, 30, 100, 500] as const;

/** 最大滚动条上限 */
const MAX_SLIDER_COUNT = 2000;

/** 每帧最大追加节点数（防主线程阻塞） */
const CHUNK_SIZE = 50;

/** 各节点类型对应的 React Flow type 字符串（待 T4/T5 扩展真实媒体源） */
const NODE_TYPE_MAP: Record<Exclude<NodeType, 'empty'>, string> = {
  image: 'stacked-media',
  video: 'video',
  audio: 'audio',
  text: 'script',
};

// ============================================================================
// DevPerformancePanel — 主体（Docstring 不变）
// ============================================================================

/**
 * DevPerformancePanel - 画布运行期调试 GUI(左上角性能面板)
 *
 * 装在顶部工具栏(54px)下方:不遮挡左上角 Logo("回主页")入口。
 * 专业调试台设计:页签化 + 统一的指标行渲染,后续调试模块(网络/同步/渲染详情等)
 * 只需新增 DebugTab 分支即可扩展。折叠时仅渲染一个按钮,零运行时开销。
 *
 * 页签:
 * - CANVAS : 画布运行期采样(FPS / frame / heap / 规模 / 压力注入 / 采样导出)
 * - COLLAB : 协作光标/同步链路统计(埋点全部 O(1) 计数,1s 刷新)
 * - NET    : 网络/上传链路(限流配额实时显示 / CAS 去重命中率 / 上传吞吐 / 429 诊断)
 *
 * 信息均以中文呈现:异常状态用红/黄高亮提示条 + 优化方向说明。
 */
interface PerformanceSnapshot {
  fps: number;
  frameMs: number;
  nodes: number;
  edges: number;
  heapMb?: number;
  bottleneck: string;
}

/** 采样快照 + 采集时刻上下文(供导出分析) */
interface CaptureSample {
  t: number; // 距面板打开的毫秒数
  k: number; // 采集时视口缩放,用于区分 idle / pan / zoom 场景
  selected: number; // 选中节点数
  fps: number;
  frameMs: number;
  nodes: number;
  edges: number;
  heapMb?: number;
  bottleneck: string;
}

/** 采样日志上限(防止长时间悬挂内存膨胀) */
const MAX_CAPTURE_SAMPLES = 240;

/** 调试页签(可扩展:后续调试模块在此追加) */
type DebugTab = 'perf' | 'collab' | 'net';

/** 协作光标链路调试快照 */
interface CollabSnapshot {
  active: boolean;
  hasLocalCursor: boolean;
  localCursor: { x: number; y: number } | null;
  remoteCount: number;
  staleMs: number | null;
  totals: ReturnType<typeof collabDebug['totals']>;
  lagAvg: number;
  lagMax: number;
  /** 近 60 次采样中 >25ms 的占比(0-1):点击等瞬时交互尖峰不计异常 */
  lagBadRatio: number;
}

function collectCollab(): CollabSnapshot {
  const s = useCollaborationStore.getState();
  const now = Date.now();
  let staleMs: number | null = null;
  let remoteCount = 0;
  for (const a of s.awarenessStates.values()) {
    if (a.clientId === (s.localAwareness?.clientId ?? -1)) continue;
    remoteCount += 1;
    if (a.lastUpdated) {
      const age = now - a.lastUpdated;
      if (staleMs === null || age < staleMs) staleMs = age;
    }
  }
  const lag = collabDebug.renderLag();
  return {
    active: s.active,
    hasLocalCursor: s.localAwareness?.cursor != null,
    localCursor: s.localAwareness?.cursor ?? null,
    remoteCount,
    staleMs,
    totals: collabDebug.totals(),
    lagAvg: Math.round(lag.avgMs * 10) / 10,
    lagMax: Math.round(lag.maxMs * 10) / 10,
    lagBadRatio: Math.round(lag.badRatio * 100) / 100,
  };
}

interface DevPerformancePanelProps {
  store: ReactGraphStore;
  commandQueue: CommandQueue | null;
  syncStatus?: string;
}

interface PerformanceMemory {
  usedJSHeapSize: number;
}

function getHeapMb(): number | undefined {
  const memory = (performance as Performance & { memory?: PerformanceMemory }).memory;
  return memory ? Math.round(memory.usedJSHeapSize / 1024 / 1024) : undefined;
}

function classify(snapshot: Omit<PerformanceSnapshot, 'bottleneck'>): string {
  if (snapshot.fps < 45) return 'render / paint';
  if (snapshot.edges > 50_000) return 'edge density';
  if (snapshot.nodes > 1_000) return 'node volume';
  if (snapshot.heapMb !== undefined && snapshot.heapMb > 700) return 'memory';
  return 'nominal';
}

/** 调试台统一指标行:label 灰、value 彩色右对齐 */
function DbgRow({ label, value, color = '#e8edf2' }: { label: string; value: string; color?: string }): React.ReactElement {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, whiteSpace: 'nowrap' }}>
      <span style={{ color: '#8a93a0' }}>{label}</span>
      <span style={{ color }}>{value}</span>
    </div>
  );
}

/** 云同步状态 → 中文描述 */
const SYNC_TEXT: Record<string, string> = {
  idle: '已同步',
  syncing: '同步中…',
  error: '同步失败',
  inactive: '未连接',
};

/** 性能瓶颈 → 中文名称 */
const BOTTLENECK_ZH: Record<string, string> = {
  'render / paint': '渲染 / 绘制',
  'edge density': '边密度',
  'node volume': '节点规模',
  memory: '内存',
  nominal: '正常',
};

/** 性能异常诊断:返回高亮色 + 优化方向(供开发者定位瓶颈) */
function perfHint(s: PerformanceSnapshot): { color: string; text: string } | null {
  if (s.bottleneck === 'nominal') return { color: '#b8f2d0', text: '各项指标在预期范围内,当前无显著瓶颈。' };
  switch (s.bottleneck) {
    case 'render / paint':
      return { color: '#ff9d9d', text: '帧率低于 45fps,渲染/绘制为瓶颈。优化方向:合并重绘与布局抖动、降低节点绘制复杂度。' };
    case 'edge density':
      return { color: '#ffd28a', text: '边数量超过 5 万,连线密度成为瓶颈。优化方向:按视口裁剪连线渲染、合并次要边。' };
    case 'node volume':
      return { color: '#ffd28a', text: '节点数超过 1000,规模成为瓶颈。优化方向:启用分组/折叠、列表虚拟化渲染。' };
    case 'memory':
      return { color: '#ffd28a', text: '堆内存超过 700MB。优化方向:检查节点数据/图片资源的销毁与缓存释放。' };
    default:
      return null;
  }
}

/** 协作链路异常诊断:返回高亮色 + 优化方向 */
function collabHint(c: CollabSnapshot, showSelfCursor: boolean): { color: string; text: string } | null {
  if (!c.active) return { color: '#ff9d9d', text: '协作房间未连接。请检查网络,或重新打开协作弹窗确认邀请码/房间 ID 是否有效。' };
  if (c.staleMs !== null && c.staleMs > 1000) return { color: '#ffd28a', text: '远端光标数据陈旧(>1s),同步链路存在延迟。优化方向:检查 WebSocket/广播通道,压缩 awareness 载荷。' };
  // 持续异常判定:近 60 次采样中超时(>25ms)占比 ≥25% 才告警;点击/弹窗等瞬时交互尖峰不计异常
  if (showSelfCursor && c.lagBadRatio >= 0.25) return { color: '#ffd28a', text: '本地光标渲染持续延迟偏高(近 60 次采样中超过 25ms 的占比达 25% 以上)。优化方向:检查画布交互时的大范围同步重绘(如节点命令/选中态变化)。' };
  if (!showSelfCursor) return { color: '#b8f2d0', text: '协作光标/同步链路正常。本地光标(自检)已隐藏,如需调试请开启「显示我的光标」。' };
  return { color: '#b8f2d0', text: '协作光标/同步链路正常,无异常(点击等操作的瞬时尖峰不计入)。' };
}

/** 字节数 → 可读文本 */
function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 环形缓冲平均值 */
function ringAvg(ring: number[]): number {
  if (ring.length === 0) return 0;
  let sum = 0;
  for (const v of ring) sum += v;
  return sum / ring.length;
}

/** NET 页签诊断:429/限流告警 + 正常态说明 */
function netHint(s: NetDebugSnapshot): { color: string; text: string } {
  if (s.last429) {
    const e = s.last429;
    return {
      color: '#ff9d9d',
      text: `检测到 429 限流:${e.path}(档位 ${e.tier}，上限 ${e.limit} 次/窗口，服务端建议等待 ${e.retryAfter}s)${e.autoRetried ? '，已自动退避重试' : '。优化方向:降低并发或启用批量端点。'}`,
    };
  }
  // 配额告警:任一端点剩余 <10% 提前预警
  const low = s.rateLimits.find((r) => r.limit > 0 && r.remaining / r.limit < 0.1);
  if (low) {
    return {
      color: '#ffd28a',
      text: `「${low.key}」端点限流配额即将耗尽(${low.remaining}/${low.limit})，客户端已自动降速。建议改用批量端点减少请求次数。`,
    };
  }
  const total = s.totals.casHits + s.totals.casMisses;
  const rate = total > 0 ? Math.round((s.totals.casHits / total) * 100) : 0;
  return {
    color: '#b8f2d0',
    text: `网络/上传链路正常，无 429。CAS 去重命中率 ${rate}%(命中即跳过 PUT 上传)。`,
  };
}

/** 诊断提示条:红=严重,黄=警告,绿=正常;附开发者优化方向 */
function DbgHint({ color, text }: { color: string; text: string }): React.ReactElement {
  const danger = color === '#ff9d9d';
  return (
    <div
      style={{
        marginTop: 6,
        padding: '5px 7px',
        borderRadius: 5,
        background: danger ? 'rgba(255,157,157,0.10)' : 'rgba(255,210,138,0.10)',
        border: '1px solid',
        borderColor: danger ? 'rgba(255,157,157,0.45)' : 'rgba(255,210,138,0.45)',
        color,
        fontSize: 10,
        lineHeight: 1.55,
      }}
    >
      {text}
    </div>
  );
}

/** 页签按钮样式 */
function tabBtnStyle(activeTab: DebugTab, tab: DebugTab): CSSProperties {
  const active = activeTab === tab;
  return {
    border: 'none',
    borderRadius: 5,
    background: active ? 'rgba(127,216,255,0.16)' : 'transparent',
    color: active ? '#7fd8ff' : '#8a93a0',
    padding: '3px 10px',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: active ? 700 : 400,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    boxShadow: active ? 'inset 0 0 0 1px rgba(127,216,255,0.4)' : 'none',
  };
}

export function DevPerformancePanel({ store, commandQueue, syncStatus }: DevPerformancePanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DebugTab>('perf');
  const [recording, setRecording] = useState(false);
  const [injecting, setInjecting] = useState(false);
  const [injectInfo, setInjectInfo] = useState<string | null>(null);
  const [capture, setCapture] = useState<CaptureSample[]>([]);
  const [exportInfo, setExportInfo] = useState<string | null>(null);
  const startTimeRef = useRef(performance.now());
  const [snapshot, setSnapshot] = useState<PerformanceSnapshot>({
    fps: 0,
    frameMs: 0,
    nodes: 0,
    edges: 0,
    bottleneck: 'off',
  });

  // ---- 协作页签状态 ----
  const [collabEnabled, setCollabEnabled] = useState(true);
  const [collabSnap, setCollabSnap] = useState<CollabSnapshot>(() => collectCollab());
  // 本地光标(自检)开关:默认关闭;开启后画布才渲染自己的光标,便于渲染链路自检
  const showSelfCursor = useCollaborationStore((s) => s.showSelfCursor);
  const setShowSelfCursor = useCollaborationStore((s) => s.setShowSelfCursor);

  // ---- 压力测试注入器状态 ----
  const [injectMode, setInjectMode] = useState<InjectMode>('replace');
  const [sliderCount, setSliderCount] = useState(100);
  const [nodeType, setNodeType] = useState<NodeType>('empty');
  const [mediaSource, setMediaSource] = useState<MediaSource>('empty');
  // 取消注入的 abort controller
  const injectAbortRef = useRef<AbortController | null>(null);

  // ---- NET 网络/上传页签状态 ----
  const [netSnap, setNetSnap] = useState<NetDebugSnapshot>(() => netDebug.snapshot());

  // 数据总线监听总开关:面板默认收起 → 全部埋点 no-op(零监听开销);
  // 展开时开启累计,收起时立即关闭——收起状态不保留任何监听。
  useEffect(() => {
    netDebug.setEnabled(open);
    collabDebug.setEnabled(open);
  }, [open]);

  // NET 指标 1s 刷新(仅 NET 页签展开时;面板收起时数据总线已整体停监听)
  useEffect(() => {
    if (!open || tab !== 'net') return;
    const timer = window.setInterval(() => setNetSnap(netDebug.snapshot()), 1000);
    return () => window.clearInterval(timer);
  }, [open, tab]);

  // 协作指标 1s 刷新(仅 COLLAB 页签展开时;面板收起时数据总线已整体停监听)
  useEffect(() => {
    if (!open || tab !== 'collab') return;
    const timer = window.setInterval(() => {
      if (collabEnabled) setCollabSnap(collectCollab());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [open, tab, collabEnabled]);

  // 录制开关:点击 START 才进入采样循环,RECORD 期间才有 RAF + setState 开销;
  // 面板平时(哪怕开着)零运行时消耗,不污染画布性能。
  const handleToggleRecord = useCallback(() => {
    if (recording) {
      // STOP:冻结当前采集
      setRecording(false);
      return;
    }
    // START:每次录制从空开始,便于分段导出分析
    setCapture([]);
    setExportInfo(null);
    startTimeRef.current = performance.now();
    setRecording(true);
  }, [recording]);

  useEffect(() => {
    // 仅录制期间运行;面板开着但未录制时无任何采样循环。
    // recording 必须作为依赖,否则点击 START 时 effect 不会重跑,采样循环无法启动。
    if (!open || !recording) return;
    let frame = 0;
    let last = performance.now();
    let frames = 0;
    let windowStart = last;
    let running = true;

    const sample = (now: number) => {
      if (!running) return;
      frames += 1;
      const frameMs = now - last;
      last = now;
      if (now - windowStart >= 500) {
        const graph = store.getGraph();
        const fps = Math.round((frames * 1000) / (now - windowStart));
        const base = { fps, frameMs: Math.round(frameMs * 10) / 10, nodes: graph.nodes.length, edges: graph.edges.length, heapMb: getHeapMb() };
        const tagged = { ...base, bottleneck: classify(base) };
        setSnapshot(tagged);
        setCapture((prev) => {
          const next = [
            ...prev,
            {
              t: Math.round(now - startTimeRef.current),
              k: Math.round(store.getViewport().k * 1000) / 1000,
              selected: store.getSelection().selectedNodeIds.size,
              ...tagged,
            },
          ];
          return next.length > MAX_CAPTURE_SAMPLES ? next.slice(-MAX_CAPTURE_SAMPLES) : next;
        });
        frames = 0;
        windowStart = now;
      }
      frame = requestAnimationFrame(sample);
    };

    frame = requestAnimationFrame(sample);
    return () => {
      running = false;
      cancelAnimationFrame(frame);
    };
  }, [store, open, recording]);

  /** 导出采集日志为 JSON(剪贴板优先,失败则打印到 console 兜底) */
  const handleExport = useCallback(async () => {
    if (capture.length === 0) {
      setExportInfo('暂无采样数据,请先点击「开始采样」');
      return;
    }
    const payload = {
      tool: 'zeroexo dev-performance',
      capturedAt: new Date().toISOString(),
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : undefined,
      sampleWindowMs: 500,
      samples: capture,
    };
    const json = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setExportInfo(`已复制 ${capture.length} 条采样到剪贴板`);
    } catch {
      // 剪贴板不可用(权限/非安全上下文):打印到 console,从 console 复制
      console.log('[dev-performance] export samples:\n' + json);
      setExportInfo(`剪贴板不可用,已输出 ${capture.length} 条采样到控制台(console)`);
    }
  }, [capture]);

  /**
   * 生成单个节点数据（空结构），后续 T4/T5 扩展真实媒体源
   * @param id   唯一 ID
   * @param type 节点类型
   * @param idx  序号（用于生成不重复位置）
   */
  function makeNode(id: string, type: NodeType, idx: number) {
    // 网格排列：每行 20 个，间距 220px
    const col = idx % 20;
    const row = Math.floor(idx / 20);
    const base = { x: 80 + col * 220, y: 80 + row * 200 };

    const typeStr = type === 'empty' ? 'stacked-media' : NODE_TYPE_MAP[type];

    // 空节点默认数据（图片节点为 stacked-media，内容区为空时显示空态占位图）
    const data: Record<string, unknown> = {
      nodeType: typeStr,
      content: null,
      locked: false,
      label: `${typeStr}-${id}`,
    };

    // 图片/视频/音频节点: content 为资源引用结构（后续 T4/T5 替换为真实 source）
    if (type !== 'empty' && type !== 'text') {
      data.content = { type, storageKey: null, url: null };
    }

    return {
      id,
      type: typeStr,
      position: base,
      data,
    };
  }

  /**
   * 分帧追加节点（每帧 CHUNK_SIZE 个，防止主线程阻塞）
   * 返回追加完成时的节点数
   */
  function addNodesIncremental(
    count: number,
    type: NodeType,
    onProgress: (done: number) => void,
  ): Promise<number> {
    return new Promise((resolve) => {
      const baseCount = store.getGraph().nodes.length;
      let done = 0;

      const scheduleChunk = () => {
        if (injectAbortRef.current?.signal.aborted) {
          resolve(done);
          return;
        }
        const batch = Math.min(CHUNK_SIZE, count - done);
        if (batch <= 0) {
          resolve(done);
          return;
        }

        const nodes = Array.from({ length: batch }, (_, i) =>
          makeNode(`stress-${Date.now()}-${done + i}`, type, baseCount + done + i),
        );

        if (!commandQueue) return;
        commandQueue.execute(
          new BatchCommand(
            nodes.map((n) => new AddNodeCommand(n as AddNodeCommand['node'])),
            `stress-batch-${Date.now()}`,
          ),
        );
        done += batch;
        onProgress(done);

        // 让出主线程，避免卡顿
        setTimeout(scheduleChunk, 0);
      };

      scheduleChunk();
    });
  }

  /**
   * 统一注入入口:
   * - replace 模式: 拉取 /stress/stress-1000.json → replaceState（全量替换，保持向下兼容）
   * - add 模式:    按 nodeType/sliderCount/mediaSource 生成节点 → 分帧 addNodes（渐进追加）
   */
  const handleInjectNodes = useCallback(async () => {
    if (injecting) return;
    setInjecting(true);
    setInjectInfo(null);

    // 若已有注入在跑，先中止
    injectAbortRef.current?.abort();
    injectAbortRef.current = new AbortController();

    try {
      if (injectMode === 'replace') {
        // ---- 向下兼容：全量替换 ----
        const res = await fetch('/stress/stress-1000.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const graph = (await res.json()) as GraphModel & { viewport: { x: number; y: number; k: number } };
        commandQueue?.replaceState(graph);
        store.setViewport(graph.viewport ?? { x: 80, y: 80, k: 0.42 });
        setInjectInfo(`替换成功:${graph.nodes.length} 节点 / ${graph.edges.length} 边`);
      } else {
        // ---- 渐进追加 ----
        const count = sliderCount;
        const done = await addNodesIncremental(count, nodeType, (p) => {
          setInjectInfo(`追加中: ${p}/${count} 节点…`);
        });
        const totalNow = store.getGraph().nodes.length;
        setInjectInfo(`追加完成:+${done} 节点(总计 ${totalNow})`);
      }
    } catch (err) {
      setInjectInfo(`注入失败:${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInjecting(false);
      injectAbortRef.current = null;
    }
  }, [injecting, injectMode, sliderCount, nodeType, commandQueue, store]);

  /** 停止追加（发送 abort 信号） */
  const handleStopInject = useCallback(() => {
    injectAbortRef.current?.abort();
    setInjectInfo((prev) => (prev ? `${prev} [已停止]` : '[已停止]'));
    setInjecting(false);
  }, []);

  // 渲染时实时读取画布规模(面板渲染频率极低,纯读无成本);与采样解耦,
  // 不录制也能看到 nodes/edges 实时数字。
  const liveGraph = store.getGraph();

  const buttonSuffix =
    tab === 'collab'
      ? collabSnap.active
        ? `⌖${collabSnap.remoteCount}`
        : '○'
      : tab === 'net'
        ? netSnap.totals.http429 > 0
          ? `429×${netSnap.totals.http429}`
          : `${netSnap.uploadMBps.toFixed(1)}M/s`
        : recording
          ? `${snapshot.fps} FPS`
          : `${liveGraph.nodes.length}N`;

  const t = collabSnap.totals;
  const roomColor = collabSnap.active ? '#b8f2d0' : '#ff9d9d';
  const staleColor = collabSnap.staleMs === null || collabSnap.staleMs < 150 ? '#8a93a0' : collabSnap.staleMs < 1000 ? '#b8f2d0' : '#ffd28a';
  const liveColor = collabEnabled ? '#7fd8ff' : '#8a93a0';

  /** 诊断结果:异常时高亮提示条 + 优化方向(红=严重 / 黄=警告 / 绿=正常) */
  const perfDiag = recording ? perfHint(snapshot) : null;
  const collabDiag = collabHint(collabSnap, showSelfCursor);

  return (
    <div
      data-dev-performance
      style={{
        // 征集 #87 验收轮:移画布左下角(原左上角 top:62 碍眼);展开时向上生长,限高内部滚动
        position: 'fixed',
        bottom: 64,
        left: 12,
        zIndex: 1200,
        maxHeight: 'calc(100vh - 160px)',
        overflowY: 'auto',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        color: '#e8edf2',
        pointerEvents: 'auto',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 6,
          background: 'rgba(20,24,28,0.88)',
          color: tab === 'collab' ? '#7fd8ff' : tab === 'net' ? '#c792ea' : '#b8f2d0',
          padding: '5px 8px',
          cursor: 'pointer',
          boxShadow: '0 8px 22px rgba(0,0,0,0.18)',
        }}
      >
        {tab === 'collab' ? 'COLLAB' : tab === 'net' ? 'NET' : 'PERF'} {buttonSuffix}
      </button>
      {open ? (
        <div
          style={{
            marginTop: 6,
            minWidth: 268,
            padding: 10,
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 8,
            background: 'rgba(20,24,28,0.94)',
            boxShadow: '0 16px 42px rgba(0,0,0,0.28)',
            lineHeight: 1.7,
          }}
        >
          {/* 页签栏:专业调试台多模块入口 */}
          <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid rgba(255,255,255,0.12)', paddingBottom: 5, marginBottom: 8 }}>
            <button type="button" onClick={() => setTab('perf')} style={tabBtnStyle(tab, 'perf')}>CANVAS</button>
            <button type="button" onClick={() => setTab('collab')} style={tabBtnStyle(tab, 'collab')}>COLLAB</button>
            <button type="button" onClick={() => setTab('net')} style={tabBtnStyle(tab, 'net')}>NET</button>
          </div>

          {tab === 'net' ? (
            <>
              <div style={{ color: '#c792ea', marginBottom: 4 }}>网络 / 上传链路(NET)</div>
              {(() => {
                const nt = netSnap.totals;
                const casTotal = nt.casHits + nt.casMisses;
                const casRate = casTotal > 0 ? Math.round((nt.casHits / casTotal) * 100) : 0;
                const nowSec = Date.now() / 1000;
                return (
                  <>
                    <DbgRow label="HTTP 请求" value={String(nt.requests)} />
                    <DbgRow
                      label="429 限流"
                      value={nt.http429 === 0 ? '无' : `${nt.http429} 次(自动退避 ${nt.autoRetries} 次)`}
                      color={nt.http429 === 0 ? '#b8f2d0' : '#ff9d9d'}
                    />
                    <DbgRow
                      label="presign 调用"
                      value={`${nt.presignCalls} 次 · 均 ${Math.round(ringAvg(netSnap.presignLatencyRing))}ms`}
                    />
                    {/* CAS 去重命中反馈(含命中率进度条) */}
                    <DbgRow
                      label="CAS 去重命中"
                      value={casTotal === 0 ? '无上传' : `${nt.casHits}/${casTotal} · ${casRate}%`}
                      color={casRate >= 50 ? '#7fd8ff' : '#e8edf2'}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0 4px' }}>
                      <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                        <div style={{ width: `${casRate}%`, height: '100%', background: '#7fd8ff', borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 9, color: '#8a93a0', whiteSpace: 'nowrap' }}>命中率(命中=跳过 PUT)</span>
                    </div>
                    <DbgRow
                      label="上传完成"
                      value={`${nt.uploads} 个 · ${fmtBytes(nt.uploadBytes)}`}
                    />
                    <DbgRow
                      label="瞬时吞吐"
                      value={`${netSnap.uploadMBps.toFixed(1)} MB/s`}
                      color="#7fd8ff"
                    />

                    {/* 限流配额实时显示(解析自后端 RateLimit-* 响应头) */}
                    <div style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 6 }}>
                      <div style={{ color: '#c792ea', marginBottom: 2, fontSize: 10 }}>限流配额(RFC 9239 响应头)</div>
                      {netSnap.rateLimits.length === 0 ? (
                        <div style={{ fontSize: 10, color: '#8a93a0' }}>暂无数据(发起任意 API 请求后显示)</div>
                      ) : (
                        netSnap.rateLimits.map((r) => {
                          const pct = r.limit > 0 ? Math.round((r.remaining / r.limit) * 100) : 100;
                          const resetSec = r.resetAt > 0 ? Math.max(0, Math.ceil(r.resetAt - nowSec)) : 0;
                          const barColor = pct < 10 ? '#ff9d9d' : pct < 40 ? '#ffd28a' : '#b8f2d0';
                          return (
                            <div key={r.key} style={{ marginBottom: 3 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                                <span style={{ color: '#8a93a0' }}>/{r.key}</span>
                                <span style={{ color: barColor }}>
                                  {r.remaining}/{r.limit}{resetSec > 0 ? ` · ${resetSec}s 重置` : ''}
                                </span>
                              </div>
                              <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: barColor }} />
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* 429 事件诊断(后端返回的 tier/path/limit 透传) */}
                    {netSnap.throttleEvents.length > 0 ? (
                      <div style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 6 }}>
                        <div style={{ color: '#ff9d9d', marginBottom: 2, fontSize: 10 }}>429 事件(最近 {netSnap.throttleEvents.length} 条)</div>
                        {netSnap.throttleEvents.slice().reverse().slice(0, 4).map((e, i) => (
                          <div key={`${e.at}-${i}`} style={{ fontSize: 9, color: '#ffd28a', lineHeight: 1.5 }}>
                            {e.path} · 档位 {e.tier} · 限 {e.limit} · 退避 {e.retryAfter}s{e.autoRetried ? ' · 已重试' : ''}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                );
              })()}
              <DbgHint color={netHint(netSnap).color} text={netHint(netSnap).text} />
              <div style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 6, fontSize: 10, color: '#8a93a0' }}>
                埋点在 api-client / upload 链路,O(1) · 429 自动指数退避+抖动重试
              </div>
            </>
          ) : tab === 'collab' ? (
            <>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                <span style={{ color: '#7fd8ff' }}>协作同步</span>
                <button
                  type="button"
                  onClick={() => setCollabEnabled((v) => !v)}
                  style={{
                    border: '1px solid rgba(255,255,255,0.18)',
                    borderRadius: 4,
                    background: collabEnabled ? 'rgba(127,216,255,0.16)' : 'rgba(255,255,255,0.05)',
                    color: liveColor,
                    fontSize: 10,
                    padding: '1px 6px',
                    cursor: 'pointer',
                  }}
                >
                  {collabEnabled ? '实时' : '已暂停'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                <span style={{ color: '#8a93a0', fontSize: 10 }}>我的光标(自检)</span>
                <button
                  type="button"
                  onClick={() => setShowSelfCursor(!showSelfCursor)}
                  style={{
                    border: '1px solid rgba(255,255,255,0.18)',
                    borderRadius: 4,
                    background: showSelfCursor ? 'rgba(127,216,255,0.16)' : 'rgba(255,255,255,0.05)',
                    color: showSelfCursor ? '#7fd8ff' : '#8a93a0',
                    fontSize: 10,
                    padding: '1px 6px',
                    cursor: 'pointer',
                  }}
                >
                  {showSelfCursor ? '显示中' : '已隐藏'}
                </button>
              </div>
              <DbgRow label="房间状态" value={collabSnap.active ? '已连接' : '未连接'} color={roomColor} />
              <DbgRow
                label="我的光标"
                value={collabSnap.localCursor ? `(${collabSnap.localCursor.x.toFixed(0)}, ${collabSnap.localCursor.y.toFixed(0)})` : '关闭'}
                color={collabSnap.hasLocalCursor ? '#b8f2d0' : '#8a93a0'}
              />
              <DbgRow
                label="远端光标"
                value={`${collabSnap.remoteCount}${collabSnap.staleMs !== null ? ` · 陈旧 ${collabSnap.staleMs}ms` : ''}`}
                color={staleColor}
              />
              <DbgRow label="指针事件(本地)" value={String(t.pointerEvents)} />
              <DbgRow label="广播发送(放行)" value={String(t.broadcasts)} />
              <DbgRow label="节流丢弃" value={String(t.throttled)} color="#ffd28a" />
              <DbgRow label="远端坐标事件" value={String(t.wsAwarenessEvents)} />
              <DbgRow
                label="事件→渲染延迟"
                value={showSelfCursor ? `${collabSnap.lagAvg}ms 均值 · ${collabSnap.lagMax}ms 峰值 · 超时${Math.round(collabSnap.lagBadRatio * 100)}%` : '自检关闭'}
                color={!showSelfCursor ? '#8a93a0' : collabSnap.lagBadRatio >= 0.25 ? '#ffd28a' : '#b8f2d0'}
              />
              {collabDiag ? <DbgHint color={collabDiag.color} text={collabDiag.text} /> : null}
              <div style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 6, fontSize: 10, color: '#8a93a0' }}>
                O(1) 埋点,1 秒刷新 · 新增调试页签见 DevPerformancePanel
              </div>
            </>
          ) : (
            <>
              <div style={{ color: '#b8f2d0', marginBottom: 4 }}>画布运行时(Canvas)</div>
              <DbgRow label="节点 / 边" value={`${liveGraph.nodes.length} / ${liveGraph.edges.length}`} />
              <DbgRow
                label="帧率 / 帧耗时"
                value={recording ? `${snapshot.fps} fps · ${snapshot.frameMs}ms` : '未采样'}
                color={!recording ? '#8a93a0' : snapshot.fps < 45 ? '#ff9d9d' : '#b8f2d0'}
              />
              <DbgRow
                label="堆内存"
                value={recording && snapshot.heapMb !== undefined ? `${snapshot.heapMb} MB` : '未采样'}
                color={!recording || snapshot.heapMb === undefined ? '#8a93a0' : snapshot.heapMb > 700 ? '#ffd28a' : '#b8f2d0'}
              />
              <DbgRow
                label="云同步状态"
                value={SYNC_TEXT[syncStatus ?? 'idle'] ?? String(syncStatus)}
                color={syncStatus === 'error' ? '#ff9d9d' : syncStatus === 'syncing' ? '#ffd28a' : '#b8f2d0'}
              />
              <DbgRow
                label="瓶颈定位"
                value={recording ? (BOTTLENECK_ZH[snapshot.bottleneck] ?? snapshot.bottleneck) : '未采样'}
                color={!recording ? '#8a93a0' : snapshot.bottleneck === 'nominal' ? '#b8f2d0' : '#ffd28a'}
              />
              {recording ? (
                perfDiag ? <DbgHint color={perfDiag.color} text={perfDiag.text} /> : null
              ) : (
                <DbgHint color="#ffd28a" text="未开启采样。点击「开始采样」录制 5 秒窗口,可自动定位瓶颈并给出优化方向。" />
              )}
              {syncStatus === 'error' ? (
                <DbgHint color="#ff9d9d" text="云同步失败:请点击标题旁的红色同步徽标重试,并检查网络连接。" />
              ) : null}
              <div style={{ marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={handleToggleRecord}
                  style={{
                    ...btnStyle(recording ? 'rgba(255,84,84,0.22)' : 'rgba(255,255,255,0.06)'),
                    color: recording ? '#ff9d9d' : '#e8edf2',
                  }}
                >
                  {recording ? '停止采样 ●' : '开始采样'}
                </button>
                <span style={{ fontSize: 10, color: recording ? '#ff9d9d' : '#8a93a0' }}>
                  {recording ? `已录制 ${Math.round((capture.length * 500) / 1000)}s` : '点击开始录制采样'}
                </span>
              </div>
              <div style={{ marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 8 }}>
                <div style={{ color: '#b8f2d0', marginBottom: 4 }}>压力注入(Stress)</div>

                {/* 注入模式切换 */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                  <button type="button" onClick={() => setInjectMode('replace')} style={{ border: 'none', borderRadius: 5, background: injectMode === 'replace' ? 'rgba(127,216,255,0.16)' : 'transparent', color: injectMode === 'replace' ? '#7fd8ff' : '#8a93a0', padding: '3px 10px', cursor: 'pointer', fontSize: 11, fontWeight: injectMode === 'replace' ? 700 : 400, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', boxShadow: injectMode === 'replace' ? 'inset 0 0 0 1px rgba(127,216,255,0.4)' : 'none' }}>全量替换</button>
                  <button type="button" onClick={() => setInjectMode('add')} style={{ border: 'none', borderRadius: 5, background: injectMode === 'add' ? 'rgba(127,216,255,0.16)' : 'transparent', color: injectMode === 'add' ? '#7fd8ff' : '#8a93a0', padding: '3px 10px', cursor: 'pointer', fontSize: 11, fontWeight: injectMode === 'add' ? 700 : 400, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', boxShadow: injectMode === 'add' ? 'inset 0 0 0 1px rgba(127,216,255,0.4)' : 'none' }}>增量追加</button>
                </div>

                {injectMode === 'replace' ? (
                  /* 全量替换模式（向下兼容） */
                  <button
                    type="button"
                    onClick={() => void handleInjectNodes()}
                    disabled={injecting}
                    style={btnStyle(injecting ? 'rgba(127,216,255,0.10)' : 'rgba(255,255,255,0.06)')}
                  >
                    {injecting ? '注入中…' : '注入 1000 节点(空)'}
                  </button>
                ) : (
                  /* 增量追加模式 */
                  <>
                    {/* 节点类型选择 */}
                    <div style={{ marginBottom: 5, fontSize: 10, color: '#8a93a0' }}>节点类型</div>
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 6 }}>
                      {(['empty', 'image', 'video', 'audio', 'text'] as NodeType[]).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setNodeType(t)}
                          style={{
                            border: '1px solid rgba(255,255,255,0.18)',
                            borderRadius: 4,
                            background: nodeType === t ? 'rgba(127,216,255,0.16)' : 'rgba(255,255,255,0.05)',
                            color: nodeType === t ? '#7fd8ff' : '#8a93a0',
                            padding: '2px 6px',
                            cursor: 'pointer',
                            fontSize: 10,
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          }}
                        >
                          {t === 'empty' ? '空节点' : t === 'image' ? '图片' : t === 'video' ? '视频' : t === 'audio' ? '音频' : '文本'}
                        </button>
                      ))}
                    </div>

                    {/* 媒体源选择（待 T4/T5 扩展） */}
                    <div style={{ marginBottom: 5, fontSize: 10, color: '#8a93a0' }}>媒体源</div>
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 6 }}>
                      {(['empty', 'publicPrompts', 'seed'] as MediaSource[]).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setMediaSource(s)}
                          style={{
                            border: '1px solid rgba(255,255,255,0.18)',
                            borderRadius: 4,
                            background: mediaSource === s ? 'rgba(127,216,255,0.16)' : 'rgba(255,255,255,0.05)',
                            color: mediaSource === s ? '#7fd8ff' : '#8a93a0',
                            padding: '2px 6px',
                            cursor: 'pointer',
                            fontSize: 10,
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          }}
                        >
                          {s === 'empty' ? '空数据' : s === 'publicPrompts' ? '公共提示词图(T4)' : 'Seed资产(T3)'}
                        </button>
                      ))}
                    </div>

                    {/* 档位按钮 + 滚动条 */}
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 4 }}>
                      {([...BATCH_SIZES] as const).map((size) => (
                        <button
                          key={size}
                          type="button"
                          onClick={() => setSliderCount(size)}
                          style={{
                            border: '1px solid',
                            borderColor: sliderCount === size ? 'rgba(127,216,255,0.5)' : 'rgba(255,255,255,0.18)',
                            borderRadius: 4,
                            background: sliderCount === size ? 'rgba(127,216,255,0.16)' : 'rgba(255,255,255,0.05)',
                            color: sliderCount === size ? '#7fd8ff' : '#8a93a0',
                            padding: '2px 7px',
                            cursor: 'pointer',
                            fontSize: 10,
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          }}
                        >
                          +{size}
                        </button>
                      ))}
                    </div>

                    {/* 滚动条 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <input
                        type="range"
                        min={1}
                        max={MAX_SLIDER_COUNT}
                        value={sliderCount}
                        onChange={(e) => setSliderCount(Number(e.target.value))}
                        style={{ flex: 1, accentColor: '#7fd8ff', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: 10, color: '#7fd8ff', minWidth: 36, textAlign: 'right' }}>
                        {sliderCount}
                      </span>
                    </div>

                    {/* 注入/停止按钮 */}
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => void handleInjectNodes()}
                        disabled={injecting}
                        style={btnStyle(injecting ? 'rgba(127,216,255,0.10)' : 'rgba(255,255,255,0.06)')}
                      >
                        {injecting ? '注入中…' : `注入 +${sliderCount}`}
                      </button>
                      {injecting && (
                        <button
                          type="button"
                          onClick={handleStopInject}
                          style={btnStyle('rgba(255,84,84,0.18)')}
                        >
                          停止
                        </button>
                      )}
                    </div>
                  </>
                )}

                {injectInfo ? (
                  <div
                  style={{
                    marginTop: 4,
                    fontSize: 10,
                    color: injectInfo.startsWith('替换成功') || injectInfo.startsWith('追加完成')
                      ? '#b8f2d0'
                      : '#ff9d9d',
                  }}
                  >
                    {injectInfo}
                  </div>
                ) : null}

                <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => void handleExport()}
                    disabled={capture.length === 0}
                    style={btnStyle(capture.length === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.08)')}
                  >
                    导出{capture.length > 0 ? ` ${capture.length} 条` : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCapture([]); setExportInfo(null); }}
                    disabled={capture.length === 0}
                    style={btnStyle('rgba(255,255,255,0.06)', capture.length === 0)}
                  >
                    清空
                  </button>
                </div>
                {exportInfo ? (
                  <div style={{ marginTop: 4, fontSize: 10, color: '#b8f2d0' }}>{exportInfo}</div>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** 面板通用按钮样式 */
function btnStyle(background: string, dimmed = false): CSSProperties {
  return {
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: 5,
    background,
    color: '#e8edf2',
    padding: '4px 8px',
    cursor: dimmed ? 'not-allowed' : 'pointer',
    opacity: dimmed ? 0.5 : 1,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 11,
  };
}