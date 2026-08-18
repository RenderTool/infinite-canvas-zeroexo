/**
 * PrevisNodeView - Previs(预演)节点视图组件
 *
 * 展示预演时间线，包含轨道列表、剪辑片段、播放控制。
 */
import { memo, useState, useCallback, useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from 'antd';
import { Play, Pause, SkipBack, SkipForward, Loader2 } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import type { PrevisNodeData } from './previs-types';
export interface PrevisNodeViewProps {
  data: PrevisNodeData;
  onDataChange?: (data: PrevisNodeData) => void;
}

export const PrevisNodeView = memo(function PrevisNodeView({
  data,
  onDataChange,
}: PrevisNodeViewProps): ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const bgCanvas = isDark ? '#171717' : '#ffffff';
  const borderMuted = isDark ? '#2e2e2e' : '#e5e5e5';
  const bgCard = isDark ? '#1f1f1f' : '#f5f5f5';
  const bgTrack = isDark ? '#1a1a1a' : '#fafafa';

  const [currentTime, setCurrentTime] = useState(data.currentTime || 0);
  const [isPlaying, setIsPlaying] = useState(data.isPlaying || false);

  const visibleTracks = useMemo(() => data.tracks.filter((t) => t.visible), [data.tracks]);
  const totalDuration = data.totalDuration || 60;

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handlePlayPause = useCallback(() => {
    setIsPlaying((prev) => !prev);
    if (onDataChange) {
      onDataChange({ ...data, isPlaying: !isPlaying });
    }
  }, [data, onDataChange, isPlaying]);

  const handleTimeChange = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    const newTime = pct * totalDuration;
    setCurrentTime(newTime);
    if (onDataChange) {
      onDataChange({ ...data, currentTime: newTime });
    }
  }, [totalDuration, data, onDataChange]);

  const handleSkipBack = useCallback(() => {
    setCurrentTime(0);
    if (onDataChange) onDataChange({ ...data, currentTime: 0 });
  }, [data, onDataChange]);

  const handleSkipForward = useCallback(() => {
    setCurrentTime(totalDuration);
    if (onDataChange) onDataChange({ ...data, currentTime: totalDuration });
  }, [totalDuration, data, onDataChange]);

  const currentTimePct = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: bgCanvas,
        borderRadius: 8,
        border: `1px solid ${borderMuted}`,
        overflow: 'hidden',
      }}
    >
      {/* 标题 */}
      <div
        style={{
          padding: '6px 10px',
          borderBottom: `1px solid ${borderMuted}`,
          fontSize: 12,
          fontWeight: 600,
          color: textColor,
          background: bgCard,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <span>{t('previs.previsTimeline')}</span>
        <span style={{ fontSize: 10, color: mutedColor, fontWeight: 400 }}>
          {formatTime(currentTime)} / {formatTime(totalDuration)}
        </span>
      </div>

      {/* 加载态 */}
      {data.status === 'generating' && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: accent }} />
          <span style={{ fontSize: 11, color: mutedColor }}>{t('previs.generating')}</span>
        </div>
      )}

      {/* 空态 */}
      {data.status !== 'generating' && visibleTracks.length === 0 && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: mutedColor }}>
          {t('previs.noPrevisData')}
        </div>
      )}

      {/* 轨道列表 */}
      {data.status !== 'generating' && visibleTracks.length > 0 && (
        <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
          {visibleTracks.map((track) => (
            <div key={track.id} style={{ marginBottom: 2 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '2px 8px',
                  fontSize: 10,
                  color: mutedColor,
                }}
              >
                <span style={{ width: 48, flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {track.name}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 28,
                    background: bgTrack,
                    borderRadius: 4,
                    position: 'relative',
                    overflow: 'hidden',
                    cursor: 'pointer',
                  }}
                  onClick={handleTimeChange}
                >
                  {track.clips.map((clip) => {
                    const leftPct = totalDuration > 0 ? (clip.startTime / totalDuration) * 100 : 0;
                    const widthPct = totalDuration > 0 ? (clip.duration / totalDuration) * 100 : 0;
                    return (
                      <Tooltip key={clip.id} title={clip.label || `#${clip.shotId}`}>
                        <div
                          style={{
                            position: 'absolute',
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            height: '100%',
                            background: clip.color || accent,
                            borderRadius: 3,
                            opacity: 0.8,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 9,
                            color: '#fff',
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            cursor: 'pointer',
                          }}
                        >
                          {widthPct > 8 ? clip.label : ''}
                        </div>
                      </Tooltip>
                    );
                  })}
                  {/* 播放头 */}
                  <div
                    style={{
                      position: 'absolute',
                      left: `${currentTimePct}%`,
                      top: 0,
                      width: 2,
                      height: '100%',
                      background: accent,
                      zIndex: 2,
                      pointerEvents: 'none',
                      transform: 'translateX(-1px)',
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 播放控制 */}
      <div
        style={{
          padding: '4px 8px',
          borderTop: `1px solid ${borderMuted}`,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          justifyContent: 'center',
          flexShrink: 0,
          background: bgCard,
        }}
      >
        <Tooltip title={t('previs.skipToStart')}>
          <Button
            size="small"
            type="text"
            icon={<SkipBack size={12} />}
            onClick={handleSkipBack}
            disabled={data.status === 'generating'}
            style={{ color: mutedColor, width: 24, height: 24 }}
          />
        </Tooltip>
        <Tooltip title={isPlaying ? t('previs.pause') : t('previs.play')}>
          <Button
            size="small"
            type="text"
            icon={isPlaying ? <Pause size={14} /> : <Play size={14} />}
            onClick={handlePlayPause}
            disabled={data.status === 'generating'}
            style={{ color: accent, width: 28, height: 28 }}
          />
        </Tooltip>
        <Tooltip title={t('previs.skipToEnd')}>
          <Button
            size="small"
            type="text"
            icon={<SkipForward size={12} />}
            onClick={handleSkipForward}
            disabled={data.status === 'generating'}
            style={{ color: mutedColor, width: 24, height: 24 }}
          />
        </Tooltip>
        {/* 进度条 */}
        <div
          style={{
            flex: 1,
            height: 4,
            background: bgTrack,
            borderRadius: 2,
            cursor: 'pointer',
            position: 'relative',
            margin: '0 4px',
          }}
          onClick={handleTimeChange}
        >
          <div
            style={{
              width: `${currentTimePct}%`,
              height: '100%',
              background: accent,
              borderRadius: 2,
            }}
          />
        </div>
        <span style={{ fontSize: 10, color: mutedColor, minWidth: 40, textAlign: 'right' }}>
          {formatTime(currentTime)}
        </span>
      </div>
    </div>
  );
});