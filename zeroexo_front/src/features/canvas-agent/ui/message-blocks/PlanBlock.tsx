/**
 * PlanBlock - 执行计划卡（Plan#36 R2-5 重做：消费 plan_present 协议）
 *
 * - 目标 + 步骤逐条入场动画（stagger fade-up）+ 每步预期产物/风险标注
 * - 底部「确认执行 / 我要修改」：回执走 plan_present 阻塞通道，提交后锁定只读
 * - 兼容旧形态（message.plan 成本/风险结构）降级为简单列表，不再走旧回执语义
 */

import { useState } from 'react';
import { ClipboardList, AlertTriangle } from 'lucide-react';
import { sendAnswer } from '../session/agent-session.js';
import { useCanvasAgentStore } from '../store.js';
import type { CanvasAgentMessage } from '../types.js';
import { PhaseTimeline, derivePhases } from '../think-stream/PhaseTimeline.js';

export function PlanBlock(props: { message: CanvasAgentMessage }): React.ReactElement {
  const { message } = props;
  const planCard = message.planCard;
  const updateMessage = useCanvasAgentStore((s) => s.updateMessage);
  // Plan#43 B2：确认后接入 Phase 待办打勾流（状态由 todo_write 快照推进）
  const todoSnapshot = useCanvasAgentStore((s) => s.todoSnapshot);
  const [modifying, setModifying] = useState(false);
  const [modifyText, setModifyText] = useState('');

  // 旧形态（模拟器/历史数据）：降级渲染
  if (!planCard) {
    const legacy = message.plan;
    if (!legacy) return <></>;
    return (
      <div className="agent-plan-legacy" style={{ width: '100%', margin: '6px 0', padding: 12, background: 'var(--agent-surface)', border: '1px solid var(--agent-border)', borderRadius: 10 }}>
        {legacy.steps.map((s, i) => (
          <div key={i} style={{ fontSize: 12.5, color: 'var(--agent-text)', padding: '3px 0' }}>{s.label}</div>
        ))}
      </div>
    );
  }

  const locked = planCard.status === 'confirmed' || planCard.status === 'modified' || !!message.answered;

  const handleConfirm = () => {
    if (locked) return;
    updateMessage(message.id, { planCard: { ...planCard, status: 'confirmed' } });
    void sendAnswer('确认执行');
  };

  const handleModify = () => {
    if (locked) return;
    if (!modifying) {
      setModifying(true);
      return;
    }
    const text = modifyText.trim();
    if (!text) return;
    updateMessage(message.id, { planCard: { ...planCard, status: 'modified' } });
    void sendAnswer(`修改意见: ${text}`);
  };

  return (
    <div
      style={{
        width: '100%',
        margin: '6px 0',
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid var(--agent-border)',
        background: 'var(--agent-panel)',
        animation: 'agentFadeUp 0.35s ease',
      }}
    >
      {/* 头部：目标 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          padding: '10px 14px',
          background: 'var(--agent-surface-2)',
          borderBottom: '1px solid var(--agent-border)',
        }}
      >
        <ClipboardList size={14} color="var(--agent-accent)" style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--agent-muted)', marginBottom: 2 }}>
            执行计划
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--agent-text)', lineHeight: 1.5 }}>
            {planCard.goal}
          </div>
        </div>
        {locked && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 5,
              background: 'var(--agent-accent-soft)',
              color: 'var(--agent-accent)',
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {planCard.status === 'confirmed' ? '已确认' : '已反馈修改'}
          </span>
        )}
      </div>

      {/* 步骤列表（stagger 入场） */}
      <div style={{ padding: '8px 0' }}>
        {planCard.steps.map((step, i) => (
          <div
            key={step.id || i}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '6px 14px',
              animation: 'agentPlanStepIn 0.3s ease both',
              animationDelay: `${i * 70}ms`,
            }}
          >
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: 'var(--agent-accent-soft)',
                color: 'var(--agent-accent)',
                fontSize: 11,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              {i + 1}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--agent-text)', lineHeight: 1.5 }}>
                {step.label}
              </div>
              {step.deliverable && (
                <div style={{ fontSize: 11, color: 'var(--agent-muted)', marginTop: 2 }}>
                  产物：{step.deliverable}
                </div>
              )}
              {step.risk && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#fbbf24', marginTop: 2 }}>
                  <AlertTriangle size={10} />
                  {step.risk}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 全局风险提示 */}
      {planCard.risks && planCard.risks.length > 0 && (
        <div style={{ padding: '0 14px 8px' }}>
          {planCard.risks.map((r, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
                padding: '6px 10px',
                margin: '3px 0',
                background: 'rgba(251,191,36,0.08)',
                border: '1px solid rgba(251,191,36,0.3)',
                borderRadius: 8,
                fontSize: 11.5,
                color: '#fbbf24',
                lineHeight: 1.5,
              }}
            >
              <AlertTriangle size={11} style={{ marginTop: 2, flexShrink: 0 }} />
              <span>{r}</span>
            </div>
          ))}
        </div>
      )}

      {/* 修改输入 */}
      {modifying && !locked && (
        <div style={{ display: 'flex', gap: 6, padding: '0 14px 8px' }}>
          <input
            type="text"
            value={modifyText}
            onChange={(e) => setModifyText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleModify(); }}
            placeholder="说说要怎么改…"
            className="agent-form-input"
            style={{
              flex: 1,
              padding: '7px 11px',
              borderRadius: 7,
              background: 'var(--agent-surface)',
              border: '1.5px solid var(--agent-border)',
              color: 'var(--agent-text)',
              fontSize: 12.5,
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            autoFocus
          />
        </div>
      )}

      {/* 底部操作 */}
      {!locked && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '8px 14px',
            borderTop: '1px solid var(--agent-border)',
          }}
        >
          <button
            type="button"
            onClick={handleConfirm}
            className="agent-btn-primary"
            style={{
              padding: '6px 16px',
              border: 'none',
              borderRadius: 7,
              background: 'var(--agent-accent)',
              color: '#fff',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            确认执行
          </button>
          <button
            type="button"
            onClick={handleModify}
            className="agent-btn-secondary"
            style={{
              padding: '6px 16px',
              border: '1.5px solid var(--agent-border)',
              borderRadius: 7,
              background: 'transparent',
              color: 'var(--agent-muted)',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            {modifying ? '提交修改意见' : '我要修改'}
          </button>
        </div>
      )}

      {/* Plan#43 B2：计划确认后接入 Phase 待办打勾流（圆圈待办/旋转/打勾折叠推进） */}
      {locked && planCard.steps.length > 0 && (
        <PhaseTimeline plan={planCard} phases={derivePhases(planCard, todoSnapshot)} />
      )}
    </div>
  );
}
