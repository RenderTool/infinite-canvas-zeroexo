/**
 * StoryboardGeneratingLoader - 分镜生成中加载态组件
 *
 * 设计参考: AIGeneratingContentLoader.tailwind.jsx（Uiverse 风格）
 * 适配项目: inline style + theme token + i18n，不依赖 Tailwind。
 *
 * 三阶段视觉:
 * 1. generating — AI 脉冲点 + 阶段文案 + shimmer 骨架行 + 取消按钮
 * 2. done       — 完成图标 + 完成文案 + 重新生成按钮
 * 3. cancelled  — 取消图标 + 取消文案
 *
 * CSS keyframes 通过 <style> 标签注入（全局唯一，多实例幂等）。
 */
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { X, RotateCcw, Check } from 'lucide-react';

export type LoaderStatus = 'generating' | 'done' | 'cancelled';

export interface StoryboardGeneratingLoaderProps {
  /** 当前状态 */
  status: LoaderStatus;
  /** 生成进度 0-100（可选，显示在阶段文案旁） */
  progress?: number;
  /** 取消回调 */
  onCancel?: () => void;
  /** 重新生成回调 */
  onRestart?: () => void;
}

/** 分镜生成阶段文案（i18n key 数组，按时间轮播） */
const STAGE_KEYS = [
  'storyboard.loader.analyzing',
  'storyboard.loader.drafting',
  'storyboard.loader.refining',
  'storyboard.loader.finalizing',
];

/** CSS keyframes 注入（幂等：只注入一次） */
const STYLE_ID = 'storyboard-generating-loader-keyframes';
function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
@keyframes sb-loader-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.5); opacity: 0.5; }
}
@keyframes sb-loader-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
@keyframes sb-loader-grow {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
@keyframes sb-loader-fade {
  0% { opacity: 0; }
  100% { opacity: 1; }
}
`;
  document.head.appendChild(el);
}

/** 骨架行宽度配置（渐进式从左到右，模拟流式文本） */
const SHIMMER_WIDTHS = ['96%', '88%', '92%', '60%'];

export const StoryboardGeneratingLoader = memo(function StoryboardGeneratingLoader({
  status,
  progress,
  onCancel,
  onRestart,
}: StoryboardGeneratingLoaderProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';

  // 注入 CSS keyframes（首次挂载）
  useEffect(() => { ensureKeyframes(); }, []);

  // 阶段轮播（仅 generating 态）
  const [stageIndex, setStageIndex] = useState(0);
  const [fadeKey, setFadeKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (status !== 'generating') return;
    setStageIndex(0);
    timerRef.current = setInterval(() => {
      setStageIndex((prev) => {
        const next = prev + 1;
        if (next >= STAGE_KEYS.length) {
          // 到达最后一个阶段，保持不动
          if (timerRef.current) clearInterval(timerRef.current);
          return prev;
        }
        setFadeKey((k) => k + 1);
        return next;
      });
    }, 2200);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [status]);

  // 主题色
  const bg = isDark ? '#1a1a1a' : '#ffffff';
  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const shimmerBg = isDark
    ? 'linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.08) 20%, rgba(255,255,255,0.03) 40%)'
    : 'linear-gradient(90deg, #eef2ff 0%, #e0e7ff 20%, #eef2ff 40%)';

  // 完成态图标颜色
  const doneIconBg = status === 'cancelled'
    ? (isDark ? 'rgba(255,255,255,0.08)' : '#f1f5f9')
    : (isDark ? 'rgba(16,185,129,0.15)' : '#ecfdf5');
  const doneIconColor = status === 'cancelled' ? textMuted : '#10b981';

  const stageText = useMemo(() => t(STAGE_KEYS[stageIndex] ?? STAGE_KEYS[0]!), [t, stageIndex]);

  // ===== 样式 =====
  const containerStyle: CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 20px',
    gap: 16,
    background: bg,
    borderRadius: 12,
    border: `1px solid ${border}`,
    margin: '8px 12px',
    animation: 'sb-loader-fade 0.3s ease',
  };

  const headStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    maxWidth: 320,
  };

  const dotStyle: CSSProperties = {
    width: 9,
    height: 9,
    borderRadius: '50%',
    background: accent,
    animation: status === 'generating' ? 'sb-loader-pulse 1.2s ease-in-out infinite' : 'none',
    flexShrink: 0,
    opacity: status === 'generating' ? 1 : 0.5,
  };

  const stageTextStyle: CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: textPrimary,
    flex: 1,
    animation: `sb-loader-fade 0.25s ease`,
  };

  const progressBadgeStyle: CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: accent,
    background: isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)',
    padding: '2px 8px',
    borderRadius: 10,
    flexShrink: 0,
  };

  const shimmerContainerStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    width: '100%',
    maxWidth: 320,
  };

  const cancelBtnStyle: CSSProperties = {
    width: '100%',
    maxWidth: 320,
    padding: '8px 12px',
    fontSize: 12,
    fontWeight: 600,
    fontFamily: 'inherit',
    background: 'transparent',
    color: textMuted,
    border: `1.5px solid ${border}`,
    borderRadius: 8,
    cursor: 'pointer',
    transition: 'all 0.15s',
  };

  const doneContainerStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    padding: '8px 0',
    animation: 'sb-loader-fade 0.3s ease',
  };

  const doneIconWrapStyle: CSSProperties = {
    width: 34,
    height: 34,
    borderRadius: '50%',
    background: doneIconBg,
    color: doneIconColor,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const doneTextStyle: CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: textPrimary,
  };

  const restartBtnStyle: CSSProperties = {
    marginTop: 4,
    padding: '7px 16px',
    fontSize: 12,
    fontWeight: 700,
    fontFamily: 'inherit',
    background: accent,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  };

  return (
    <div style={containerStyle}>
      {status === 'generating' ? (
        <>
          {/* 头部: AI 脉冲点 + 阶段文案 + 进度 */}
          <div style={headStyle}>
            <div style={dotStyle} />
            <span key={fadeKey} style={stageTextStyle}>{stageText}</span>
            {progress != null && progress > 0 && (
              <span style={progressBadgeStyle}>{Math.min(100, Math.round(progress))}%</span>
            )}
          </div>

          {/* Shimmer 骨架行 */}
          <div style={shimmerContainerStyle}>
            {SHIMMER_WIDTHS.map((w, i) => (
              <div
                key={i}
                style={{
                  width: w,
                  height: 14,
                  borderRadius: 6,
                  background: shimmerBg,
                  backgroundSize: '200% 100%',
                  animation: `sb-loader-shimmer 1.6s ease-in-out infinite, sb-loader-grow 0.5s ease ${i * 0.15}s forwards`,
                  transformOrigin: 'left center',
                  transform: 'scaleX(0)',
                  animationFillMode: 'forwards',
                }}
              />
            ))}
          </div>

          {/* 取消按钮 */}
          {onCancel && (
            <button
              type="button"
              style={cancelBtnStyle}
              onClick={onCancel}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#ef4444';
                e.currentTarget.style.color = '#ef4444';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = border;
                e.currentTarget.style.color = textMuted;
              }}
            >
              {t('storyboard.loader.cancel')}
            </button>
          )}
        </>
      ) : (
        /* 完成/取消态 */
        <div style={doneContainerStyle}>
          <div style={doneIconWrapStyle}>
            {status === 'cancelled' ? <X size={16} /> : <Check size={16} />}
          </div>
          <p style={doneTextStyle}>
            {status === 'cancelled' ? t('storyboard.loader.cancelled') : t('storyboard.loader.done')}
          </p>
          {onRestart && (
            <button
              type="button"
              style={restartBtnStyle}
              onClick={onRestart}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <RotateCcw size={12} />
                {t('storyboard.loader.restart')}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
});
