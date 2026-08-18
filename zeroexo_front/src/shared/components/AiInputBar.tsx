/**
 * AiInputBar - 通用 AI 问答输入组件
 *
 * 设计参考 AgentChatShell 输入栏：
 * - 圆角边框容器
 * - 多行 textarea
 * - 圆形发送按钮（右侧）
 * - 支持回车发送、Shift+Enter 换行
 * - 支持预设模板快捷填充
 * - 支持打字机效果的占位文本
 *
 * 用于：创意简报输入、剧本阶段问答、立项步骤参数描述等。
 */
import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react';
import { Send, Loader2, Sparkles, ChevronDown } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useTranslation } from 'react-i18next';

export interface AiInputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void | Promise<void>;
  placeholder?: string;
  /** 打字机效果循环占位文本列表 */
  typewriterPlaceholders?: string[];
  disabled?: boolean;
  loading?: boolean;
  /** 预设模板快捷填充 */
  presets?: Array<{ label: string; content: string; icon?: React.ReactNode }>;
  /** 提示词前缀（如「创意：」），会显示在输入框左下角 */
  prefixLabel?: string;
  /** 主色调，覆盖 theme accent */
  accent?: string;
  /** 输入框最小高度（行数） */
  minRows?: number;
  /** 输入框最大高度（行数） */
  maxRows?: number;
  /** 加载中文案 */
  loadingText?: string;
  /** 视觉风格: bordered=圆角边框容器(默认), elevated=无边框悬浮质感 */
  variant?: 'bordered' | 'elevated';
}

// 呼吸跳跃动画关键帧(按钮缓慢缩放,模拟呼吸感)
const rippleKeyframes = `
@keyframes zeroexo-ripple {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}

@keyframes zeroexo-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
`;

export function AiInputBar({
  value,
  onChange,
  onSend,
  placeholder,
  typewriterPlaceholders,
  disabled = false,
  loading = false,
  presets = [],
  prefixLabel,
  accent: accentProp,
  minRows = 2,
  maxRows = 6,
  loadingText,
  variant = 'bordered',
}: AiInputBarProps): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const accent = accentProp || theme.toolbar.accent;
  const border = theme.toolbar.border;
  const textMuted = theme.toolbar.textMuted;
  const bgPanel = isDark ? '#131110' : '#fafaf9';
  const resolvedPlaceholder = placeholder ?? t('aiInputBar.placeholder');
  const resolvedLoadingText = loadingText ?? t('aiInputBar.aiGenerating');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showPresets, setShowPresets] = useState(false);
  
  // 打字机效果 - 使用 ref 管理状态机，避免 effect 依赖循环
  const [typewriterText, setTypewriterText] = useState('');
  const twIndexRef = useRef(0);
  const twCharRef = useRef(0);
  const twTypingRef = useRef(true);
  const twTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 仅当用户未输入内容且有打字机占位文本时启用
  const effectivePlaceholder = value || loading 
    ? (loading ? resolvedLoadingText : resolvedPlaceholder)
    : (typewriterPlaceholders && typewriterPlaceholders.length > 0 
        ? ((typewriterText || typewriterPlaceholders[twIndexRef.current]) ?? resolvedPlaceholder)
        : resolvedPlaceholder);

  // 打字机效果 effect - 仅在外部依赖变化时重启，内部通过 ref 管理
  useEffect(() => {
    if (twTimerRef.current) {
      clearTimeout(twTimerRef.current);
      twTimerRef.current = null;
    }
    
    if (!typewriterPlaceholders || typewriterPlaceholders.length === 0) return;
    if (value) return;
    
    twIndexRef.current = 0;
    twCharRef.current = 0;
    twTypingRef.current = true;
    setTypewriterText('');
    
    const tick = () => {
      if (!typewriterPlaceholders || typewriterPlaceholders.length === 0) return;
      const currentText = typewriterPlaceholders[twIndexRef.current] || '';
      
      if (twTypingRef.current) {
        if (twCharRef.current <= currentText.length) {
          setTypewriterText(currentText.slice(0, twCharRef.current));
          twCharRef.current += 1;
          twTimerRef.current = setTimeout(tick, 100);
        } else {
          twTimerRef.current = setTimeout(() => {
            twTypingRef.current = false;
            tick();
          }, 2000);
        }
      } else {
        if (twCharRef.current > 0) {
          twCharRef.current -= 1;
          setTypewriterText(currentText.slice(0, twCharRef.current));
          twTimerRef.current = setTimeout(tick, 50);
        } else {
          twIndexRef.current = (twIndexRef.current + 1) % typewriterPlaceholders.length;
          twTypingRef.current = true;
          setTypewriterText('');
          twTimerRef.current = setTimeout(tick, 400);
        }
      }
    };
    
    twTimerRef.current = setTimeout(tick, 400);
    
    return () => {
      if (twTimerRef.current) {
        clearTimeout(twTimerRef.current);
        twTimerRef.current = null;
      }
    };
  }, [typewriterPlaceholders, value]);

  const handleSend = useCallback(async () => {
    const text = value.trim();
    if (!text || loading || disabled) return;
    await onSend(text);
  }, [value, loading, disabled, onSend]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送，Shift+Enter 换行
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  // 自动调整 textarea 高度
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const lineHeight = 22;
      const maxHeight = lineHeight * maxRows + 16;
      const newHeight = Math.min(textareaRef.current.scrollHeight, maxHeight);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [onChange, maxRows]);

  const canSend = value.trim().length > 0 && !loading && !disabled;

  return (
    <div style={{ width: '100%' }}>
      {/* 注入心跳动画关键帧 */}
      <style>{rippleKeyframes}</style>
      {/* 预设模板快捷按钮 */}
      {presets.length > 0 && (
        <div style={{ marginBottom: 10, position: 'relative' }}>
          <button
            type="button"
            onClick={() => setShowPresets((v) => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 500,
              border: `1px solid ${border}`, background: 'transparent',
              color: textMuted, cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all .2s',
            }}
          >
            <Sparkles size={11} style={{ color: accent }} /> {t('aiInputBar.inspirationTemplates')}
            <ChevronDown size={10} style={{
              transition: 'transform .2s',
              transform: showPresets ? 'rotate(180deg)' : 'rotate(0)',
            }} />
          </button>
          {showPresets && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 10,
              display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: '100%',
              padding: 10, borderRadius: 10,
              background: isDark ? '#1c1917' : '#ffffff',
              border: `1px solid ${border}`,
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            }}>
              {presets.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { onChange(p.content); setShowPresets(false); }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '5px 12px', borderRadius: 9999,
                    border: `1px solid ${border}`,
                    background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                    color: 'inherit', fontSize: 11, fontWeight: 500,
                    cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'all .2s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = 'inherit'; }}
                >
                  {p.icon}
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 主输入框容器（圆角 + 边框 + 阴影） */}
      <div style={{
        position: 'relative',
        borderRadius: 24,
        ...(variant === 'elevated'
          ? {
              // 无边框悬浮质感: 透明占位边框 + 半透明分层背景 + 柔和阴影
              border: '1px solid transparent',
              background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
              backdropFilter: 'blur(12px)',
              boxShadow: value.trim()
                ? `inset 0 0 0 1px ${accent}22, 0 8px 32px rgba(0,0,0,0.06)`
                : '0 8px 32px rgba(0,0,0,0.06)',
            }
          : {
              border: `1.5px solid ${value.trim() ? accent : border}`,
              background: bgPanel,
              boxShadow: value.trim() ? `0 0 0 3px ${accent}10, 0 4px 16px rgba(0,0,0,0.08)` : '0 2px 8px rgba(0,0,0,0.04)',
            }),
        transition: 'all .25s',
        padding: '12px 14px',
      }}>
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={effectivePlaceholder}
          disabled={disabled || loading}
          rows={minRows}
          style={{
            width: '100%', border: 'none', background: 'transparent', outline: 'none',
            fontSize: 14, lineHeight: '22px', color: 'inherit',
            fontFamily: "'DM Sans', system-ui, sans-serif",
            resize: 'none', padding: 0,
            minHeight: `${22 * minRows}px`,
            maxHeight: `${22 * maxRows + 16}px`,
          }}
        />

        {/* 底部栏：prefix + send button */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginTop: 8, gap: 10,
        }}>
          {/* 左侧 prefix 提示 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: textMuted, flex: 1, minWidth: 0 }}>
            {prefixLabel && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '2px 8px', borderRadius: 9999,
                background: `${accent}12`, color: accent, fontWeight: 500, fontSize: 10,
              }}>
                {prefixLabel}
              </span>
            )}
            <span style={{ fontSize: 10, opacity: 0.7 }}>{t('aiInputBar.sendHint')}</span>
          </div>

          {/* 圆形发送按钮 */}
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label={t('aiInputBar.send')}
            style={{
              width: 36, height: 36, flexShrink: 0,
              borderRadius: '50%',
              border: canSend ? '2px solid transparent' : '2px solid transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: canSend ? accent : (isDark ? '#262626' : '#e5e5e5'),
              color: canSend ? '#fff' : textMuted,
              cursor: canSend ? 'pointer' : 'not-allowed',
              boxShadow: canSend ? `0 4px 12px ${accent}40` : 'none',
              transition: 'all .2s',
              animation: canSend ? 'zeroexo-ripple 3s ease-in-out infinite' : 'none',
              '--ai-accent': accent,
            } as React.CSSProperties}
          >
            {loading ? (
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
