/**
 * StoryboardEpisodeProgress - 分镜按集生成进度面板 (Phase 4)
 *
 * 展示按集分镜生成的进度、每集状态列表、Token 消耗。
 * 支持取消、重试失败集。
 */
import { CSSProperties, ReactElement } from 'react';import { Modal, Progress } from 'antd';import { useTheme } from '@zeroexo/plugin-theme';
import { useTranslation } from 'react-i18next';
import { StopCircle, RefreshCw } from 'lucide-react';
import type { EpisodeInfo, EpisodeShotResult } from '@/pages/editor/editor-canvas/interactions/ai-generation-utils.js';

// ===== 类型 =====

/** 单集生成状态 */
export type EpisodeGenStatus = 'pending' | 'generating' | 'completed' | 'failed';

/** 单集状态条目 */
export interface EpisodeStatusItem {
  episode: EpisodeInfo;
  status: EpisodeGenStatus;
  result?: EpisodeShotResult;
  error?: string;
}

/** 总进度 */
export interface StoryboardEpisodeProgress {
  total: number;
  completed: number;
  failed: number;
  tokenUsed: number;
  episodes: EpisodeStatusItem[];
  finished: boolean;
}

/** 组件 Props */
export interface StoryboardEpisodeProgressProps {
  open: boolean;
  progress: StoryboardEpisodeProgress;
  onCancel: () => void;
  onRetryFailed: () => void;
  onClose: () => void;
  onViewResults?: () => void;
}

// ===== 组件 =====

export function StoryboardEpisodeProgress({
  open,
  progress,
  onCancel,
  onRetryFailed,
  onClose,
  onViewResults,
}: StoryboardEpisodeProgressProps): ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';

  const bg = theme.toolbar.background;
  const text = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const border = theme.toolbar.border;
  const accent = theme.toolbar.accent;
  const successColor = '#10b981';
  const errorColor = '#ef4444';

  const progressPct = progress.total > 0
    ? Math.round(((progress.completed + progress.failed) / progress.total) * 100)
    : 0;

  // 单集状态图标
  const getStatusIcon = (status: EpisodeGenStatus): ReactElement => {
    const iconStyle: CSSProperties = {
      width: 18, height: 18, borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, fontSize: 10,
    };
    switch (status) {
      case 'pending':
        return (
          <span style={{ ...iconStyle, background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)', color: textMuted }}>
          ·
        </span>
        );
      case 'generating':
        return (
          <span style={{ ...iconStyle, background: `${accent}20`, color: accent }}>
          ◉
        </span>
        );
      case 'completed':
        return (
          <span style={{ ...iconStyle, background: `${successColor}20`, color: successColor }}>
          ✓
        </span>
        );
      case 'failed':
        return (
          <span style={{ ...iconStyle, background: `${errorColor}20`, color: errorColor }}>
          ✗
        </span>
        );
    }
  };

  // ── 样式 ──
  const contentStyle: CSSProperties = {
    background: bg, padding: 0, overflow: 'hidden',
    borderRadius: 16, border: `1px solid ${border}`,
  };
  const modalBodyStyle: CSSProperties = { padding: 0, display: 'flex', flexDirection: 'column' };
  const maskStyle: CSSProperties = {
    background: 'transparent',
  };
  const headerStyle: CSSProperties = {
    padding: '18px 24px', borderBottom: `1px solid ${border}`,
    background: isDark ? '#1f1f1f' : '#fafaf7',
  };
  const progressSectionStyle: CSSProperties = {
    padding: '16px 24px', borderBottom: `1px solid ${border}`,
  };
  const tokenSectionStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 24px', borderBottom: `1px solid ${border}`,
    fontSize: 13, color: text,
  };
  const episodeListStyle: CSSProperties = {
    padding: '4px 24px 14px', maxHeight: 320, overflowY: 'auto',
  };
  const episodeRowStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 0', fontSize: 13, color: text,
  };
  const episodeNameStyle: CSSProperties = {
    flex: 1, minWidth: 0, overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  };
  const footerStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
    padding: '14px 24px', borderTop: `1px solid ${border}`,
    background: isDark ? '#1f1f1f' : '#fafaf7',
  };
  const btnBase: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 20px', border: 'none', borderRadius: 10,
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
    transition: 'all 0.2s', fontFamily: 'inherit',
  };
  const primaryBtn: CSSProperties = { ...btnBase, background: accent, color: '#fff' };
  const ghostBtn: CSSProperties = {
    ...btnBase, border: `1px solid ${border}`, background: 'transparent', color: textMuted,
  };
  const dangerBtn: CSSProperties = {
    ...btnBase, border: `1px solid ${errorColor}40`, background: 'transparent', color: errorColor,
  };

  const hasFailed = progress.failed > 0;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      centered
      width={520}
      footer={null}
      destroyOnHidden
      closeIcon={null}
      mask={{ closable: false }}
      styles={{ container: contentStyle, body: modalBodyStyle, mask: maskStyle }}
    >
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ fontSize: 16, fontWeight: 600, color: text, letterSpacing: '0.3px' }}>
          {progress.finished ? t('episode.generationCompletedTitle') : t('episode.generationInProgressTitle')}
        </div>
        <div style={{ fontSize: 12, color: textMuted, marginTop: 2 }}>
          {progress.finished
            ? hasFailed
              ? t('episode.progressSummary', { completed: progress.completed, failed: progress.failed })
              : t('episode.allProcessed')
            : t('episode.processing', { completed: progress.completed + progress.failed, total: progress.total })}
        </div>
      </div>

      {/* 进度条 */}
      <div style={progressSectionStyle}>
        <Progress
          percent={progressPct}
          strokeColor={progress.finished && !hasFailed ? successColor : hasFailed ? errorColor : accent}
          railColor={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}
          size="small"
          format={(pct) => `${pct}%`}
        />
      </div>

      {/* Token 消耗 */}
      <div style={tokenSectionStyle}>
        <span style={{ color: textMuted }}>{t('episode.tokenConsumption')}</span>
        <span>
          {progress.tokenUsed > 0
            ? progress.tokenUsed.toLocaleString()
            : '--'}
        </span>
      </div>

      {/* 剧集状态列表 */}
      <div style={episodeListStyle}>
        {progress.episodes.map((item) => (
          <div key={item.episode.id} style={episodeRowStyle}>
            {getStatusIcon(item.status)}
            <span style={episodeNameStyle}>
              {`${t('storyboard.episodeLabel', { number: item.episode.number })}${item.episode.title !== `第${item.episode.number}集` ? ` · ${item.episode.title}` : ''}`}
            </span>
            <span style={{ fontSize: 11, color: textMuted, flexShrink: 0 }}>
              {item.status === 'generating' ? t('episode.generatingShort') : ''}
              {item.status === 'completed' && item.result?.usage?.costTokens != null
                ? `${item.result.usage.costTokens} tokens`
                : ''}
              {item.status === 'failed' ? (item.error ?? t('episode.failed')) : ''}
              {item.status === 'pending' ? t('episode.pending') : ''}
            </span>
          </div>
        ))}
        {progress.episodes.length === 0 && (
          <div style={{ textAlign: 'center', padding: '16px 0', color: textMuted, fontSize: 12 }}>
            {t('episode.preparing')}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={footerStyle}>
        {!progress.finished && (
          <button type="button" style={dangerBtn} onClick={onCancel}>
            <StopCircle size={14} />
            {t('episode.cancel')}
          </button>
        )}
        {progress.finished && hasFailed && (
          <button type="button" style={{ ...ghostBtn, color: accent }} onClick={onRetryFailed}>
            <RefreshCw size={14} />
            {t('episode.retryFailed')}
          </button>
        )}
        {progress.finished && onViewResults && (
          <button type="button" style={primaryBtn} onClick={onViewResults}>
            {t('episode.viewResults')}
          </button>
        )}
        {progress.finished && (
          <button type="button" style={ghostBtn} onClick={onClose}>
            {t('episode.close')}
          </button>
        )}
      </div>
    </Modal>
  );
}