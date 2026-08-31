/**
 * StoryboardTimeline - 分镜生产台时间轴（Plan#53 T8）
 *
 * 以 freecut-main timeline 契约层为蓝本（store/hooks/utils 管状态与交互，
 * mini-timeline scrub 引擎搬帧级水平缩放），workbench-track 仅借视觉层
 * （状态配色/缩放控件/标尺样式）。
 *
 * 验收硬标准：带间距 clip + 外部 trim handle + 拖拽排序 + 选中高亮 +
 * 帧级水平缩放看清每一帧。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type DragEvent as ReactDragEvent, type ReactElement, type CSSProperties } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { AuthorizedImage, AuthorizedVideo } from '@/shared/components/authorized-media.js';
import type { Asset } from '@/features/asset-picker/index.js';

// ===== 常量（对齐 workbench-track 视觉层 + freecut-main MINI 几何） =====

const TRACK_HEIGHT = 58;            // 对齐参考 AI Video Studio.html 的 clip 高度
const RULER_HEIGHT = 24;
const CLIP_GAP = 2;                 // 2026-08-31 用户拍板:占位节点(clip)之间稍微分开一点(2px 即可)
const TRIM_HANDLE_WIDTH = 8;        // trim 命中区（须落在 clip 内部，clip 有 overflow:hidden）
const CLIP_MIN_WIDTH = 10;
const CLIP_BORDER_RADIUS = 4;
/** clip 时长兜底边界（模型模板未命中时用；真实上限一律取模板 duration.max） */
const DEFAULT_MIN_CLIP_DURATION = 0.5;
const DEFAULT_MAX_CLIP_DURATION = 30;
/** 默认像素比 60px/s（每帧 @30fps = 2px，帧级缩放上限可看清 1 帧 = 30px/s → 5px/帧） */
const MIN_PIXELS_PER_SECOND = 4;
const MAX_PIXELS_PER_SECOND = 240;
const FRAME_FPS = 30;

export interface TimelineClipData {
  id: string;
  number: number;
  duration: number;
  status?: 'idle' | 'generating' | 'done' | 'failed';
  thumbnailUrl?: string;
  /** 视频素材 key（2026-08-31：有视频时用 <video> 渲染 clip 画面，帧级放大也能看清每一帧） */
  videoKey?: string;
  label?: string;
  hasAudio?: boolean;
}

export interface StoryboardTimelineProps {
  shots: TimelineClipData[];
  activeShotId?: string | null;
  pixelsPerSecond: number;
  onPixelsPerSecondChange: (pps: number) => void;
  onSelectShot: (shotId: string) => void;
  /** 拖拽排序：返回新顺序的 shot id 数组 */
  onReorder?: (orderedIds: string[]) => void;
  /** trim：返回新的 duration（秒，已按模型上下限裁剪） */
  onTrim?: (shotId: string, newDuration: number) => void;
  /**
   * clip 时长下限（秒）——来自模型模板 duration 参数 min。
   * 缺省回落 DEFAULT_MIN_CLIP_DURATION。
   */
  minClipDuration?: number;
  /**
   * clip 时长上限（秒）——来自模型模板 duration 参数 max（真实模型能力上限，非硬编码）。
   * 缺省回落 DEFAULT_MAX_CLIP_DURATION。
   */
  maxClipDuration?: number;
  /** 播放头时间（秒，0 起步） */
  playheadTime?: number;
  onPlayheadTimeChange?: (time: number) => void;
  onClipDoubleClick?: (shotId: string) => void;
  /** 插入补拍镜头（T4）：null=末尾追加；否则在指定 shot 之后插入。
   * 第二参 insert 来自「资产拖入轨道」：用素材标题/时长/封面/视频 key 初始化新镜头（2026-08-31） */
  onInsertAt?: (afterShotId: string | null, insert?: { title?: string; durationSec?: number; storageKey?: string; coverUrl?: string }) => void;
  /** 删除片段（2026-08-31）：Delete 键 / 工具栏触发，由宿主负责确认/撤销/素材沉淀 */
  onDeleteShot?: (shotId: string) => void;
  /** 额外工具栏按钮（2026-08-31）：如「素材池」入口，渲染在左侧按钮组 */
  extraToolbarButtons?: Array<{ key: string; label: string; onClick: () => void; danger?: boolean }>;
  t: (key: string, options?: Record<string, unknown>) => string;
  theme: any;
  isDark: boolean;
}

/** 简易 scrub 节流（freecut-mini scrub 引擎的轻量本地版） */
function createScrubThrottleState() {
  return { lastCommitMs: 0, lastFrame: -1 };
}
function shouldCommitScrubFrame(state: { lastCommitMs: number; lastFrame: number }, nowMs: number, targetFrame: number): boolean {
  const minInterval = 16;
  if (nowMs - state.lastCommitMs < minInterval && targetFrame === state.lastFrame) return false;
  state.lastCommitMs = nowMs;
  state.lastFrame = targetFrame;
  return true;
}

// ===== 状态配色（workbench-track 视觉层） =====

function statusColor(status: TimelineClipData['status'], isDark: boolean): string {
  switch (status) {
    case 'done': return isDark ? '#22c55e' : '#16a34a';
    case 'generating': return isDark ? '#60a5fa' : '#3b82f6';
    case 'failed': return isDark ? '#ef4444' : '#dc2626';
    default: return isDark ? '#a3a3a3' : '#78716c';
  }
}
function statusBgColor(status: TimelineClipData['status'], isDark: boolean): string {
  switch (status) {
    case 'done': return isDark ? 'rgba(34,197,94,0.16)' : 'rgba(22,163,74,0.10)';
    case 'generating': return isDark ? 'rgba(96,165,250,0.16)' : 'rgba(59,130,246,0.10)';
    case 'failed': return isDark ? 'rgba(239,68,68,0.16)' : 'rgba(220,38,38,0.10)';
    default: return isDark ? 'rgba(163,163,163,0.12)' : 'rgba(120,113,108,0.08)';
  }
}

/**
 * 轨道外壳主题配色（2026-08-31 二次适配：底色统一用画布背景主题色，
 * 分隔线/标尺线用中性 rgba 分割线——此前写死 #151617/#242629/#25272a 偏棕且不随主题）。
 */
function timelinePalette(isDark: boolean, canvasBg: string | undefined) {
  const divider = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  return isDark
    ? {
        bg: canvasBg ?? '#11110f',
        border: divider,
        text: '#e6e7e9',
        muted: '#9b9ea4',
        rulerLine: divider,
        empty: '#65686d',
        playhead: '#f2f3f4',
        clipSelected: '#f1f2f3',
        clipText: '#ffffff',
        trimHandle: 'rgba(241,242,243,0.9)',
      }
    : {
        bg: '#ffffff',
        border: 'rgba(0,0,0,0.10)',
        text: '#1c1917',
        muted: '#78716c',
        rulerLine: 'rgba(0,0,0,0.12)',
        empty: '#a8a29e',
        playhead: '#18181b',
        clipSelected: '#18181b',
        clipText: '#1c1917',
        trimHandle: 'rgba(24,24,27,0.85)',
      };
}

export const StoryboardTimeline = memo(function StoryboardTimeline({
  shots, activeShotId, pixelsPerSecond, onPixelsPerSecondChange, onSelectShot, onReorder, onTrim,
  minClipDuration, maxClipDuration,
  playheadTime = 0, onPlayheadTimeChange, onClipDoubleClick, onInsertAt, onDeleteShot, extraToolbarButtons, t, theme, isDark,
}: StoryboardTimelineProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 鼠标是否悬停在时间轴区域（Delete 键删除片段仅在悬停时生效，避免与画布删除节点冲突） */
  const [hovering, setHovering] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [, setTrimId] = useState<string | null>(null);
  const [, setTrimSide] = useState<'left' | 'right' | null>(null);
  /** 2026-08-31 主题适配：轨道外壳配色随明暗主题切换；暗色底色=画布背景色 */
  const C = useMemo(
    () => timelinePalette(isDark, theme?.canvas?.background),
    [isDark, theme?.canvas?.background],
  );

  // ===== 时间轴缩放（2026-08-31 用户最终拍板：缩放以「时间游标(播放头)」为中心，游标视觉位置永远不动；
  // 除非内容缩得比视口还窄（不足以计算原位）才允许游标被挤压移动）=====
  // pps 用 ref 读取：监听只注册一次，避免每次缩放都重建 wheel 监听。
  const ppsRef = useRef(pixelsPerSecond);
  ppsRef.current = pixelsPerSecond;
  /** 以播放头为锚点缩放：播放头当前在视口内的 x 位置缩放前后不变。
   * 用户看到的时间停在哪，放大缩小后它仍然停在那。 */
  const zoomAroundPlayhead = useCallback((nextPps: number) => {
    const el = scrollRef.current;
    const cur = ppsRef.current;
    const next = Math.round(
      Math.max(MIN_PIXELS_PER_SECOND, Math.min(MAX_PIXELS_PER_SECOND, nextPps)) * 10,
    ) / 10;
    if (!el) {
      onPixelsPerSecondChange(next);
      return;
    }
    // 播放头在视口的视觉偏移 = playheadTime × pps − scrollLeft（缩放前后保持）
    const anchorX = playheadTime * cur - el.scrollLeft;
    onPixelsPerSecondChange(next);
    // 内容不足视口宽时浏览器自动 clamp，播放头才可能被「挤压」移动
    el.scrollLeft = Math.max(0, playheadTime * next - anchorX);
  }, [onPixelsPerSecondChange, playheadTime]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      // Ctrl/⌘ + 滚轮 = 缩放（以时间游标为锚点向外扩张）
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAroundPlayhead(ppsRef.current * Math.exp(-e.deltaY * 0.0015));
        return;
      }
      // 普通滚轮 = 水平滚动（查看远处片段；时间轴只有一行轨道，纵向无内容）
      el.scrollLeft += e.deltaY || e.deltaX || 0;
      e.preventDefault();
    };
    // passive:false 才能 preventDefault（React onWheel 为 passive，无法阻止浏览器缩放）
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAroundPlayhead]);

  // clip 布局：宽度 = duration × pixelsPerSecond
  const clips = useMemo(() => {
    const arr: Array<{ id: string; left: number; width: number; data: TimelineClipData }> = [];
    let acc = 0;
    for (const s of shots) {
      const width = Math.max(s.duration * pixelsPerSecond, CLIP_MIN_WIDTH);
      arr.push({ id: s.id, left: acc, width, data: s });
      acc += width + CLIP_GAP;
    }
    return arr;
  }, [shots, pixelsPerSecond]);

  const totalWidth = useMemo(() => {
    if (clips.length === 0) return 200;
    const last = clips[clips.length - 1];
    return last ? last.left + last.width + CLIP_GAP : 200;
  }, [clips]);

  const totalDuration = useMemo(() => shots.reduce((s, x) => s + x.duration, 0), [shots]);

  // ===== 帧级水平缩放（freecut-mini scrub 引擎：rAF + 节流） =====
  // 2026-08-31 修复「时间预览线拖不动/不顺滑」：
  // 1. 拖动中标记用 ref（此前用 isDraggingPlayhead state——handleMove 闭包捕获的是
  //    pointerdown 那一帧的 false，rAF 循环第一帧就被短路退出 → 预览线根本不跟随）；
  // 2. 标尺 rect 在按下时只取一次（此前每帧 getBoundingClientRect 强制布局回流）。
  const scrubThrottleRef = useRef(createScrubThrottleState());
  const pendingXRef = useRef<number | null>(null);
  const scrubRafRef = useRef<number | null>(null);
  const draggingPlayheadRef = useRef(false);
  const rulerRectRef = useRef<DOMRect | null>(null);

  const cancelScrubRaf = useCallback(() => {
    if (scrubRafRef.current !== null) { cancelAnimationFrame(scrubRafRef.current); scrubRafRef.current = null; }
    pendingXRef.current = null;
  }, []);
  useEffect(() => () => cancelScrubRaf(), [cancelScrubRaf]);

  const commitPlayheadFromX = useCallback((clientX: number, rect: DOMRect) => {
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
    const x = clientX - rect.left + scrollLeft;
    const time = Math.max(0, Math.min(x / pixelsPerSecond, totalDuration));
    const targetFrame = Math.round(time * FRAME_FPS);
    const nowMs = performance.now();
    if (shouldCommitScrubFrame(scrubThrottleRef.current, nowMs, targetFrame)) {
      onPlayheadTimeChange?.(time);
    }
  }, [pixelsPerSecond, totalDuration, onPlayheadTimeChange]);

  const runScrubLoop = useCallback(() => {
    const clientX = pendingXRef.current;
    const rect = rulerRectRef.current;
    if (!draggingPlayheadRef.current || clientX === null || !rect) { scrubRafRef.current = null; return; }
    commitPlayheadFromX(clientX, rect);
    scrubRafRef.current = requestAnimationFrame(runScrubLoop);
  }, [commitPlayheadFromX]);

  const handleRulerClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (draggingPlayheadRef.current) return;
    commitPlayheadFromX(e.clientX, e.currentTarget.getBoundingClientRect());
  }, [commitPlayheadFromX]);

  const handlePlayheadDown = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const rulerEl = scrollRef.current?.querySelector('[data-ruler]') as HTMLElement | null;
    if (!rulerEl) return;
    draggingPlayheadRef.current = true;
    rulerRectRef.current = rulerEl.getBoundingClientRect();
    pendingXRef.current = e.clientX;
    scrubRafRef.current = requestAnimationFrame(runScrubLoop);
    const handleMove = (moveE: globalThis.MouseEvent) => {
      pendingXRef.current = moveE.clientX;
      // 2026-08-31 精准拖动：接近视口左右边缘时自动横向滚动，跟随鼠标到视口外的时间
      const el = scrollRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const edge = 48;
        if (moveE.clientX < rect.left + edge) {
          el.scrollLeft = Math.max(0, el.scrollLeft - (rect.left + edge - moveE.clientX) * 0.6);
        } else if (moveE.clientX > rect.right - edge) {
          el.scrollLeft = Math.min(
            el.scrollWidth - el.clientWidth,
            el.scrollLeft + (moveE.clientX - (rect.right - edge)) * 0.6,
          );
        }
      }
      if (scrubRafRef.current === null) scrubRafRef.current = requestAnimationFrame(runScrubLoop);
    };
    const handleUp = () => {
      draggingPlayheadRef.current = false;
      cancelScrubRaf();
      window.removeEventListener('mousemove', handleMove, true);
      window.removeEventListener('mouseup', handleUp, true);
    };
    // window + capture：规避 CanvasTabContentBoundary 对冒泡阶段事件的阻断（与分割条同款）
    window.addEventListener('mousemove', handleMove, true);
    window.addEventListener('mouseup', handleUp, true);
  }, [cancelScrubRaf, runScrubLoop]);

  // ===== 拖拽排序（点击 clip 拖到另一 clip 位置） =====
  const dragStartRef = useRef<{ id: string; x: number } | null>(null);
  const handleClipPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0) return;
    dragStartRef.current = { id, x: e.clientX };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDraggingId(id);
  }, []);

  const handleClipPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingId || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    if (Math.abs(dx) < 8) return;
    // 计算目标 index：根据当前 clip 中心 + 位移
    const currentIdx = clips.findIndex((c) => c.id === draggingId);
    if (currentIdx < 0) return;
    const from = shots[currentIdx];
    if (!from) return;
    const clipWidth = Math.max(from.duration * pixelsPerSecond, CLIP_MIN_WIDTH);
    const deltaIndex = Math.round(dx / (clipWidth + CLIP_GAP));
    const targetIdx = Math.max(0, Math.min(shots.length - 1, currentIdx + deltaIndex));
    if (targetIdx !== currentIdx) {
      const reordered = [...shots];
      const [moved] = reordered.splice(currentIdx, 1);
      if (!moved) return;
      reordered.splice(targetIdx, 0, moved);
      onReorder?.(reordered.map((s) => s.id));
      dragStartRef.current = { id: draggingId, x: e.clientX };
    }
  }, [draggingId, clips, shots, pixelsPerSecond, onReorder]);

  const handleClipPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current) {
      onSelectShot(dragStartRef.current.id);
    }
    dragStartRef.current = null;
    setDraggingId(null);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, [onSelectShot]);

  // ===== trim（外部 handle） =====
  const handleTrimStart = useCallback((e: ReactMouseEvent<HTMLDivElement>, id: string, side: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();
    setTrimId(id); setTrimSide(side);
    const shot = shots.find((s) => s.id === id);
    if (!shot) return;
    const handleMove = (moveE: globalThis.MouseEvent) => {
      const el = scrollRef.current;
      if (!el) return;
      const trackEl = el.querySelector('[data-track-area]') as HTMLElement;
      if (!trackEl) return;
      const rect = trackEl.getBoundingClientRect();
      const x = moveE.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
      // ⚠️ 全部换算到「秒」再比较（2026-08-31 修复：此前 prevEnd 是像素、time 是秒，
      // 二者直接相减 → 右侧 trim 结果恒为负/被下限截断；左侧还把「像素-秒」当秒用且上限写死 10）
      const timeSec = Math.max(0, x / pixelsPerSecond);
      const currentIdx = shots.findIndex((s) => s.id === id);
      const curClip = clips[currentIdx];
      if (!curClip) return;
      const prevClip = currentIdx > 0 ? clips[currentIdx - 1] : undefined;
      const prevEndSec = prevClip ? (prevClip.left + prevClip.width) / pixelsPerSecond : 0;
      // 时长上限 = 模型模板真实上限（缺省兜底），左侧 trim 再叠加「不得越过上一 clip 右边缘」
      const minDur = minClipDuration ?? DEFAULT_MIN_CLIP_DURATION;
      const modelMax = maxClipDuration ?? DEFAULT_MAX_CLIP_DURATION;
      if (side === 'right') {
        const dur = Math.min(Math.max(timeSec - prevEndSec, minDur), modelMax);
        onTrim?.(id, Math.round(dur * 10) / 10);
      } else {
        const rightEdgeSec = (curClip.left + curClip.width) / pixelsPerSecond;
        const spaceMax = Math.max(minDur, rightEdgeSec - prevEndSec);
        const dur = Math.min(Math.max(rightEdgeSec - timeSec, minDur), Math.min(modelMax, spaceMax));
        onTrim?.(id, Math.round(dur * 10) / 10);
      }
    };
    const handleUp = () => {
      setTrimId(null); setTrimSide(null);
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [shots, clips, pixelsPerSecond, minClipDuration, maxClipDuration, onTrim]);

  // ===== 渲染标尺（对齐 AI Video Studio.html：底部分布时间标签 + 背景刻度线） =====
  const formatTime = useCallback((s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }, []);
  const renderRuler = useCallback(() => {
    const labels: ReactElement[] = [];
    // 参考页面每 3 秒一个时间标签；缩放极大时切到 1 秒避免过密
    const step = pixelsPerSecond > 100 ? 1 : 3;
    for (let s = 0; s <= Math.ceil(totalDuration); s += step) {
      const x = s * pixelsPerSecond;
      if (x > totalWidth * 1.5) break;
      labels.push(
        <span
          key={`ruler-label-${s}`}
          style={{
            position: 'absolute',
            left: x,
            bottom: 4,
            fontSize: 8,
            color: C.empty,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            userSelect: 'none',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatTime(s)}
        </span>,
      );
    }
    return labels;
  }, [totalDuration, pixelsPerSecond, totalWidth, formatTime, C]);

  // ===== 缩放控件（滑块 + 加减按钮，右侧；缩放以时间游标为锚点，游标视觉位置不动）=====
  const handleZoomIn = useCallback(() => { zoomAroundPlayhead(ppsRef.current + 10); }, [zoomAroundPlayhead]);
  const handleZoomOut = useCallback(() => { zoomAroundPlayhead(ppsRef.current - 10); }, [zoomAroundPlayhead]);
  const handleSliderZoom = useCallback((v: number) => { zoomAroundPlayhead(v); }, [zoomAroundPlayhead]);
  // ===== 资产拖入轨道（2026-08-31：HTML5 drag 拖视频素材到轨道 → 按 drop 时间插入镜头）=====
  // 兼容两种拖拽源：资产库弹窗(application/x-canvas-asset) 与 画布资产抽屉(application/x-testlib-item)
  const TRACK_DRAG_MIMES = ['application/x-canvas-asset', 'application/x-testlib-item'];
  const handleTrackDragOver = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    const types = Array.from(e.dataTransfer.types);
    if (TRACK_DRAG_MIMES.some((m) => types.includes(m))) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);
  const handleTrackDrop = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    if (!onInsertAt) return;
    const rawAsset = e.dataTransfer.getData('application/x-canvas-asset');
    const rawLib = e.dataTransfer.getData('application/x-testlib-item');
    if (!rawAsset && !rawLib) return;
    e.preventDefault();
    // 归一化两种 payload → { storageKey, coverUrl, title, durationMs }
    let storageKey: string | undefined;
    let coverUrl: string | undefined;
    let title: string | undefined;
    let durationMs: number | undefined;
    try {
      if (rawAsset) {
        const p = JSON.parse(rawAsset) as {
          kind?: string; title?: string; durationMs?: number; storageKey?: string; coverUrl?: string;
        };
        if (p.kind !== 'video') return; // 目前仅接受视频素材
        storageKey = p.storageKey;
        coverUrl = p.coverUrl;
        title = p.title;
        durationMs = p.durationMs;
      } else {
        // 画布资产抽屉 payload：{ type:'asset', name, data: Asset }
        const item = JSON.parse(rawLib) as { type?: string; name?: string; data?: Asset };
        const a = item?.data;
        const d = a?.data;
        if (!a || a.kind !== 'video' || !d || d.kind !== 'video') return;
        storageKey = d.storageKey ?? (a as any).storageKey;
        coverUrl = a.coverUrl;
        title = item.name ?? a.title;
        durationMs = d.durationMs;
      }
    } catch { return; }
    if (!storageKey) return;
    const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
      const time = Math.max(0, x / ppsRef.current);
      // 落在某 clip 区间内 → 其后插入；否则取 drop 位置左侧最近 clip；均未命中 → 末尾
      let afterId: string | null = null;
      for (const c of clips) {
        const cStart = c.left / ppsRef.current;
        const cEnd = (c.left + c.width) / ppsRef.current;
        if (time >= cStart && time <= cEnd) { afterId = c.data.id; break; }
      }
      if (!afterId) {
        for (const c of clips) {
          if ((c.left + c.width) / ppsRef.current <= time) afterId = c.data.id;
          else break;
        }
      }
      onInsertAt(afterId, {
        title,
        durationSec: durationMs ? Math.max(0.5, Math.round(durationMs / 1000)) : undefined,
        storageKey,
        coverUrl,
      });
  }, [clips, onInsertAt]);
  // 2026-08-31 用户拍板：点击轨道空白（非片段）区 → 播放头精准跳到该时间
  const handleTrackClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target instanceof Element && e.target.closest('[data-clip-id]')) return;
    const rulerEl = scrollRef.current?.querySelector('[data-ruler]') as HTMLElement | null;
    if (!rulerEl) return;
    commitPlayheadFromX(e.clientX, rulerEl.getBoundingClientRect());
  }, [commitPlayheadFromX]);
  // ===== Delete/Backspace 删除选中片段（2026-08-31）=====
  useEffect(() => {
    if (!onDeleteShot) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!activeShotId || !hovering) return;
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      e.preventDefault();
      e.stopPropagation();
      onDeleteShot(activeShotId);
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [activeShotId, hovering, onDeleteShot]);
  // ===== 渲染（对齐 AI Video Studio.html：暗色 toolbar + 刻度 ruler + 全高 playhead + 缩略图 clip） =====
  const totalTrackWidth = Math.max(totalWidth, 200);
  const timecode = `${formatTime(playheadTime)} / ${formatTime(totalDuration)}`;
  const zoomPercent = `${Math.round((pixelsPerSecond / 60) * 100)}%`;
  const toolBtnStyle: CSSProperties = { height: 25, padding: '0 8px', border: 0, borderRadius: 5, background: 'transparent', color: C.muted, fontSize: 11, cursor: 'pointer' };

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, width: '100%', background: C.bg, borderTop: `1px solid ${C.border}`, color: C.text, overflow: 'hidden', boxSizing: 'border-box' }}
    >
      {/* Toolbar：时间码居中；右侧 = 缩放提示 + 滑块 + 加减按钮 */}
      <div style={{ height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
        {onInsertAt && (
          <button
            type="button"
            onClick={() => onInsertAt(activeShotId ?? null)}
            style={{ ...toolBtnStyle, color: C.text }}
            title="在选中片段后插入新片段"
          >
            <Plus size={15} />
          </button>
        )}
        {onDeleteShot && activeShotId && (
          <button
            type="button"
            onClick={() => onDeleteShot(activeShotId)}
            style={{ ...toolBtnStyle, color: '#ef4444' }}
            title="删除选中片段（Delete）"
          >
            <Trash2 size={15} />
          </button>
        )}
        {extraToolbarButtons?.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={b.onClick}
            style={{ ...toolBtnStyle, color: b.danger ? '#ef4444' : C.text }}
          >
            {b.label}
          </button>
        ))}
        <div style={{ flex: 1, fontVariantNumeric: 'tabular-nums', color: C.text, fontSize: 11, textAlign: 'center' }}>{timecode}</div>
        <span style={{ fontSize: 10, color: C.muted, marginRight: 4, whiteSpace: 'nowrap', userSelect: 'none' }}>
          {t('storyboard.timeline.wheelHint') || '滚轮滚动时间轴 · Ctrl+滚轮缩放'}
        </span>
        <button type="button" onClick={handleZoomOut} style={toolBtnStyle} title="缩小">−</button>
        <input
          type="range"
          min={MIN_PIXELS_PER_SECOND}
          max={MAX_PIXELS_PER_SECOND}
          step={1}
          value={pixelsPerSecond}
          onChange={(e) => handleSliderZoom(Number(e.target.value))}
          style={{ width: 120, accentColor: '#5DDCFF', cursor: 'pointer' }}
          title="缩放"
        />
        <button type="button" onClick={handleZoomIn} style={toolBtnStyle} title="放大">+</button>
        <button type="button" style={{ ...toolBtnStyle, width: 46 }}>{zoomPercent}</button>
      </div>
      {/* Timeline body（ruler + track + playhead；2026-08-31 显示水平滚动条，滚轮水平滚动） */}
      <div
        ref={scrollRef}
        data-timeline-body
        style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0, overflowX: 'auto', overflowY: 'hidden', paddingLeft: 14 }}
      >
        {/* Ruler */}
        <div
          data-ruler
          onClick={handleRulerClick}
          style={{ position: 'relative', height: RULER_HEIGHT, borderBottom: `1px solid ${C.rulerLine}`, display: 'flex', alignItems: 'flexEnd', overflow: 'hidden', background: `repeating-linear-gradient(to right, transparent 0, transparent 49px, ${C.rulerLine} 50px)` }}
        >
          {renderRuler()}
        </div>
        {/* Track area（可拖入资产；空白区点击移动播放头） */}
        <div
          data-track-area
          onDragOver={handleTrackDragOver}
          onDrop={handleTrackDrop}
          onClick={handleTrackClick}
          style={{ position: 'relative', flex: 1, minHeight: 0, padding: '7px 10px 9px 0', overflow: 'hidden' }}
        >
          <div style={{ position: 'relative', height: TRACK_HEIGHT + 16, width: totalTrackWidth, minWidth: '100%' }}>
            {clips.map((clip) => {
              const isSelected = activeShotId === clip.id;
              const color = statusColor(clip.data.status, isDark);
              const bg = statusBgColor(clip.data.status, isDark);
              const isDragging = draggingId === clip.id;
              const isNarrow = clip.width < 50;
              const thumbnailUrl = clip.data.thumbnailUrl;
              const videoKey = clip.data.videoKey;
              const hasMedia = !!thumbnailUrl || !!videoKey;
              return (
                <div
                  key={clip.id}
                  data-clip-id={clip.id}
                  onPointerDown={(e) => handleClipPointerDown(e, clip.id)}
                  onPointerMove={handleClipPointerMove}
                  onPointerUp={handleClipPointerUp}
                  onDoubleClick={() => onClipDoubleClick?.(clip.id)}
                  title={`#${clip.data.number} ${clip.data.label ?? ''} (${clip.data.duration}s)`}
                  style={{
                    position: 'absolute',
                    left: clip.left,
                    top: 7,
                    width: clip.width,
                    height: TRACK_HEIGHT,
                    borderRadius: CLIP_BORDER_RADIUS,
                    border: `2px solid ${isSelected ? C.clipSelected : 'transparent'}`,
                    boxShadow: isSelected ? '0 0 0 1px rgba(0,0,0,0.6)' : (isDragging ? '0 4px 12px rgba(0,0,0,0.3)' : 'none'),
                    cursor: 'grab',
                    display: 'flex',
                    alignItems: 'center',
                    padding: isNarrow ? '0 2px' : '0 8px',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                    transition: 'box-shadow 0.1s, border-color 0.1s',
                    userSelect: 'none',
                    touchAction: 'none',
                    // 有缩略图时压了深色遮罩 → 白字；无缩略图时背景是状态浅色 → 亮色主题下必须深字
                    color: hasMedia ? '#ffffff' : C.clipText,
                    textShadow: hasMedia ? '0 1px 2px rgba(0,0,0,0.6)' : 'none',
                    background: hasMedia ? 'transparent' : bg,
                  }}
                >
                  {hasMedia && (
                    <>
                      {videoKey ? (
                        // Opencut 同款：clip 画面直接用 <video> 渲染（首帧即清晰画面，帧级放大可看清每一帧）
                        <AuthorizedVideo
                          src={videoKey}
                          muted
                          playsInline
                          preload="metadata"
                          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : thumbnailUrl ? (
                        <AuthorizedImage
                          src={thumbnailUrl}
                          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : null}
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', pointerEvents: 'none' }} />
                    </>
                  )}
                  {isNarrow ? (
                    <div style={{ position: 'relative', width: 4, height: '60%', borderRadius: 2, background: color, flexShrink: 0 }} />
                  ) : (
                    <>
                      <span style={{ position: 'relative', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0, marginRight: 6 }}>
                        #{clip.data.number}
                      </span>
                      <span style={{ position: 'relative', fontSize: 9, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, marginRight: 6 }}>
                        {clip.data.label ?? ''}
                      </span>
                      <b style={{ position: 'relative', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', opacity: 0.9 }}>{clip.data.duration}s</b>
                    </>
                  )}
                  {/* 右侧 trim handle
                   * ⚠️ 必须落在 clip 内部（right: 0 而非负值）：clip 有 overflow:hidden，
                   * 负偏移的 handle 会被裁掉 → 完全不可见不可点（2026-08-31 修复 trim 拖不动）。
                   * onPointerDown 阻断冒泡：否则 clip 的拖拽排序会同时触发，trim 变成重排。 */}
                  <div
                    onMouseDown={(e) => handleTrimStart(e, clip.id, 'right')}
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{ position: 'absolute', right: 0, top: 0, width: TRIM_HANDLE_WIDTH, height: '100%', cursor: 'ew-resize', zIndex: 4, background: isSelected ? C.trimHandle : 'transparent', opacity: isSelected ? 0.85 : 0, borderRadius: 0 }}
                    title={t('storyboard.timeline.trim') || '拖动调整时长'}
                  />
                </div>
              );
            })}
            {shots.length === 0 && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.empty, fontSize: 12 }}>
                {t('storyboard.timeline.empty') || '暂无镜头'}
              </div>
            )}
          </div>
        </div>
        {/* Playhead spans full body：外层加宽命中区(14px)便于精准拖动；内层才是 1px 竖线 + 大三角 */}
        <div
          onMouseDown={handlePlayheadDown}
          title="拖动播放头"
          style={{ position: 'absolute', zIndex: 5, left: playheadTime * pixelsPerSecond - 7, top: 0, bottom: 0, width: 14, cursor: 'ew-resize', touchAction: 'none' }}
        >
          <div style={{ position: 'absolute', left: 6, top: 0, bottom: 0, width: 1, background: C.playhead, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: -3, left: 1.5, width: 11, height: 9, background: C.playhead, clipPath: 'polygon(0 0, 100% 0, 50% 100%)', pointerEvents: 'none' }} />
        </div>
      </div>
    </div>
  );
});
