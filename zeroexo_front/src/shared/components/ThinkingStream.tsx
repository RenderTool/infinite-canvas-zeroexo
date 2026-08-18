/**
 * ThinkingStream - AI 思考过程打字机流式显示
 *
 * 可折叠面板，类似 reference 中图 1 风格。
 * - 默认折叠（仅显示头部和步骤计数）
 * - 展开时显示完整思考内容（打字机效果）
 * - 支持 SSE 流式接收，每段一个 step
 */
import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { ChevronDown, Brain, Loader2, Check } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useTranslation } from 'react-i18next';
import type { ThinkingStep } from '@/services/ai-think-service.js';

export interface ThinkingStreamProps {
  steps: ThinkingStep[];
  loading?: boolean;
  /** 默认是否展开 */
  defaultExpanded?: boolean;
  /** 标题 */
  title?: string;
  /** 自定义高度上限（行数） */
  maxLines?: number;
  /** 打字机速度（毫秒/字符），0 表示不延迟 */
  typewriterSpeed?: number;
}

export function ThinkingStream({
  steps,
  loading = false,
  defaultExpanded = false,
  title,
  maxLines = 200,
  typewriterSpeed: speed = 0,
}: ThinkingStreamProps): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const border = theme.toolbar.border;
  const textMuted = theme.toolbar.textMuted;
  const bgCard = isDark ? '#1a1715' : '#f5f2ec';
  const resolvedTitle = title ?? t('thinkingStream.title');

  const [expanded, setExpanded] = useState(defaultExpanded);
  const [typedSteps, setTypedSteps] = useState<ThinkingStep[]>([]);
  const lastIndexRef = useRef(-1);

  // 打字机效果：每当有新 step 时，逐字显示
  useEffect(() => {
    if (speed === 0) {
      setTypedSteps(steps);
      return;
    }
    if (steps.length === 0) {
      setTypedSteps([]);
      lastIndexRef.current = -1;
      return;
    }
    const newIndex = steps.length - 1;
    if (newIndex <= lastIndexRef.current) {
      // 已有内容
      return;
    }
    // 仅对新加入的最后一步进行打字机展示
    const newStep = steps[newIndex];
    if (!newStep) return;
    let charIdx = 0;
    const fullText = newStep.text;
    const tick = setInterval(() => {
      charIdx += 2;
      if (charIdx >= fullText.length) {
        charIdx = fullText.length;
        clearInterval(tick);
      }
      const partialStep = { ...newStep, text: fullText.slice(0, charIdx) };
      setTypedSteps((prev) => [...prev.slice(0, newIndex), partialStep]);
    }, speed);
    lastIndexRef.current = newIndex;
    return () => clearInterval(tick);
  }, [steps, speed]);

  const displaySteps = speed === 0 ? steps : typedSteps;
  const stepCount = displaySteps.length;
  const fullText = displaySteps.map((s) => s.text).join('\n').trim();
  const truncated = fullText.split('\n').slice(0, maxLines).join('\n');

  const headerStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 14px', borderRadius: 10,
    border: `1px solid ${border}`, background: bgCard,
    cursor: 'pointer', userSelect: 'none',
    transition: 'all .2s',
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        onClick={() => setExpanded((v) => !v)}
        style={headerStyle}
      >
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `${accent}12`, color: accent, flexShrink: 0,
        }}>
          {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Brain size={14} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'inherit' }}>{resolvedTitle}</div>
          <div style={{ fontSize: 10, color: textMuted, marginTop: 2 }}>
            {loading ? t('thinkingStream.analyzingIdea') : stepCount > 0 ? t('thinkingStream.stepsCompleted', { count: stepCount }) : t('thinkingStream.clickToExpand')}
          </div>
        </div>
        {stepCount > 0 && !loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#10b981' }}>
            <Check size={12} />
            <span style={{ fontSize: 10, fontWeight: 500 }}>{t('thinkingStream.done')}</span>
          </div>
        )}
        <ChevronDown size={14} style={{
          color: textMuted,
          transition: 'transform .2s',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
        }} />
      </div>

      {expanded && stepCount > 0 && (
        <div style={{
          marginTop: 8, padding: 14, borderRadius: 10,
          border: `1px solid ${border}`, background: bgCard,
          fontSize: 12, lineHeight: 1.7,
          color: isDark ? '#d6d3d1' : '#44403c',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 400, overflow: 'auto',
        }}>
          {truncated}
          {loading && (
            <span style={{ display: 'inline-block', width: 6, height: 14, background: accent, marginLeft: 2, animation: 'blink 1s infinite' }} />
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
      `}</style>
    </div>
  );
}
