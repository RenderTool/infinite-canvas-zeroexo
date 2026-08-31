import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
// 铁律：图标一律 lucide + 模块级 icons.ts Map，禁止 emoji 字符（2026-08-31）
import { CANVAS_NODE_ICONS } from '../icons.js';
import { AuthorizedVideo } from '@/shared/components/authorized-media.js';

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
  /** 点击「立即生成 / 重试」时触发（2026-08-31：让空态/失败态都有可执行出口） */
  onGenerate?: () => void;
  /** 生成中点击「取消」时触发 */
  onStop?: () => void;
  theme: any;
  isDark: boolean;
}

export const StoryboardVideoStage = memo(function StoryboardVideoStage({
  videoStorageKey, videoStatus = 'idle', videoProgress = 0, videoError, emptyLabel,
  onGenerate, onStop,
  theme, isDark,
}: StoryboardVideoStageProps): ReactElement {
  const { t } = useTranslation();
  const textMuted = theme.toolbar.textMuted;
  const textPrimary = theme.toolbar.text;
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  // 2026-08-31：全站统一画布背景色（原 #0c0a09 暖棕黑已废）
  const bg = theme.canvas.background;

  return (
    <div
      data-video-stage
      style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, background: bg, borderRadius: 8, border: `1px solid ${cardBorder}`, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {videoStorageKey && videoStatus !== 'failed' ? (
        <AuthorizedVideo
          key={videoStorageKey}
          src={videoStorageKey}
          controls
          autoPlay={false}
          preload="metadata"
          // 沿用经验 #14 video-doubleclick-fullscreen：双击空白处不影响 controls 交互。
          onDoubleClick={(e) => {
            const v = e.currentTarget;
            if (v.requestFullscreen) void v.requestFullscreen();
          }}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: textMuted, fontSize: 12, padding: 16, textAlign: 'center' }}>
          <CANVAS_NODE_ICONS.videoEmpty size={32} strokeWidth={1.5} style={{ opacity: 0.45 }} />
          <span>{emptyLabel ?? t('storyboard.videoEmpty', '本镜尚无视频，点击底部「生成视频」')}</span>
          {/* 2026-08-31 用户拍板：去掉空态「立即生成」按钮——文案已引导点击底部「生成视频」，
              保留按钮反而与底部生成入口重复；失败态的「重试」按钮仍保留（onGenerate 仍在 failed 分支使用） */}
        </div>
      )}

      {/* 状态覆盖层 —— 颜色一律走 theme，禁止硬编码红（2026-08-31 修复） */}
      {videoStatus === 'generating' && (
        <div
          data-video-status="generating"
          style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.85)', color: isDark ? '#fff' : textPrimary, fontSize: 12 }}
        >
          <div
            style={{
              width: 26, height: 26, borderRadius: '50%',
              border: `2px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.10)'}`,
              borderTopColor: theme.toolbar.accent,
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <span>{t('storyboard.generating', '视频生成中')} {Math.round((videoProgress ?? 0) * 100)}%</span>
          {onStop && (
            <button
              type="button"
              onClick={() => onStop()}
              style={{ marginTop: 4, padding: '4px 12px', background: 'transparent', color: textPrimary, border: `1px solid ${cardBorder}`, borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
            >
              {t('storyboard.cancel', '取消')}
            </button>
          )}
        </div>
      )}
      {videoStatus === 'failed' && (
        <div
          data-video-status="failed"
          style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: isDark ? `${theme.toolbar.danger}40` : `${theme.toolbar.danger}18`, color: isDark ? '#fff' : theme.toolbar.danger, fontSize: 12, padding: 16, textAlign: 'center' }}
        >
          <CANVAS_NODE_ICONS.warning size={22} />
          <span>{videoError ?? t('storyboard.generateFailed', '生成失败')}</span>
          {onGenerate && (
            <button
              type="button"
              onClick={() => onGenerate()}
              style={{ marginTop: 4, padding: '4px 12px', background: theme.toolbar.danger, color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
            >
              {t('storyboard.retry', '重试')}
            </button>
          )}
        </div>
      )}
    </div>
  );
});
