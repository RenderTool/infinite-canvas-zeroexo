/**
 * StepCapsule - 步骤胶囊行组件
 *
 * 源自 references/动效参考/ai/AI步骤AIAgentStepsTimeline.tailwind.jsx
 * 提取核心视觉：步骤图标（旋转加载/完成勾）、步骤名称、工具标签、耗时、展开/折叠详情
 * 差异：数据驱动，接收 steps 数组
 */

import { useState, type CSSProperties } from 'react';
import { ChevronRight, X } from 'lucide-react';
import type { ThinkingStep } from '../types.js';
import { useAgentTheme } from '../context/theme-context.js';

const STEP_ICONS: Record<string, string> = {
  think: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.1-2.6 5.4-.8.8-1.4 1.9-1.4 3.1V18h-6v-.5c0-1.2-.6-2.3-1.4-3.1C6.2 13.1 5 11.4 5 9a7 7 0 0 1 7-7z"/><path d="M9 21h6"/></svg>',
  tool: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  search: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>',
  file: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  check: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>',
  spin: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>',
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

  // 无参数只读工具（如 canvas_get_state）Input 天然为 {}，隐藏避免误导为"空数据"
  const hasInput = !!step.input && step.input.trim() !== '{}' && step.input.trim() !== '[]';

  return (
    <div style={{ display: 'flex', gap: 10, position: 'relative', paddingBottom: isLast ? 0 : 2 }}>
      {/* 连接线（层级面板子级竖线风格，无缩进） */}
      {!isLast && (
        <div
          style={{
            position: 'absolute',
            left: 8,
            top: 20,
            bottom: -2,
            width: 2,
            background: isDone ? t.accent : t.border,
            borderRadius: 1,
          }}
        />
      )}

      {/* 图标（R2：一律无颜色，随主题灰阶；状态靠图标形状区分） */}
      {step.status === 'failed' ? (
        <div
          style={{
            width: 18,
            height: 18,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: t.textMuted,
            position: 'relative',
            zIndex: 1,
          }}
        >
          <X size={11} strokeWidth={3} />
        </div>
      ) : (
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%', /* R2 返工：子动作图标小巧精致（18px < 主 Agent 头像 20px）+ 竖线轨道 */
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          color: t.textMuted, /* R2：子动作图标一律无颜色，运行态靠旋转动画区分 */
          position: 'relative',
          zIndex: 1,
          transition: 'all 0.25s',
        }}
        className={isRunning ? 'agent-step-spin' : ''}
        dangerouslySetInnerHTML={{ __html: iconSvg }}
      />
      )}

      {/* 内容 */}
      <div style={{ flex: 1, minWidth: 0, paddingBottom: 6 }}>
        <div
          onClick={() => setExpanded(!expanded)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 18, /* R2：与图标 18px 等高，垂直居中对齐 */
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <span
            style={{
              fontSize: 11.5, /* R2：子动作文案比 Agent 昵称（12px/600）更小更细 */
              fontWeight: 500,
              lineHeight: '18px', /* R2：与图标等高居中 */
              color: step.status === 'failed'
                ? 'var(--agent-danger)'
                : t.textMuted, /* R2：比 Agent 昵称浅，深色模式偏灰 */
            }}
          >
            {step.name}
          </span>
          {step.tool && (
            <span
              style={{
                fontSize: 10,
                fontFamily: 'SF Mono, Consolas, monospace',
                color: t.textMuted,
                background: 'var(--agent-surface-2)',
                padding: '2px 8px',
                borderRadius: 5,
                opacity: 0.85,
              }}
            >
              {step.tool}
            </span>
          )}
          {step.dur !== undefined && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--agent-muted)',
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

        {/* 展开详情（grid 必须定列宽 1fr，否则隐式列按内容收缩成小块留白） */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gridTemplateRows: expanded ? '1fr' : '0fr',
            transition: 'grid-template-rows 0.28s ease',
          }}
        >
          <div style={{ overflow: 'hidden', width: '100%' }}>
            {hasInput && (
              <div style={detailBoxStyle}>
                <div style={detailLabelStyle}>Input</div>
                <pre style={detailPreStyle}>{step.input}</pre>
              </div>
            )}
            {step.result && (
              <div style={{ ...detailBoxStyle, marginTop: 8 }}>
                <div style={detailLabelStyle}>Result</div>
                <pre style={{ ...detailPreStyle, color: '#4ade80' }}>{step.result}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const detailBoxStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--agent-surface)',
  border: 'none', /* R2：投影风格，无边线 */
  boxShadow: 'var(--agent-shadow)',
  borderRadius: 9,
  padding: '10px 12px',
};

const detailLabelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: 'var(--agent-muted)',
  marginBottom: 5,
};

const detailPreStyle: CSSProperties = {
  fontFamily: 'SF Mono, Consolas, monospace',
  fontSize: 11.5,
  color: 'var(--agent-muted)',
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: 0,
};