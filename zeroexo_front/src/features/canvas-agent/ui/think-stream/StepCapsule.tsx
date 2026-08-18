/**
 * StepCapsule - 步骤胶囊行组件
 *
 * 源自 references/动效参考/ai/AI步骤AIAgentStepsTimeline.tailwind.jsx
 * 提取核心视觉：步骤图标（旋转加载/完成勾）、步骤名称、工具标签、耗时、展开/折叠详情
 * 差异：数据驱动，接收 steps 数组
 */

import { useState, type CSSProperties } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ThinkingStep } from '../types.js';
import { useAgentTheme } from '../context/theme-context.js';

const STEP_ICONS: Record<string, string> = {
  think: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.1-2.6 5.4-.8.8-1.4 1.9-1.4 3.1V18h-6v-.5c0-1.2-.6-2.3-1.4-3.1C6.2 13.1 5 11.4 5 9a7 7 0 0 1 7-7z"/><path d="M9 21h6"/></svg>',
  tool: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>',
  file: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>',
  spin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>',
};

export interface StepCapsuleListProps {
  steps: ThinkingStep[];
}

export function StepCapsuleList({ steps }: StepCapsuleListProps): React.ReactElement {
  const t = useAgentTheme();

  if (steps.length === 0) return <></>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {steps.map((step, i) => (
        <StepCapsuleItem key={i} step={step} isLast={i === steps.length - 1} theme={t} />
      ))}
    </div>
  );
}

interface StepCapsuleItemProps {
  step: ThinkingStep;
  isLast: boolean;
  theme: ReturnType<typeof useAgentTheme>;
}

function StepCapsuleItem({ step, isLast, theme: t }: StepCapsuleItemProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const isRunning = step.status === 'running';
  const isDone = step.status === 'done';

  const iconSvg = STEP_ICONS[step.icon] ?? STEP_ICONS.think ?? '';

  return (
    <div style={{ display: 'flex', gap: 14, position: 'relative', paddingBottom: isLast ? 0 : 4 }}>
      {/* 连接线 */}
      {!isLast && (
        <div
          style={{
            position: 'absolute',
            left: 13,
            top: 30,
            bottom: -4,
            width: 2,
            background: isDone ? t.accent : t.border,
            borderRadius: 1,
          }}
        />
      )}

      {/* 图标 */}
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: t.isDark ? '#0f172a' : '#f8fafc',
          border: `1px solid ${isRunning ? t.accent : isDone ? t.border : t.border}`,
          color: isRunning ? '#a5b4fc' : isDone ? '#4ade80' : t.textMuted,
          position: 'relative',
          zIndex: 1,
          transition: 'all 0.25s',
        }}
        className={isRunning ? 'agent-step-spin' : ''}
        dangerouslySetInnerHTML={{ __html: iconSvg }}
      />

      {/* 内容 */}
      <div style={{ flex: 1, minWidth: 0, paddingBottom: 8 }}>
        <div
          onClick={() => setExpanded(!expanded)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 28,
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: isRunning ? t.text : isDone ? '#4ade80' : t.textMuted,
            }}
          >
            {step.name}
          </span>
          {step.tool && (
            <span
              style={{
                fontSize: 11,
                fontFamily: 'SF Mono, Consolas, monospace',
                color: '#a5b4fc',
                background: '#312e81',
                padding: '2px 8px',
                borderRadius: 5,
              }}
            >
              {step.tool}
            </span>
          )}
          {step.dur !== undefined && (
            <span
              style={{
                fontSize: 11,
                color: t.isDark ? '#475569' : '#94a3b8',
                marginLeft: 'auto',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {(step.dur / 1000).toFixed(1)}s
            </span>
          )}
          <span
            style={{
              color: t.textMuted,
              transition: 'transform 0.2s',
              transform: expanded ? 'rotate(90deg)' : 'none',
              display: 'flex',
            }}
          >
            <ChevronRight size={12} />
          </span>
        </div>

        {/* 展开详情 */}
        <div
          style={{
            display: 'grid',
            gridTemplateRows: expanded ? '1fr' : '0fr',
            transition: 'grid-template-rows 0.28s ease',
          }}
        >
          <div style={{ overflow: 'hidden' }}>
            {step.input && (
              <div style={detailBoxStyle(t)}>
                <div style={detailLabelStyle}>Input</div>
                <pre style={detailPreStyle}>{step.input}</pre>
              </div>
            )}
            {step.result && (
              <div style={{ ...detailBoxStyle(t), marginTop: 8 }}>
                <div style={detailLabelStyle}>Result</div>
                <pre style={{ ...detailPreStyle, color: '#86efac' }}>{step.result}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const detailBoxStyle = (t: ReturnType<typeof useAgentTheme>): CSSProperties => ({
  background: t.isDark ? '#0f172a' : '#f8fafc',
  border: `1px solid ${t.isDark ? '#1e293b' : '#e2e8f0'}`,
  borderRadius: 9,
  padding: '10px 12px',
});

const detailLabelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: '#475569',
  marginBottom: 5,
};

const detailPreStyle: CSSProperties = {
  fontFamily: 'SF Mono, Consolas, monospace',
  fontSize: 11.5,
  color: '#94a3b8',
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: 0,
};