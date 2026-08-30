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
import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react';

// ===== 常量（对齐 workbench-track 视觉层 + freecut-main MINI 几何） =====

const TRACK_HEIGHT = 44;
const TRACK_GAP = 4;
const RULER_HEIGHT = 24;
const CLIP_GAP = 3;                 // clip 间距（验收硬标准）
const TRIM_HANDLE_WIDTH = 6;        // 外部 trim handle
const CLIP_MIN_WIDTH = 10;
const CLIP_BORDER_RADIUS = 6;
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
  /** trim：返回新的 duration（秒） */
  onTrim?: (shotId: string, newDuration: number) => void;
  /** 播放头时间（秒，0 起步） */
  playheadTime?: number;
  onPlayheadTimeChange?: (time: number) => void;
  onClipDoubleClick?: (shotId: string) => void;
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

export const StoryboardTimeline = memo(function StoryboardTimeline({
  shots, activeShotId, pixelsPerSecond, onPixelsPerSecondChange, onSelectShot, onReorder, onTrim,
  playheadTime = 0, onPlayheadTimeChange, onClipDoubleClick, t, theme, isDark,
}: StoryboardTimelineProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [, setTrimId] = useState<string | null>(null);
  const [, setTrimSide] = useState<'left' | 'right' | null>(null);

  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const borderColor = isDark ? '#2e2e2e' : '#e5e5e5';
  const trackBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
  const rulerBg = isDark ? '#1b1b1b' : '#fafaf7';
  const labelBg = isDark ? '#161412' : '#f5f5f4';
  const playheadColor = theme.toolbar.accent ?? '#e94560';

  // clip 布局：带间距（CLIP_GAP），宽度 = duration × pixelsPerSecond
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
  const scrubThrottleRef = useRef(createScrubThrottleState());
  const pendingXRef = useRef<number | null>(null);
  const scrubRafRef = useRef<number | null>(null);

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
    const el = scrollRef.current;
    if (!isDraggingPlayhead || clientX === null || !el) { scrubRafRef.current = null; return; }
    const rulerEl = el.querySelector('[data-ruler]') as HTMLElement;
    if (rulerEl) commitPlayheadFromX(clientX, rulerEl.getBoundingClientRect());
    scrubRafRef.current = requestAnimationFrame(runScrubLoop);
  }, [isDraggingPlayhead, commitPlayheadFromX]);

  const handleRulerClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (isDraggingPlayhead) return;
    commitPlayheadFromX(e.clientX, e.currentTarget.getBoundingClientRect());
  }, [isDraggingPlayhead, commitPlayheadFromX]);

  const handlePlayheadDown = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPlayhead(true);
    const handleMove = (moveE: globalThis.MouseEvent) => {
      pendingXRef.current = moveE.clientX;
      if (scrubRafRef.current === null) scrubRafRef.current = requestAnimationFrame(runScrubLoop);
    };
    const handleUp = () => {
      setIsDraggingPlayhead(false);
      cancelScrubRaf();
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
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
      const time = Math.max(0, x / pixelsPerSecond);
      const currentIdx = shots.findIndex((s) => s.id === id);
      const prevClip = currentIdx > 0 ? clips[currentIdx - 1] : undefined;
      const prevEnd = prevClip ? prevClip.left + prevClip.width : 0;
      const nextClip = currentIdx < shots.length - 1 ? clips[currentIdx + 1] : undefined;
      const maxDur = side === 'right'
        ? totalWidth / pixelsPerSecond
        : (nextClip ? nextClip.left - prevEnd - CLIP_GAP : 10);
      const minDur = 0.5;
      if (side === 'right') {
        const dur = Math.min(Math.max(time - prevEnd, minDur), maxDur);
        onTrim?.(id, Math.round(dur * 10) / 10);
      } else {
        const curClip = clips[currentIdx];
        if (!curClip) return;
        const dur = Math.min(Math.max((curClip.left + curClip.width) - time, minDur), 10);
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
  }, [shots, clips, pixelsPerSecond, totalWidth, onTrim]);

  // ===== 渲染标尺（workbench-track 视觉层） =====
  const renderRuler = useCallback(() => {
    const marks: ReactElement[] = [];
    const step = pixelsPerSecond >= 60 ? 1 : (pixelsPerSecond >= 20 ? 5 : 10);
    for (let s = 0; s <= Math.ceil(totalDuration); s += step) {
      const x = s * pixelsPerSecond;
      const isLong = s % (step * 5) === 0;
      if (x > totalWidth * 1.5) break;
      marks.push(
        <div key={`ruler-${s}`} style={{ position: 'absolute', left: x, top: 0, width: 1, height: isLong ? RULER_HEIGHT : RULER_HEIGHT / 2, background: isLong ? (isDark ? '#57534e' : '#a8a29e') : (isDark ? '#3e3e3e' : '#d4d4d4'), pointerEvents: 'none' }} />,
      );
      if (isLong) {
        marks.push(
          <div key={`ruler-label-${s}`} style={{ position: 'absolute', left: x + 4, top: 3, fontSize: 10, color: mutedColor, pointerEvents: 'none', whiteSpace: 'nowrap', userSelect: 'none' }}>{s}s</div>,
        );
      }
    }
    return marks;
  }, [totalDuration, pixelsPerSecond, totalWidth, isDark, mutedColor]);

  // ===== 缩放控件（workbench-track 视觉层） =====
  const handleZoomIn = useCallback(() => {
    onPixelsPerSecondChange(Math.min(pixelsPerSecond + 10, MAX_PIXELS_PER_SECOND));
  }, [pixelsPerSecond, onPixelsPerSecondChange]);
  const handleZoomOut = useCallback(() => {
    onPixelsPerSecondChange(Math.max(pixelsPerSecond - 10, MIN_PIXELS_PER_SECOND));
  }, [pixelsPerSecond, onPixelsPerSecondChange]);
  const handleSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onPixelsPerSecondChange(Number(e.target.value));
  }, [onPixelsPerSecondChange]);

  // ===== 渲染 =====
  const totalTrackWidth = Math.max(totalWidth, 200);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, width: '100%', background: trackBg, border: `1px solid ${borderColor}`, borderRadius: 8, overflow: 'hidden' }}>
      {/* 标尺行 + 播放头 */}
      <div
        ref={scrollRef}
        data-ruler
        onClick={handleRulerClick}
        style={{ position: 'relative', height: RULER_HEIGHT, background: rulerBg, borderBottom: `1px solid ${borderColor}`, overflowX: 'hidden', overflowY: 'hidden', cursor: 'crosshair', flexShrink: 0 }}
      >
        <div style={{ position: 'absolute', left: 0, top: 0, width: totalTrackWidth, height: RULER_HEIGHT }}>
          {renderRuler()}
        </div>
        {/* 播放头 */}
        <div
          onMouseDown={handlePlayheadDown}
          style={{ position: 'absolute', left: playheadTime * pixelsPerSecond, top: 0, width: 2, height: RULER_HEIGHT, background: playheadColor, cursor: 'ew-resize', zIndex: 5 }}
        >
          <div style={{ position: 'absolute', left: -4, top: 0, width: 10, height: 10, background: playheadColor, borderRadius: '0 0 4px 4px', transform: 'rotate(45deg)', transformOrigin: 'top center' }} />
        </div>
      </div>
      {/* 轨道区 */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div
          data-track-area
          style={{ position: 'relative', height: TRACK_HEIGHT + TRACK_GAP * 2, width: totalTrackWidth, minWidth: '100%', background: trackBg, borderRadius: 4, margin: TRACK_GAP, overflow: 'visible' }}
        >
          {clips.map((clip) => {
            const isSelected = activeShotId === clip.id;
            const color = statusColor(clip.data.status, isDark);
            const bg = statusBgColor(clip.data.status, isDark);
            const isDragging = draggingId === clip.id;
            const isNarrow = clip.width < 46;
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
                  top: TRACK_GAP,
                  width: clip.width,
                  height: TRACK_HEIGHT,
                  borderRadius: CLIP_BORDER_RADIUS,
                  background: bg,
                  border: `1px solid ${isSelected ? color : 'transparent'}`,
                  boxShadow: isSelected ? `0 0 0 1px ${color}` : (isDragging ? '0 4px 12px rgba(0,0,0,0.3)' : 'none'),
                  cursor: 'grab',
                  display: 'flex',
                  alignItems: 'center',
                  padding: isNarrow ? '0 2px' : '0 8px',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  transition: 'box-shadow 0.1s, border-color 0.1s',
                  userSelect: 'none',
                  touchAction: 'none',
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.borderColor = color; }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.borderColor = 'transparent'; }}
              >
                {isNarrow ? (
                  <div style={{ width: 4, height: '60%', borderRadius: 2, background: color, flexShrink: 0 }} />
                ) : (
                  <>
                    <span style={{ fontSize: 10, fontWeight: 600, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0, marginRight: 4 }}>
                      #{clip.data.number}
                    </span>
                    {clip.data.hasAudio && (
                      <span style={{ fontSize: 9, color: isDark ? '#fbbf24' : '#d97706', flexShrink: 0, marginRight: 4 }}>♪</span>
                    )}
                    {clip.data.status === 'generating' && (
                      <span style={{ fontSize: 9, color, marginRight: 4, flexShrink: 0 }}>⏳</span>
                    )}
                    {clip.data.status === 'failed' && (
                      <span style={{ fontSize: 9, color, marginRight: 4, flexShrink: 0 }}>⚠</span>
                    )}
                    <span style={{ fontSize: 10, color: textColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                      {clip.data.label ?? ''}
                    </span>
                  </>
                )}
                {/* 外部 trim handle */}
                <div
                  onMouseDown={(e) => handleTrimStart(e, clip.id, 'right')}
                  style={{ position: 'absolute', right: -TRIM_HANDLE_WIDTH / 2, top: 0, width: TRIM_HANDLE_WIDTH, height: '100%', cursor: 'ew-resize', zIndex: 3, background: isSelected ? color : 'transparent', opacity: isSelected ? 0.8 : 0, borderRadius: 2 }}
                  title={t('storyboard.timeline.trim') || '拖动调整时长'}
                />
              </div>
            );
          })}
          {shots.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: mutedColor, fontSize: 12 }}>
              {t('storyboard.timeline.empty') || '暂无镜头'}
            </div>
          )}
        </div>
      </div>
      {/* 缩放控件条 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderTop: `1px solid ${borderColor}`, background: labelBg, flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: mutedColor }}>{t('storyboard.timeline.zoom') || '缩放'}</span>
        <button type="button" onClick={handleZoomOut} style={{ width: 20, height: 18, fontSize: 12, color: mutedColor, background: 'transparent', border: `1px solid ${borderColor}`, borderRadius: 4, cursor: 'pointer' }}>−</button>
        <input
          type="range"
          min={MIN_PIXELS_PER_SECOND}
          max={MAX_PIXELS_PER_SECOND}
          step={1}
          value={pixelsPerSecond}
          onChange={handleSlider}
          style={{ width: 100, height: 3 }}
        />
        <button type="button" onClick={handleZoomIn} style={{ width: 20, height: 18, fontSize: 12, color: mutedColor, background: 'transparent', border: `1px solid ${borderColor}`, borderRadius: 4, cursor: 'pointer' }}>+</button>
        <span style={{ fontSize: 10, color: mutedColor, whiteSpace: 'nowrap' }}>
          {pixelsPerSecond}px/s · {t('storyboard.timeline.framePerSec') || '帧级'} {Math.round(FRAME_FPS / pixelsPerSecond * 100) / 100}s/帧
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: mutedColor, whiteSpace: 'nowrap' }}>
          {t('storyboard.shotCountSummary', { count: shots.length })}
        </span>
      </div>
    </div>
  );
});
