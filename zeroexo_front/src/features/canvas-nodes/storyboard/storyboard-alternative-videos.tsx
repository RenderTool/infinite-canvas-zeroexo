/**
 * StoryboardAlternativeVideos - 分镜生产台右区：备选视频（Plan#53 T7）
 *
 * 一镜多视频，首个为主视频，其余为备选；点击切换 activeVideoIndex。
 * 每项显示缩略/时长/状态/诊断（F 码）+ 设置为主 + 重试。
 */
import { memo, useCallback, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, RefreshCw, RotateCcw } from 'lucide-react';
import { AuthorizedVideo } from '@/shared/components/authorized-media.js';
import type { ShotVideo } from './storyboard-types';
import type { Asset } from '../../asset-picker/index.js';
// 铁律：图标一律 lucide + 模块级 icons.ts Map，禁止 emoji 字符（2026-08-31）
import { CANVAS_NODE_ICONS } from '../icons.js';

/** 资产库卡片拖拽 MIME（与 drop-handler LIB_DRAG_MIME 一致） */
const LIB_DRAG_MIME = 'application/x-testlib-item';

export interface StoryboardAlternativeVideosProps {
  videos: ShotVideo[];
  activeVideoIndex: number;
  onActivate: (index: number) => void;
  onRetry?: (index: number) => void;
  onRemove?: (index: number) => void;
  /** 外部视频拖入（T5,2026-08-31）：资产库成品视频 → 追加为该镜头备选（source=external） */
  onExternalVideoDrop?: (payload: { storageKey: string; url: string; title?: string }) => void;
  theme: any;
  isDark: boolean;
}

export const StoryboardAlternativeVideos = memo(function StoryboardAlternativeVideos({
  videos, activeVideoIndex, onActivate, onRetry, onRemove, onExternalVideoDrop, theme, isDark,
}: StoryboardAlternativeVideosProps): ReactElement {
  const { t } = useTranslation();
  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const accent = theme.toolbar.accent ?? '#e94560';

  const statusLabel = useCallback((s: ShotVideo['status']) => {
    switch (s) {
      case 'generating': return t('storyboard.videoGenerating', '生成中');
      case 'done': return t('storyboard.videoDone', '完成');
      case 'failed': return t('storyboard.videoFailed', '失败');
      default: return t('storyboard.videoPending', '待生成');
    }
  }, [t]);

  const statusColor = useCallback((s: ShotVideo['status']) => {
    switch (s) {
      case 'generating': return '#60a5fa';
      case 'done': return isDark ? '#22c55e' : '#16a34a';
      case 'failed': return isDark ? '#ef4444' : '#dc2626';
      default: return textMuted;
    }
  }, [isDark, textMuted]);

  return (
    <div
      data-drop-zone="alternative"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'transparent', borderRadius: 8, border: `1px solid ${cardBorder}`, overflow: 'hidden' }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const libData = e.dataTransfer.getData(LIB_DRAG_MIME);
        if (!libData || !onExternalVideoDrop) return;
        try {
          const item = JSON.parse(libData) as { type: string; name?: string; data: Asset };
          const d = item.data?.data;
          if (item.type === 'asset' && item.data?.kind === 'video' && d?.kind === 'video') {
            onExternalVideoDrop({ storageKey: d.storageKey ?? '', url: d.url ?? '', title: item.name });
          }
        } catch { /* 拖拽数据解析失败忽略 */ }
      }}
    >
      <div style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, color: textPrimary, borderBottom: `1px solid ${cardBorder}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{t('storyboard.alternativeVideos', '备选视频')}</span>
        <span style={{ fontSize: 10, color: textMuted, fontWeight: 400 }}>{videos.length - 1} {t('storyboard.alternatives', '备选')}</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8, alignContent: 'start' }}>
        {videos.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, height: 100, color: textMuted, fontSize: 11, opacity: 0.7, gridColumn: '1 / -1' }}>
            <CANVAS_NODE_ICONS.videoEmpty size={22} strokeWidth={1.5} />
            <span>{t('storyboard.noVideos', '暂无生成产物')}</span>
          </div>
        )}
        {videos.map((v, idx) => {
          const isActive = idx === activeVideoIndex;
          const isPrimary = idx === 0;
          const color = statusColor(v.status);
          return (
            <div
              key={`${v.storageKey}-${idx}`}
              onClick={() => v.status === 'done' && onActivate(idx)}
              style={{
                position: 'relative',
                borderRadius: 8,
                overflow: 'hidden',
                cursor: v.status === 'done' ? 'pointer' : 'default',
                background: isActive ? (isDark ? 'rgba(233,69,96,0.08)' : 'rgba(233,69,96,0.06)') : 'transparent',
                border: `1px solid ${isActive ? accent : cardBorder}`,
                transition: 'background 0.1s, border-color 0.1s',
              }}
            >
              {/* 16:9 缩略图区：与资产抽屉卡片同款封面 */}
              <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%', background: isDark ? theme.canvas.background : '#f5f5f4' }}>
                <div style={{ position: 'absolute', inset: 0 }}>
                  {v.status === 'done' ? (
                    <AuthorizedVideo
                      src={v.storageKey}
                      muted
                      preload="metadata"
                      playsInline
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
                      {v.status === 'generating' ? <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> : v.status === 'failed' ? <CANVAS_NODE_ICONS.close size={16} /> : '·'}
                    </div>
                  )}
                  {isPrimary && (
                    <span style={{ position: 'absolute', left: 4, top: 4, fontSize: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '0 3px', borderRadius: 3 }}>
                      {t('storyboard.main', '主')}
                    </span>
                  )}
                  {isActive && (
                    <span style={{ position: 'absolute', right: 4, top: 4, fontSize: 8, background: accent, color: '#fff', padding: '0 3px', borderRadius: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Check size={8} /> {t('storyboard.active', '用')}
                    </span>
                  )}
                </div>
              </div>
              {/* 信息区 */}
              <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
                  <span style={{ color, fontWeight: 600 }}>{isPrimary ? 'V0' : `V${idx}`}</span>
                  <span style={{ color: textMuted, fontSize: 9 }}>{v.model ?? ''}</span>
                </div>
                <div style={{ fontSize: 9, color: textMuted }}>{statusLabel(v.status)} {v.duration ? `${v.duration}s` : ''}</div>
                {v.status === 'failed' && v.error && (
                  <div style={{ fontSize: 9, color: '#f87171', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={v.error}>{v.error}</div>
                )}
                {v.status === 'failed' && v.diagnosis && v.diagnosis.length > 0 && (
                  <div style={{ fontSize: 9, color: '#fbbf24', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {v.diagnosis.map((d) => `F-${d.code}`).join(' ')}
                  </div>
                )}
              </div>
              {/* 操作 */}
              <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 2 }}>
                {v.status === 'failed' && onRetry && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRetry(idx); }}
                    title={t('storyboard.retry', '重试')}
                    style={{ background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: 4, cursor: 'pointer', color: '#fff', padding: 2 }}
                  >
                    <RotateCcw size={11} />
                  </button>
                )}
                {onRemove && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRemove(idx); }}
                    title={t('storyboard.remove', '移除')}
                    style={{ background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: 4, cursor: 'pointer', color: '#fff', padding: 2, display: 'flex', alignItems: 'center' }}
                  >
                    <CANVAS_NODE_ICONS.close size={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
