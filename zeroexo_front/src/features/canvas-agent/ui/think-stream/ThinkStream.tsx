/**
 * ThinkStream - Codex 式执行 trace（Plan#36 R2 返工）
 *
 * 收敛为对话流内单一紧凑 trace 块（不再渲染 .msg 角色行/边框盒子）：
 * - 状态行：脉冲圆点（活跃）/ 完成勾 + phase 语义文案 + 已耗时（基准=任务开始时刻）
 * - 思考：弱样式可折叠行（仅承载模型推理增量，点击回看）
 * - 步骤：StepCapsuleList（图标/语义名/弱化工具 chip/耗时/展开 Input-Result）
 * 时间线已收敛于此（TimelineBlock 消息不再产出，杜绝双展示）。
 */

import { useState, useEffect } from 'react';
import { ChevronRight, Check, Brain } from 'lucide-react';
import { useCanvasAgentStore } from '../store.js';
import { TypingText } from './TypingText.js';
import { StepCapsuleList } from './StepCapsule.js';
import { PHASE_STATUS_TEXT } from './tool-semantics.js';

export function ThinkStream(): React.ReactElement {
  const thinking = useCanvasAgentStore((s) => s.thinking);
  const setThinking = useCanvasAgentStore((s) => s.setThinking);
  const phase = useCanvasAgentStore((s) => s.phase);
  const phaseLabel = useCanvasAgentStore((s) => s.phaseLabel);

  const [collapsed, setCollapsed] = useState(true);
  // 动效省略号：活跃时每 400ms 推进 1→2→3，静态省略号无生命感会让用户以为卡死（2026-08-25）
  const [dots, setDots] = useState(1);
  useEffect(() => {
    if (!thinking.active) return;
    setDots(1);
    const t = setInterval(() => setDots((d) => (d % 3) + 1), 400);
    return () => clearInterval(t);
  }, [thinking.active]);
  // R2 返工：计时基准 = 任务开始时间（store 记录），不再用组件挂载时刻（会累计面板打开时长）
  const baseTs = thinking.startedAt ?? Date.now();
  const [nowTs, setNowTs] = useState(() => Date.now());

  // 活跃时每 200ms 刷新；结束瞬间定格最终耗时
  useEffect(() => {
    if (!thinking.active) {
      if (thinking.startedAt) setNowTs(Date.now());
      return;
    }
    setNowTs(Date.now());
    const timer = setInterval(() => setNowTs(Date.now()), 200);
    return () => clearInterval(timer);
  }, [thinking.active, thinking.startedAt]);

  // 开始新一轮时展开思考（如有）
  useEffect(() => {
    if (thinking.active) setCollapsed(false);
  }, [thinking.active]);

  if (!thinking.active && !thinking.text && thinking.steps.length === 0) return <></>;

  const elapsed = Math.max(0, nowTs - baseTs);
  const elapsedText = `${(elapsed / 1000).toFixed(1)}s`;
  const hasThinking = thinking.text.length > 0;
  // 空窗期保活（2026-08-25）：无任何增量/步骤时，8s 后轮播等待文案，让用户确信 Agent 活着；
  // 一旦有真实增量（思考流/步骤）立即让位给真实状态（statusText 接管）
  const IDLE_HINTS = ['模型正在组织语言，稍等一下', '正在思考下一步', '仍在处理中，马上就好'];
  const hintIdx = Math.floor(Math.max(0, elapsed - 8000) / 4000) % IDLE_HINTS.length;
  const showIdleHint = thinking.active && !hasThinking && thinking.steps.length === 0 && elapsed > 8000;
  const statusText = showIdleHint
    ? IDLE_HINTS[hintIdx]!
    : phaseLabel || (phase ? PHASE_STATUS_TEXT[phase] : 'Agent 工作中…');
  const dotStr = thinking.active ? '.'.repeat(dots) : '';

  return (
    <div style={{ width: '100%', maxWidth: '100%' }}>
      {/* 状态行（紧凑，弱色） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '2px 0 4px' }}>
        {thinking.active ? (
          <span
            className="agent-pulse-dot"
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--agent-accent)',
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
        ) : (
          <Check size={12} color="#4ade80" strokeWidth={3} style={{ flexShrink: 0 }} />
        )}
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--agent-muted)' }}>
          {thinking.active
            ? `${statusText}${dotStr}`
            : `已完成 ${thinking.steps.length} 步 · ${elapsedText}`}
        </span>
        {thinking.active && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              color: 'var(--agent-muted)',
              fontVariantNumeric: 'tabular-nums',
              opacity: 0.8,
            }}
          >
            {elapsedText}
          </span>
        )}
      </div>

      {/* 思考折叠卡（大脑图标 + 左侧竖线，对齐 Codex 参考） */}
      {hasThinking && (
        <div style={{ padding: '0 0 2px' }}>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              border: 'none',
              background: 'transparent',
              padding: 0,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--agent-muted)',
            }}
          >
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                border: '1px solid var(--agent-border)',
                background: 'var(--agent-surface)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--agent-accent)',
                flexShrink: 0,
              }}
            >
              <Brain size={11} />
            </span>
            思考过程{collapsed ? '' : `（${thinking.text.length} 字）`}
            <ChevronRight
              size={11}
              style={{
                transition: 'transform 0.2s',
                transform: collapsed ? 'none' : 'rotate(90deg)',
              }}
            />
          </button>
          {!collapsed && (
            <div
              style={{
                margin: '6px 0 2px 9px',
                padding: '8px 12px',
                borderLeft: '2px solid var(--agent-border)',
                color: 'var(--agent-muted)',
                fontSize: 12.5,
                lineHeight: 1.7,
              }}
            >
              <TypingText
                text={thinking.text}
                streaming={thinking.active}
                onStop={() => {
                  setThinking({ active: false });
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* 执行步骤（AIAgentStepsTimeline 形态） */}
      <StepCapsuleList steps={thinking.steps} />
    </div>
  );
}
