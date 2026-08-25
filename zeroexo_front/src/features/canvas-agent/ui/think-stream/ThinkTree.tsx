/**
 * ThinkTree - 回合思考树（Plan#43 B1）
 *
 * 形态：大脑图标 + 垂直线轨道 + 可折叠内容（思考文本 + 步骤 treelist）。
 * 用户诉求：结论前不展示长篇推理——默认折叠，展开才见过程；
 * 读取画布状态等工具步骤全部收进树内（StepCapsuleList 复用）。
 *
 * 两种用法：
 * 1. 实时态（ThinkTreeLive）：订阅 store.thinking，渲染在消息流尾部（替代底部常驻 ThinkStream）
 * 2. 完成态（props 驱动）：历史轨迹消息只读渲染，默认折叠可随时展开回看
 */

import { useEffect, useState } from 'react';
import { Brain, ChevronRight } from 'lucide-react';
import type { ThinkingStep } from '../types.js';
import { useCanvasAgentStore } from '../store.js';
import { StepCapsuleList } from './StepCapsule.js';

export interface ThinkTreeProps {
  steps: ThinkingStep[];
  thinkingText?: string;
  /** 实时态：显示动态状态文案与计时 */
  active?: boolean;
  /** 计时基准（任务开始时间戳） */
  startedAt?: number;
  /** 状态文案覆盖（如「分析中…」「正在执行计划」） */
  statusText?: string;
  defaultCollapsed?: boolean;
}

/** 已完成思考树的状态行文案 */
function doneStatusText(steps: ThinkingStep[], elapsedMs: number | null): string {
  const n = steps.length;
  const dur = elapsedMs != null ? ` · ${(elapsedMs / 1000).toFixed(1)}s` : '';
  return n > 0 ? `完成 ${n} 步思考与操作${dur}` : `思考完成${dur}`;
}

export function ThinkTree(props: ThinkTreeProps): React.ReactElement | null {
  const { steps, thinkingText, active = false, startedAt, statusText, defaultCollapsed = true } = props;
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [nowTs, setNowTs] = useState(() => Date.now());

  // 实时态计时（200ms 刷新；结束定格）
  useEffect(() => {
    if (!active) {
      if (startedAt) setNowTs(Date.now());
      return;
    }
    setNowTs(Date.now());
    const t = setInterval(() => setNowTs(Date.now()), 200);
    return () => clearInterval(t);
  }, [active, startedAt]);

  // 新一轮开始时自动折叠（用户不想看长篇推理，过程收进树内）
  useEffect(() => {
    if (active) setCollapsed(defaultCollapsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt]);

  const hasText = !!thinkingText && thinkingText.trim().length > 0;
  if (!active && steps.length === 0 && !hasText) return null;

  const elapsed = startedAt ? Math.max(0, nowTs - startedAt) : null;
  const headerLabel = active
    ? statusText || '思考中…'
    : doneStatusText(steps, elapsed);

  return (
    <div style={{ width: '100%', padding: '2px 0' }}>
      {/* 头部行：大脑图标 + 状态文案 + 耗时 + 折叠箭头 */}
      <div
        onClick={() => setCollapsed((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          cursor: 'pointer',
          userSelect: 'none',
          padding: '3px 0',
        }}
      >
        <span
          className={active ? 'agent-step-spin' : undefined}
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            border: '1px solid var(--agent-border)',
            background: 'var(--agent-surface)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: active ? 'var(--agent-accent)' : 'var(--agent-muted)',
            flexShrink: 0,
          }}
        >
          <Brain size={11} />
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--agent-muted)' }}>
          {headerLabel}
          {active && <span className="agent-think-dots" />}
        </span>
        {active && elapsed != null && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              color: 'var(--agent-muted)',
              fontVariantNumeric: 'tabular-nums',
              opacity: 0.8,
            }}
          >
            {(elapsed / 1000).toFixed(1)}s
          </span>
        )}
        <ChevronRight
          size={12}
          style={{
            color: 'var(--agent-muted)',
            transition: 'transform 0.2s',
            transform: collapsed ? 'none' : 'rotate(90deg)',
            flexShrink: 0,
            ...(active && elapsed != null ? {} : { marginLeft: 'auto' }),
          }}
        />
      </div>

      {/* 展开内容：思考文本 + 步骤树（垂直线轨道内） */}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: collapsed ? '0fr' : '1fr',
          transition: 'grid-template-rows 0.25s ease',
        }}
      >
        <div style={{ overflow: 'hidden' }}>
          <div
            style={{
              marginLeft: 9,
              borderLeft: '2px solid var(--agent-border)',
              paddingLeft: 12,
              margin: '4px 0 4px 9px',
            }}
          >
            {hasText && (
              <div
                style={{
                  fontSize: 12,
                  lineHeight: 1.7,
                  color: 'var(--agent-muted)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  padding: '2px 0 6px',
                }}
              >
                {thinkingText}
              </div>
            )}
            {steps.length > 0 && <StepCapsuleList steps={steps} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 实时思考树：订阅 store.thinking，渲染在消息流尾部（进行中才显示） */
export function ThinkTreeLive(): React.ReactElement | null {
  const thinking = useCanvasAgentStore((s) => s.thinking);
  const phaseLabel = useCanvasAgentStore((s) => s.phaseLabel);
  if (!thinking.active) return null;
  return (
    <ThinkTree
      steps={thinking.steps}
      thinkingText={thinking.text}
      active
      startedAt={thinking.startedAt}
      statusText={phaseLabel || undefined}
      defaultCollapsed
    />
  );
}
