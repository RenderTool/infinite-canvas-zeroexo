/**
 * ScriptProgressPanel - 剧本生成进度面板
 *
 * 展示 AI 剧本生成的整体进度、单元状态列表、Token 消耗。
 * 支持自适应轮询、失败重试、停止（后台继续）、完成后查看剧本。
 */
import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import { Modal, Progress, Tooltip } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { useTranslation } from 'react-i18next';

// ── 类型定义 ──

export interface TaskUnit {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  message?: string;
}

export interface TaskProgress {
  taskId: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  progress: number;
  units: TaskUnit[];
  tokenUsed?: number;
  estimatedTotalTokens?: number;
}

export interface ScriptProgressPanelProps {
  open: boolean;
  /** 任务名称（用于标题） */
  taskName: string;
  /** 初始进度数据 */
  initialProgress?: TaskProgress;
  /** 轮询获取进度 */
  onPoll: () => Promise<TaskProgress>;
  /** 重试单个单元 */
  onRetryUnit?: (unitId: string) => Promise<void>;
  /** 停止任务（后台继续） */
  onStop?: () => Promise<void>;
  /** 查看剧本 */
  onViewScript?: () => void;
  /** 关闭面板 */
  onClose: () => void;
  /** 任务完成回调 */
  onComplete?: () => void;
  /** z-index（需高于父 Modal） */
  zIndex?: number;
}

// ── 组件 ──

export function ScriptProgressPanel({
  open,
  taskName,
  initialProgress,
  onPoll,
  onRetryUnit,
  onStop,
  onViewScript,
  onClose,
  onComplete,
  zIndex,
}: ScriptProgressPanelProps): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';

  const [progress, setProgress] = useState<TaskProgress | null>(initialProgress ?? null);
  const [polling, setPolling] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const noChangeCountRef = useRef(0);
  const pollIntervalRef = useRef(2000);
  const lastProgressRef = useRef(-1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedRef = useRef(false);

  // 轮询
  const doPoll = useCallback(async () => {
    try {
      const data = await onPoll();
      setProgress(data);

      // 检测进度变化
      if (data.progress === lastProgressRef.current) {
        noChangeCountRef.current += 1;
        if (noChangeCountRef.current >= 3) {
          pollIntervalRef.current = 5000;
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = setInterval(doPoll, 5000);
          }
        }
      } else {
        noChangeCountRef.current = 0;
        lastProgressRef.current = data.progress;
      }

      // 任务完成
      if (data.status === 'success' || data.status === 'failed' || data.status === 'cancelled') {
        setPolling(false);
        completedRef.current = true;
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (data.status === 'success' && onComplete) {
          onComplete();
        }
      }
    } catch {
      // 轮询失败，继续尝试
    }
  }, [onPoll, onComplete]);

  // 开始/停止轮询
  useEffect(() => {
    if (open && !completedRef.current) {
      setPolling(true);
      noChangeCountRef.current = 0;
      pollIntervalRef.current = 2000;
      lastProgressRef.current = initialProgress?.progress ?? -1;

      // 立即执行一次
      doPoll();

      // 定时轮询
      timerRef.current = setInterval(doPoll, 2000);

      return () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };
    }
  }, [open, doPoll, initialProgress]);

  // 重置状态
  useEffect(() => {
    if (open) {
      completedRef.current = false;
      setStopped(false);
      setRetrying(null);
      noChangeCountRef.current = 0;
      pollIntervalRef.current = 2000;
      lastProgressRef.current = -1;
    }
  }, [open]);

  // 重试单元
  const handleRetry = useCallback(async (unitId: string) => {
    if (!onRetryUnit) return;
    setRetrying(unitId);
    try {
      await onRetryUnit(unitId);
      // 重试后恢复轮询
      noChangeCountRef.current = 0;
      pollIntervalRef.current = 2000;
    } catch {
      // 重试失败
    } finally {
      setRetrying(null);
    }
  }, [onRetryUnit]);

  // 停止
  const handleStop = useCallback(async () => {
    if (!onStop) return;
    try {
      await onStop();
      setStopped(true);
      setPolling(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    } catch {
      // 停止失败
    }
  }, [onStop]);

  // ── 主题色 ──
  const bg = theme.toolbar.background;
  const text = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const border = theme.toolbar.border;
  const accent = theme.toolbar.accent;
  const successColor = '#10b981';
  const errorColor = '#ef4444';

  // 完成状态
  const isCompleted = progress?.status === 'success';
  const isFailed = progress?.status === 'failed';
  const isActive = polling && !stopped;

  // ── 样式 ──
  const contentStyle: CSSProperties = {
    background: bg,
    padding: 0,
    overflow: 'hidden',
    borderRadius: 16,
    border: `1px solid ${border}`,
  };
  const modalBodyStyle: CSSProperties = { padding: 0, display: 'flex', flexDirection: 'column' };
  const maskStyle: CSSProperties = {
    background: 'transparent',
  };
  const headerStyle: CSSProperties = {
    padding: '18px 24px',
    borderBottom: `1px solid ${border}`,
    background: isDark ? '#1f1f1f' : '#fafaf7',
  };
  const progressSectionStyle: CSSProperties = {
    padding: '16px 24px',
    borderBottom: `1px solid ${border}`,
  };
  const unitListStyle: CSSProperties = {
    padding: '4px 24px 14px',
    maxHeight: 280,
    overflowY: 'auto',
  };
  const unitRowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 0',
    fontSize: 13,
    color: text,
  };
  const unitStatusIconStyle: CSSProperties = {
    width: 18,
    height: 18,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontSize: 10,
  };
  const unitNameStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
  const tokenSectionStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 24px',
    borderBottom: `1px solid ${border}`,
    fontSize: 13,
    color: text,
  };
  const footerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    padding: '14px 24px',
    borderTop: `1px solid ${border}`,
    background: isDark ? '#1f1f1f' : '#fafaf7',
  };
  const btnBase: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 20px',
    border: 'none',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontFamily: 'inherit',
  };
  const primaryBtn: CSSProperties = { ...btnBase, background: accent, color: '#fff' };
  const ghostBtn: CSSProperties = {
    ...btnBase,
    border: `1px solid ${border}`,
    background: 'transparent',
    color: textMuted,
  };
  const dangerBtn: CSSProperties = {
    ...btnBase,
    border: `1px solid ${errorColor}40`,
    background: 'transparent',
    color: errorColor,
  };
  const retryBtn: CSSProperties = {
    fontSize: 11,
    color: accent,
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    padding: '2px 6px',
    fontFamily: 'inherit',
    fontWeight: 600,
    flexShrink: 0,
  };

  // 获取单元状态图标
  const getUnitStatusIcon = (status: TaskUnit['status']): React.ReactNode => {
    switch (status) {
      case 'pending':
        return <span style={{ ...unitStatusIconStyle, background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)', color: textMuted }}>·</span>;
      case 'running':
        return <span style={{ ...unitStatusIconStyle, background: `${accent}20`, color: accent }}>◉</span>;
      case 'success':
        return <span style={{ ...unitStatusIconStyle, background: `${successColor}20`, color: successColor }}>✓</span>;
      case 'failed':
        return <span style={{ ...unitStatusIconStyle, background: `${errorColor}20`, color: errorColor }}>✗</span>;
    }
  };

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
      zIndex={zIndex}
      styles={{ container: contentStyle, body: modalBodyStyle, mask: maskStyle }}
    >
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ fontSize: 16, fontWeight: 600, color: text, letterSpacing: '0.3px' }}>
          {isCompleted ? t('storyboard.generationCompleted') : isFailed ? t('storyboard.generationFailed') : stopped ? t('storyboard.stopped') : taskName}
        </div>
        <div style={{ fontSize: 12, color: textMuted, marginTop: 2 }}>
          {isActive && t('storyboard.processing')}
          {isCompleted && t('storyboard.allChaptersCompleted')}
          {isFailed && t('storyboard.someChaptersFailed')}
          {stopped && t('storyboard.continuingInBackground')}
        </div>
      </div>

      {/* 进度条 */}
      <div style={progressSectionStyle}>
        <Progress
          percent={Math.round(progress?.progress ?? 0)}
          strokeColor={isCompleted ? successColor : isFailed ? errorColor : accent}
          railColor={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}
          size="small"
          format={(pct) => `${pct}%`}
        />
      </div>

      {/* Token 实时更新 */}
      <div style={tokenSectionStyle}>
        <span style={{ color: textMuted }}>{t('storyboard.tokenConsumption')}</span>
        <span>
          {progress?.tokenUsed != null
            ? progress.tokenUsed.toLocaleString()
            : '--'}
          {progress?.estimatedTotalTokens != null
            ? ` / ${progress.estimatedTotalTokens.toLocaleString()}`
            : ''}
        </span>
      </div>

      {/* 单元状态列表 */}
      <div style={unitListStyle}>
        {progress?.units.map((unit) => (
          <div key={unit.id} style={unitRowStyle}>
            {getUnitStatusIcon(unit.status)}
            <span style={unitNameStyle}>{unit.name}</span>
            {unit.status === 'running' && (
              <span style={{ fontSize: 11, color: textMuted, flexShrink: 0 }}>
                {unit.message ?? t('storyboard.processing')}
              </span>
            )}
            {unit.status === 'failed' && (
              <>
                <Tooltip title={unit.message}>
                  <span style={{ fontSize: 11, color: textMuted, flexShrink: 0, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {unit.message ?? t('storyboard.processingFailed')}
                  </span>
                </Tooltip>
                <button
                  type="button"
                  style={retryBtn}
                  disabled={retrying === unit.id}
                  onClick={() => handleRetry(unit.id)}
                >
                  {retrying === unit.id ? t('storyboard.retrying') : t('storyboard.retry')}
                </button>
              </>
            )}
            {unit.status === 'success' && (
              <span style={{ fontSize: 11, color: successColor, flexShrink: 0 }}>{t('storyboard.done')}</span>
            )}
          </div>
        ))}
        {(!progress?.units || progress.units.length === 0) && (
          <div style={{ textAlign: 'center', padding: '16px 0', color: textMuted, fontSize: 12 }}>
            {t('storyboard.preparing')}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={footerStyle}>
        {!isCompleted && !isFailed && !stopped && (
          <button type="button" style={dangerBtn} onClick={handleStop}>
            {t('storyboard.stopBackground')}
          </button>
        )}
        {(isCompleted || isFailed || stopped) && onViewScript && (
          <button type="button" style={primaryBtn} onClick={onViewScript}>
            {t('storyboard.viewScript')}
          </button>
        )}
        {(isCompleted || isFailed || stopped) && (
          <button type="button" style={ghostBtn} onClick={onClose}>
            {t('common.close')}
          </button>
        )}
      </div>
    </Modal>
  );
}