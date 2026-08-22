/**
 * WorkbenchTrack - 出片工作台全屏编辑器轨道区
 *
 * 三轨布局（V1 视频 / A1 配音 / S1 字幕）+ 时间轴标尺 + 缩放控制。
 * 纯 CSS + React 实现，不依赖额外库，适配明暗主题。
 */

import { memo, useCallback, useMemo, useRef, useState, type ReactElement, type MouseEvent as ReactMouseEvent } from 'react';
import type { WorkbenchShot } from './workbench-types';

// ===== 常量 =====

const TRACK_HEIGHT = 40;
const TRACK_GAP = 4;
const LABEL_WIDTH = 48;
const RULER_HEIGHT = 28;
const MIN_TIME_SCALE = 20;
const MAX_TIME_SCALE = 200;
const CLIP_BORDER_RADIUS = 6;
const CLIP_MIN_WIDTH = 4;

// ===== 类型 =====

export interface WorkbenchTrackProps {
  shots: WorkbenchShot[];
  /** 时间轴缩放比例 (px/s) */
  timeScale: number;
  onTimeScaleChange: (scale: number) => void;
  theme: any;
  isDark: boolean;
  t: (key: string) => string;
}

// ===== 状态配色 =====

function statusColor(status: WorkbenchShot['status'], isDark: boolean): string {
  switch (status) {
    case 'done':
      return isDark ? '#22c55e' : '#16a34a';
    case 'generating':
      return isDark ? '#60a5fa' : '#3b82f6';
    case 'failed':
      return isDark ? '#ef4444' : '#dc2626';
    default:
      return isDark ? '#525252' : '#a3a3a3';
  }
}

function statusBgColor(status: WorkbenchShot['status'], isDark: boolean): string {
  switch (status) {
    case 'done':
      return isDark ? 'rgba(34,197,94,0.15)' : 'rgba(22,163,74,0.10)';
    case 'generating':
      return isDark ? 'rgba(96,165,250,0.15)' : 'rgba(59,130,246,0.10)';
    case 'failed':
      return isDark ? 'rgba(239,68,68,0.15)' : 'rgba(220,38,38,0.10)';
    default:
      return isDark ? 'rgba(82,82,82,0.15)' : 'rgba(163,163,163,0.10)';
  }
}

// ===== 主组件 =====

export const WorkbenchTrack = memo(function WorkbenchTrack({
  shots,
  timeScale,
  onTimeScaleChange,
  theme,
  isDark,
  t,
}: WorkbenchTrackProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playheadTime, setPlayheadTime] = useState<number>(0);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);

  // 计算每个 clip 的起始时间
  const clipOffsets = useMemo(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (const shot of shots) {
      offsets.push(acc);
      acc += shot.duration;
    }
    return offsets;
  }, [shots]);

  const totalDuration = useMemo(() => shots.reduce((s, s2) => s + s2.duration, 0), [shots]);
  const totalWidth = Math.max(totalDuration * timeScale, 200);

  // 主题色
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const borderColor = isDark ? '#2e2e2e' : '#e5e5e5';
  const trackBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
  const rulerBg = isDark ? '#1b1b1b' : '#fafaf7';
  const labelBg = isDark ? '#161412' : '#f5f5f4';
  const playheadColor = theme.toolbar.accent ?? '#e94560';

  // 缩放控制
  const handleZoomIn = useCallback(() => {
    onTimeScaleChange(Math.min(timeScale + 10, MAX_TIME_SCALE));
  }, [timeScale, onTimeScaleChange]);

  const handleZoomOut = useCallback(() => {
    onTimeScaleChange(Math.max(timeScale - 10, MIN_TIME_SCALE));
  }, [timeScale, onTimeScaleChange]);

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onTimeScaleChange(Number(e.target.value));
    },
    [onTimeScaleChange],
  );

  // Clip 点击选中
  const handleClipClick = useCallback((clipId: string) => {
    setSelectedClipId((prev) => (prev === clipId ? null : clipId));
  }, []);

  // 时间轴点击跳转播放头
  const handleRulerClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!scrollRef.current || isDraggingPlayhead) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const scrollLeft = scrollRef.current.scrollLeft;
      const x = e.clientX - rect.left + scrollLeft;
      const time = Math.max(0, Math.min(x / timeScale, totalDuration));
      setPlayheadTime(time);
    },
    [timeScale, totalDuration, isDraggingPlayhead],
  );

  // 播放头拖拽
  const handlePlayheadMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingPlayhead(true);

      const handleMouseMove = (moveE: globalThis.MouseEvent) => {
        if (!scrollRef.current) return;
        const rulerEl = scrollRef.current.querySelector('[data-ruler]') as HTMLElement;
        if (!rulerEl) return;
        const rect = rulerEl.getBoundingClientRect();
        const scrollLeft = scrollRef.current.scrollLeft;
        const x = moveE.clientX - rect.left + scrollLeft;
        const time = Math.max(0, Math.min(x / timeScale, totalDuration));
        setPlayheadTime(time);
      };

      const handleMouseUp = () => {
        setIsDraggingPlayhead(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [timeScale, totalDuration],
  );

  // 渲染时间轴标尺
  const renderRuler = useCallback(() => {
    const marks: ReactElement[] = [];
    // 每 1s 一个短刻度，每 5s 一个长刻度带数字
    for (let s = 0; s <= Math.ceil(totalDuration); s++) {
      const x = s * timeScale;
      const isLong = s % 5 === 0;
      const isEnd = s === Math.ceil(totalDuration);
      if (x > totalWidth * 1.5) break;
      marks.push(
        <div
          key={`ruler-${s}`}
          style={{
            position: 'absolute',
            left: x,
            top: 0,
            width: 1,
            height: isLong ? RULER_HEIGHT : RULER_HEIGHT / 2,
            background: isLong ? (isDark ? '#57534e' : '#a8a29e') : (isDark ? '#3e3e3e' : '#d4d4d4'),
            pointerEvents: 'none',
          }}
        />,
      );
      if (isLong || isEnd) {
        marks.push(
          <div
            key={`ruler-label-${s}`}
            style={{
              position: 'absolute',
              left: x + 4,
              top: isLong ? 4 : RULER_HEIGHT / 2 + 2,
              fontSize: 10,
              color: mutedColor,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}
          >
            {s}s
          </div>,
        );
      }
    }
    return marks;
  }, [totalDuration, timeScale, totalWidth, isDark, mutedColor]);

  // 渲染单个轨道行
  const renderTrackRow = useCallback(
    (
      label: string,
      rowIndex: number,
      clips: Array<{ id: string; left: number; width: number; color: string; bg: string; label: string; summary: string; status: WorkbenchShot['status'] }>,
    ) => {
      const top = rowIndex * (TRACK_HEIGHT + TRACK_GAP);
      return (
        <div
          key={label}
          style={{
            position: 'absolute',
            left: 0,
            top,
            width: totalWidth,
            height: TRACK_HEIGHT,
            borderRadius: 4,
            background: trackBg,
            border: `1px solid ${borderColor}`,
            overflow: 'hidden',
          }}
        >
          {clips.map((clip) => {
            const isSelected = selectedClipId === clip.id;
            const width = Math.max(clip.width, CLIP_MIN_WIDTH);
            // 如果 clip 宽度过窄，只显示颜色条
            const isNarrow = width < 40;
            return (
              <div
                key={clip.id}
                data-clip-id={clip.id}
                onClick={() => handleClipClick(clip.id)}
                title={`#${shots.find((s) => s.id === clip.id)?.number ?? ''} ${clip.summary}`}
                style={{
                  position: 'absolute',
                  left: clip.left,
                  top: 3,
                  width,
                  height: TRACK_HEIGHT - 6,
                  borderRadius: CLIP_BORDER_RADIUS,
                  background: clip.bg,
                  border: `1px solid ${isSelected ? clip.color : 'transparent'}`,
                  boxShadow: isSelected ? `0 0 0 1px ${clip.color}` : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: isNarrow ? '0 2px' : '0 6px',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  transition: 'box-shadow 0.1s, border-color 0.1s',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = clip.color;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = 'transparent';
                  }
                }}
              >
                {isNarrow ? (
                  <div
                    style={{
                      width: 4,
                      height: '60%',
                      borderRadius: 2,
                      background: clip.color,
                      flexShrink: 0,
                    }}
                  />
                ) : (
                  <>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: clip.color,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        flexShrink: 0,
                        marginRight: 4,
                      }}
                    >
                      {clip.label}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: mutedColor,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {clip.summary}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      );
    },
    [totalWidth, trackBg, borderColor, selectedClipId, handleClipClick, shots, mutedColor],
  );

  // 构建三轨数据
  const trackData = useMemo(() => {
    const videoClips = shots.map((shot, i) => ({
      id: shot.id,
      left: (clipOffsets[i] ?? 0) * timeScale,
      width: Math.max(shot.duration * timeScale, CLIP_MIN_WIDTH),
      color: statusColor(shot.status, isDark),
      bg: statusBgColor(shot.status, isDark),
      label: shot.shotType || `#${shot.number}`,
      summary: shot.description.slice(0, 20) || `#${shot.number}`,
      status: shot.status,
    }));

    // A1 / S1 复用相同数据（使用 description 作为对白/字幕文本）
    const audioClips = shots.map((shot, i) => ({
      id: `audio-${shot.id}`,
      left: (clipOffsets[i] ?? 0) * timeScale,
      width: Math.max(shot.duration * timeScale, CLIP_MIN_WIDTH),
      color: isDark ? '#a78bfa' : '#7c3aed',
      bg: isDark ? 'rgba(167,139,250,0.12)' : 'rgba(124,58,237,0.08)',
      label: '对白',
      summary: shot.description.slice(0, 24) || `#${shot.number}`,
      status: shot.status,
    }));

    const subtitleClips = shots.map((shot, i) => ({
      id: `subtitle-${shot.id}`,
      left: (clipOffsets[i] ?? 0) * timeScale,
      width: Math.max(shot.duration * timeScale, CLIP_MIN_WIDTH),
      color: isDark ? '#fbbf24' : '#d97706',
      bg: isDark ? 'rgba(251,191,36,0.12)' : 'rgba(217,119,6,0.08)',
      label: '字幕',
      summary: shot.description.slice(0, 24) || `#${shot.number}`,
      status: shot.status,
    }));

    return { videoClips, audioClips, subtitleClips };
  }, [shots, clipOffsets, timeScale, isDark]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        minWidth: 0,
        background: isDark ? '#0e0e0e' : '#f8f8f8',
        position: 'relative',
      }}
    >
      {/* 主体区域：左侧标签 + 右侧滚动轨道 */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* 左侧固定标签列 */}
        <div
          style={{
            width: LABEL_WIDTH,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRight: `1px solid ${borderColor}`,
            background: labelBg,
            zIndex: 2,
          }}
        >
          {/* 标尺标签占位 */}
          <div style={{ height: RULER_HEIGHT }} />
          {/* V1 标签 */}
          <div
            style={{
              height: TRACK_HEIGHT,
              marginBottom: TRACK_GAP,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              color: textColor,
              letterSpacing: '0.5px',
            }}
          >
            V1
          </div>
          {/* A1 标签 */}
          <div
            style={{
              height: TRACK_HEIGHT,
              marginBottom: TRACK_GAP,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              color: textColor,
              letterSpacing: '0.5px',
            }}
          >
            A1
          </div>
          {/* S1 标签 */}
          <div
            style={{
              height: TRACK_HEIGHT,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              color: textColor,
              letterSpacing: '0.5px',
            }}
          >
            S1
          </div>
        </div>

        {/* 右侧滚动区域 */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowX: 'auto',
            overflowY: 'hidden',
            position: 'relative',
          }}
        >
          <div
            style={{
              width: totalWidth,
              position: 'relative',
              minHeight: '100%',
            }}
          >
            {/* 时间轴标尺 */}
            <div
              data-ruler
              onClick={handleRulerClick}
              style={{
                height: RULER_HEIGHT,
                position: 'sticky',
                top: 0,
                background: rulerBg,
                borderBottom: `1px solid ${borderColor}`,
                zIndex: 3,
                cursor: 'pointer',
              }}
            >
              {renderRuler()}
              {/* 播放头 */}
              <div
                onMouseDown={handlePlayheadMouseDown}
                style={{
                  position: 'absolute',
                  left: playheadTime * timeScale,
                  top: 0,
                  width: 2,
                  height: RULER_HEIGHT,
                  background: playheadColor,
                  zIndex: 4,
                  cursor: 'ew-resize',
                  pointerEvents: 'auto',
                }}
              />
            </div>

            {/* 轨道区域 */}
            <div
              style={{
                position: 'relative',
                paddingTop: 4,
                height: TRACK_HEIGHT * 3 + TRACK_GAP * 2,
              }}
            >
              {/* 播放头延伸线 */}
              <div
                style={{
                  position: 'absolute',
                  left: playheadTime * timeScale,
                  top: 0,
                  width: 1,
                  height: '100%',
                  background: `${playheadColor}40`,
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              />

              {/* V1 视频轨道 */}
              {renderTrackRow('V1', 0, trackData.videoClips)}
              {/* A1 音频轨道 */}
              {renderTrackRow('A1', 1, trackData.audioClips)}
              {/* S1 字幕轨道 */}
              {renderTrackRow('S1', 2, trackData.subtitleClips)}
            </div>
          </div>
        </div>
      </div>

      {/* 底部缩放控制 */}
      <div
        style={{
          height: 36,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 12px',
          borderTop: `1px solid ${borderColor}`,
          background: labelBg,
        }}
      >
        <button
          type="button"
          onClick={handleZoomOut}
          style={{
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px solid ${borderColor}`,
            borderRadius: 4,
            background: 'transparent',
            color: textColor,
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1,
            padding: 0,
          }}
          title={t('common.zoomOut')}
        >
          −
        </button>
        <input
          type="range"
          min={MIN_TIME_SCALE}
          max={MAX_TIME_SCALE}
          value={timeScale}
          onChange={handleSliderChange}
          style={{
            width: 80,
            height: 4,
            accentColor: playheadColor,
            cursor: 'pointer',
          }}
        />
        <button
          type="button"
          onClick={handleZoomIn}
          style={{
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px solid ${borderColor}`,
            borderRadius: 4,
            background: 'transparent',
            color: textColor,
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1,
            padding: 0,
          }}
          title={t('common.zoomIn')}
        >
          +
        </button>
        <span style={{ fontSize: 10, color: mutedColor, marginLeft: 4 }}>
          {timeScale}px/s
        </span>
      </div>
    </div>
  );
});