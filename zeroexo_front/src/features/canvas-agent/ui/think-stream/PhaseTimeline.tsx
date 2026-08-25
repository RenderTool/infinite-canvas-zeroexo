/**
 * PhaseTimeline - 计划 Phase 待办流（Plan#43 B2）
 *
 * 行为对齐 AIAgentStepsTimeline（忽略其卡片风格，只要行为模式）：
 * - 每个 Phase = 圆圈待办：未开始=空圈、运行中=旋转圈、完成=勾
 * - 完成的 Phase 自动折叠（收成一行），自动展开下一个
 * - 全部完成后整个计划折叠成摘要行（用户可随时展开回看做了什么）
 * - 竖线轨道连接各 Phase，运行中 Phase 内部可挂步骤明细
 *
 * 数据源：plan_present 的 steps（Phase 清单）+ todo_write 快照（状态推进）。
 */

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import type { AgentPlanData, TodoSnapshot, ThinkingStep } from '../types.js';
import { StepCapsuleList } from './StepCapsule.js';

export type PhaseStatus = 'pending' | 'running' | 'done';

export interface PhaseState {
  id: string;
  label: string;
  status: PhaseStatus;
  /** 运行中 Phase 的内部步骤（工具调用树） */
  steps?: ThinkingStep[];
}

export interface PhaseTimelineProps {
  plan: AgentPlanData;
  phases: PhaseState[];
}

/** todo 快照 → Phase 状态映射（按顺序对齐：todo item i ↔ plan.steps[i]） */
export function derivePhases(plan: AgentPlanData, todo: TodoSnapshot | null): PhaseState[] {
  const items = todo?.items ?? [];
  return plan.steps.map((step, i) => {
    const item = items[i];
    let status: PhaseStatus = 'pending';
    if (item) {
      if (item.status === 'completed' || item.status === 'failed') status = 'done';
      else if (item.status === 'running') status = 'running';
    }
    // 无 todo 对齐时：首个未完成视为运行中
    if (!item && i === plan.steps.findIndex((_, j) => {
      const it = items[j];
      return !it || (it.status !== 'completed' && it.status !== 'failed');
    })) {
      status = 'running';
    }
    return { id: step.id, label: step.label, status };
  });
}

function PhaseIcon({ status }: { status: PhaseStatus }): React.ReactElement {
  if (status === 'done') {
    return (
      <span style={{ ...iconBase, background: '#4ade80', borderColor: '#4ade80' }}>
        <Check size={10} strokeWidth={3.5} color="#fff" />
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="agent-step-spin" style={{ ...iconBase, borderColor: 'var(--agent-accent)', color: 'var(--agent-accent)' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M21 12a9 9 0 1 1-6.2-8.56" />
        </svg>
      </span>
    );
  }
  return <span style={{ ...iconBase, borderColor: 'var(--agent-border)', background: 'transparent' }} />;
}

const iconBase: React.CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: '50%',
  border: '1.5px solid',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  position: 'relative',
  zIndex: 1,
  transition: 'all 0.25s',
};

export function PhaseTimeline({ plan, phases }: PhaseTimelineProps): React.ReactElement {
  const doneCount = phases.filter((p) => p.status === 'done').length;
  const allDone = doneCount === phases.length && phases.length > 0;
  // 全部完成 → 默认折叠整个计划；进行中默认展开
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (allDone) setCollapsed(true);
  }, [allDone]);

  // 运行中 Phase 自动展开（其余折叠）
  const runningId = useMemo(() => phases.find((p) => p.status === 'running')?.id ?? null, [phases]);
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});

  return (
    <div
      style={{
        width: '100%',
        margin: '6px 0',
        padding: '10px 12px',
        background: 'var(--agent-surface)',
        boxShadow: 'var(--agent-shadow)',
        borderRadius: 10,
        animation: 'agentFadeUp 0.35s ease',
      }}
    >
      {/* 计划头：目标 + 进度 + 折叠箭头 */}
      <div
        onClick={() => setCollapsed((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--agent-text)', flex: 1, minWidth: 0 }}>
          {allDone ? '计划已完成' : plan.goal}
        </span>
        <span style={{ fontSize: 11, color: 'var(--agent-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          {doneCount}/{phases.length}
        </span>
        <ChevronRight
          size={13}
          style={{
            color: 'var(--agent-muted)',
            transition: 'transform 0.2s',
            transform: collapsed ? 'none' : 'rotate(90deg)',
            flexShrink: 0,
          }}
        />
      </div>

      {/* Phase 列表（折叠时收起；完成态也可展开回看） */}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: collapsed ? '0fr' : '1fr',
          transition: 'grid-template-rows 0.28s ease',
        }}
      >
        <div style={{ overflow: 'hidden' }}>
          <div style={{ paddingTop: 8 }}>
            {phases.map((phase, i) => {
              const isLast = i === phases.length - 1;
              const open = manualOpen[phase.id] ?? (phase.id === runningId && !allDone);
              return (
                <div key={phase.id} style={{ display: 'flex', gap: 10, position: 'relative' }}>
                  {/* 竖线轨道 */}
                  {!isLast && (
                    <div
                      style={{
                        position: 'absolute',
                        left: 8,
                        top: 20,
                        bottom: -2,
                        width: 2,
                        background: phase.status === 'done' ? '#4ade80' : 'var(--agent-border)',
                        borderRadius: 1,
                        transition: 'background 0.25s',
                      }}
                    />
                  )}
                  <PhaseIcon status={phase.status} />
                  <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : 8 }}>
                    {/* Phase 行（点击展开内部步骤） */}
                    <div
                      onClick={() => setManualOpen((prev) => ({ ...prev, [phase.id]: !open }))}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        minHeight: 18,
                        cursor: 'pointer',
                        userSelect: 'none',
                        opacity: phase.status === 'pending' ? 0.55 : 1,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: phase.status === 'running' ? 600 : 500,
                          lineHeight: '18px',
                          color: phase.status === 'done' ? 'var(--agent-muted)' : 'var(--agent-text)',
                          textDecoration: phase.status === 'done' ? 'none' : 'none',
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        {phase.label}
                      </span>
                      {phase.steps && phase.steps.length > 0 && (
                        <ChevronRight
                          size={11}
                          style={{
                            color: 'var(--agent-muted)',
                            transition: 'transform 0.2s',
                            transform: open ? 'rotate(90deg)' : 'none',
                            flexShrink: 0,
                          }}
                        />
                      )}
                    </div>
                    {/* 内部步骤（运行中自动展开；完成后折叠可点开回看） */}
                    {phase.steps && phase.steps.length > 0 && (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateRows: open ? '1fr' : '0fr',
                          transition: 'grid-template-rows 0.25s ease',
                        }}
                      >
                        <div style={{ overflow: 'hidden' }}>
                          <div style={{ paddingTop: 4 }}>
                            <StepCapsuleList steps={phase.steps} />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
