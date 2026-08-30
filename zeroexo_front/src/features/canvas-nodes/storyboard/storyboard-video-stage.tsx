import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
// 铁律：图标一律 lucide + 模块级 icons.ts Map，禁止 emoji 字符（2026-08-31）
import { CANVAS_NODE_ICONS } from '../icons.js';

/**
 * StoryboardVideoStage - 中区 16:9 视频舞台（Plan#53 T6）
 *
 * 主视频预览 + 状态覆盖层（生成中/失败/空位）。
 */
export interface StoryboardVideoStageProps {
  videoStorageKey?: string;
  videoStatus?: 'idle' | 'pending' | 'generating' | 'done' | 'failed';
  videoProgress?: number;
  videoError?: string;
  /** 无视频空位时的占位提示 */
  emptyLabel?: string;
  theme: any;
  isDark: boolean;
}

export const StoryboardVideoStage = memo(function StoryboardVideoStage({
  videoStorageKey, videoStatus = 'idle', videoProgress = 0, videoError, emptyLabel,
  theme, isDark,
}: StoryboardVideoStageProps): ReactElement {
  const { t } = useTranslation();
  const textMuted = theme.toolbar.textMuted;
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  // 2026-08-31：全站统一画布背景色（原 #0c0a09 暖棕黑已废）
  const bg = theme.canvas.background;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, background: bg, borderRadius: 8, border: `1px solid ${cardBorder}`, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
          <CANVAS_NODE_ICONS.videoEmpty size={28} strokeWidth={1.5} style={{ opacity: 0.4 }} />
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
          <CANVAS_NODE_ICONS.warning size={22} />
          <span>{videoError ?? t('storyboard.generateFailed', '生成失败')}</span>
        </div>
      )}
    </div>
  );
});
