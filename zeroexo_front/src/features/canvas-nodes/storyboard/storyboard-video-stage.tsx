/**
 * StoryboardAudioPreviewBar - 音频预览条（Plan#53 T12.5，用户追加需求）
 *
 * 用户自己配音试听：播放/暂停/进度/音量/时长/重录占位。单轨试听，非混音。
 * 数据存 shot.audioPreview.storageKey（自定义音频资源，或 M 码记录后由
 * 生成链路落盘），当前版本先支持已存在 storageKey 的本地回放。
 */
import { memo, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Play, Pause, Volume2, VolumeX, Mic, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface StoryboardAudioPreviewBarProps {
  storageKey?: string;
  duration?: number;
  name?: string;
  onRemove?: () => void;
  onRecordRequest?: () => void;
  theme: any;
  isDark: boolean;
}

export const StoryboardAudioPreviewBar = memo(function StoryboardAudioPreviewBar({
  storageKey, duration, name, onRemove, onRecordRequest, theme, isDark,
}: StoryboardAudioPreviewBarProps): ReactElement {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [loadError, setLoadError] = useState(false);

  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent ?? '#e94560';
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.muted = muted;
    }
  }, [volume, muted]);

  useEffect(() => {
    setLoadError(false);
    setCurrentTime(0);
    setPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, [storageKey]);

  const handlePlayPause = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { el.play().catch(() => setLoadError(true)); setPlaying(true); }
  }, [playing]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const sec = Number(e.target.value);
    setCurrentTime(sec);
    if (audioRef.current) audioRef.current.currentTime = sec;
  }, []);

  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  }, []);
  const handleEnded = useCallback(() => setPlaying(false), []);
  const handleError = useCallback(() => { setLoadError(true); setPlaying(false); }, []);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${m}:${ss.toString().padStart(2, '0')}`;
  };

  const totalSec = duration ?? 0;

  if (!storageKey) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, background: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.03)', border: `1px dashed ${cardBorder}`, fontSize: 11, color: textMuted }}>
        <Mic size={13} />
        <span style={{ flex: 1 }}>{t('storyboard.noAudioPreview', '暂无音频预览')}</span>
        {onRecordRequest && (
          <button
            type="button"
            onClick={onRecordRequest}
            style={{ fontSize: 11, color: accent, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {t('storyboard.recordVoice', '配音/上传')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 6, background: isDark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.04)', border: `1px solid ${cardBorder}`, fontSize: 11, color: textPrimary }}>
      {/* 隐藏 audio 用于实际回放 */}
      <audio
        ref={audioRef}
        src={storageKey}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onError={handleError}
      />
      <button
        type="button"
        onClick={handlePlayPause}
        disabled={loadError}
        style={{ width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: accent, color: '#fff', border: 'none', cursor: loadError ? 'not-allowed' : 'pointer', flexShrink: 0 }}
      >
        {playing ? <Pause size={12} /> : <Play size={12} style={{ marginLeft: 1 }} />}
      </button>
      <span style={{ minWidth: 34, color: textMuted, fontVariantNumeric: 'tabular-nums' }}>{fmt(currentTime)}</span>
      <input
        type="range"
        min={0}
        max={Math.max(totalSec, 0.1)}
        step={0.1}
        value={Math.min(currentTime, Math.max(totalSec, 0.1))}
        onChange={handleSeek}
        style={{ flex: 1, height: 3 }}
      />
      <span style={{ minWidth: 34, color: textMuted, fontVariantNumeric: 'tabular-nums' }}>{fmt(totalSec)}</span>
      <button
        type="button"
        onClick={() => setMuted((m) => !m)}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: textMuted, display: 'flex', alignItems: 'center' }}
      >
        {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        onChange={(e) => { setVolume(Number(e.target.value)); setMuted(false); }}
        style={{ width: 54, height: 3 }}
      />
      {name && <span style={{ color: textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }}>{name}</span>}
      {loadError && <span style={{ color: '#ef4444', fontSize: 10 }}>{t('storyboard.audioLoadError', '音频不可用')}</span>}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title={t('storyboard.removeAudio', '移除音频')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: textMuted, display: 'flex', alignItems: 'center', padding: 0 }}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
});

/**
 * StoryboardVideoStage - 中区 16:9 视频舞台（Plan#53 T6）
 *
 * 主视频预览 + 状态覆盖层（生成中/失败/空位）+ 音频预览条。
 */
export interface StoryboardVideoStageProps {
  videoStorageKey?: string;
  videoStatus?: 'idle' | 'pending' | 'generating' | 'done' | 'failed';
  videoProgress?: number;
  videoError?: string;
  audioStorageKey?: string;
  audioDuration?: number;
  audioName?: string;
  onRemoveAudio?: () => void;
  onRecordAudio?: () => void;
  /** 无视频空位时的占位提示 */
  emptyLabel?: string;
  theme: any;
  isDark: boolean;
}

export const StoryboardVideoStage = memo(function StoryboardVideoStage({
  videoStorageKey, videoStatus = 'idle', videoProgress = 0, videoError,
  audioStorageKey, audioDuration, audioName, onRemoveAudio, onRecordAudio, emptyLabel,
  theme, isDark,
}: StoryboardVideoStageProps): ReactElement {
  const { t } = useTranslation();
  const textMuted = theme.toolbar.textMuted;
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const bg = isDark ? '#0c0a09' : '#fafaf7';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 8 }}>
      {/* 16:9 舞台 */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, background: bg, borderRadius: 8, border: `1px solid ${cardBorder}`, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {videoStorageKey && videoStatus !== 'failed' ? (
          <video
            key={videoStorageKey}
            src={videoStorageKey}
            controls
            autoPlay={false}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: textMuted, fontSize: 12, padding: 16, textAlign: 'center' }}>
            <span style={{ fontSize: 28, opacity: 0.4 }}>🎬</span>
            <span>{emptyLabel ?? t('storyboard.videoEmpty', '本镜尚无视频，点击底部「生成视频」')}</span>
          </div>
        )}

        {/* 状态覆盖层 */}
        {videoStatus === 'generating' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 12 }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.25)', borderTopColor: theme.toolbar.accent ?? '#e94560', animation: 'spin 0.8s linear infinite' }} />
            <span>{t('storyboard.generating', '视频生成中')} {Math.round(videoProgress * 100)}%</span>
          </div>
        )}
        {videoStatus === 'failed' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(127,29,29,0.25)', color: '#fecaca', fontSize: 12, padding: 16, textAlign: 'center' }}>
            <span style={{ fontSize: 22 }}>⚠</span>
            <span>{videoError ?? t('storyboard.generateFailed', '生成失败')}</span>
          </div>
        )}
      </div>
      {/* 音频预览条（T12.5） */}
      <StoryboardAudioPreviewBar
        storageKey={audioStorageKey}
        duration={audioDuration}
        name={audioName}
        onRemove={onRemoveAudio}
        onRecordRequest={onRecordAudio}
        theme={theme}
        isDark={isDark}
      />
    </div>
  );
});
