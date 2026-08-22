/**
 * PlanBlock - 执行计划卡
 *
 * 参考 tvc-agent (2).html 设计，100% 复刻样式：
 * - 步骤列表（skill 名 / 影响节点 / 估价 / 风险色点）
 * - 支持勾选部分步骤
 * - 底部三个按钮
 * - 高风险确认卡带红色边
 */

import { useState, useMemo } from 'react';
import { AlertTriangle, DollarSign, FileText } from 'lucide-react';
import { stopGenerating, sendAnswer } from '../session/agent-session.js';
import type { CanvasAgentMessage, PlanStep } from '../types.js';

export function PlanBlock(props: { message: CanvasAgentMessage }): React.ReactElement {
  const { message } = props;
  const plan = message.plan!;
  const [selected, setSelected] = useState<Set<number>>(
    new Set(plan.steps.map((_, i) => i)),
  );
  const [executing, setExecuting] = useState(false);

  const isHighRisk = plan.riskLevel === 'high' || plan.hasHighRiskOps;

  const toggleStep = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleExecute = () => {
    setExecuting(true);
    // 真连层(Plan#33 D2 修复断链): 提交选中步骤回执
    const stepKeys = plan.steps.filter((_, i) => selected.has(i)).map((s) => s.skillName ?? s.label);
    void sendAnswer(`执行:${JSON.stringify(stepKeys)}`);
  };

  const handlePlanOnly = () => {
    void sendAnswer('仅规划');
  };

  const handleCancel = () => {
    stopGenerating();
  };

  const selectedCost = useMemo(
    () => plan.steps.filter((_, i) => selected.has(i)).reduce((sum, s) => sum + s.estimatedCost, 0),
    [plan.steps, selected],
  );

  return (
    <div
      style={{
        width: '100%',
        margin: '6px 0',
        borderRadius: 12,
        overflow: 'hidden',
        border: `1px solid ${isHighRisk ? 'var(--agent-accent)' : 'var(--agent-border)'}`,
        boxShadow: isHighRisk ? '0 0 0 1px var(--agent-accent-soft)' : 'none',
        background: 'var(--agent-panel)',
        animation: 'agentFadeUp 0.35s ease',
      }}
    >
      {/* 头部 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          background: isHighRisk ? 'var(--agent-accent-soft)' : 'var(--agent-surface-2)',
          borderBottom: '1px solid var(--agent-border)',
        }}
      >
        {isHighRisk ? (
          <AlertTriangle size={14} color="var(--agent-accent)" />
        ) : (
          <FileText size={14} color="var(--agent-muted)" />
        )}
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--agent-text)' }}>
          执行计划
        </span>
        {isHighRisk && (
          <span
            style={{
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 5,
              background: 'var(--agent-accent)',
              color: '#fff',
              fontWeight: 700,
              marginLeft: 'auto',
            }}
          >
            高风险
          </span>
        )}
      </div>

      {/* 步骤列表 */}
      <div style={{ padding: '6px 0' }}>
        {plan.steps.map((step, i) => (
          <PlanStepRow
            key={i}
            step={step}
            index={i}
            checked={selected.has(i)}
            onToggle={() => toggleStep(i)}
          />
        ))}
      </div>

      {/* 消耗汇总 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          borderTop: '1px solid var(--agent-border)',
          background: 'var(--agent-surface)',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--agent-muted)' }}>
          已选 <strong style={{ color: 'var(--agent-text)' }}>{selected.size}</strong>/{plan.steps.length} 步
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--agent-muted)' }}>
          <DollarSign size={10} />
          估价 <strong style={{ color: '#4ade80' }}>{selectedCost}</strong> 积分
        </span>
      </div>

      {/* 操作按钮 */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '8px 14px',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={handleExecute}
          disabled={executing}
          className="agent-btn-primary"
          style={{
            padding: '6px 14px',
            border: 'none',
            borderRadius: 7,
            background: 'var(--agent-accent)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 700,
            fontFamily: 'inherit',
            cursor: executing ? 'default' : 'pointer',
            opacity: executing ? 0.6 : 1,
          }}
        >
          {executing ? '执行中…' : '执行'}
        </button>
        <button
          type="button"
          onClick={handlePlanOnly}
          className="agent-btn-secondary"
          style={{
            padding: '6px 14px',
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
          仅规划
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="agent-btn-secondary"
          style={{
            padding: '6px 14px',
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
          取消
        </button>
      </div>
    </div>
  );
}

interface PlanStepRowProps {
  step: PlanStep;
  index: number;
  checked: boolean;
  onToggle: () => void;
}

const RISK_COLORS: Record<string, string> = {
  low: '#4ade80',
  medium: '#fbbf24',
  high: 'var(--agent-danger)',
};

function PlanStepRow({ step, checked, onToggle }: PlanStepRowProps): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 14px',
        cursor: 'pointer',
        transition: 'background 0.1s',
      }}
      onClick={onToggle}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--agent-surface-2)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {/* 勾选框 */}
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 4,
          border: `2px solid ${checked ? 'var(--agent-accent)' : 'var(--agent-border)'}`,
          background: checked ? 'var(--agent-accent)' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'all 0.15s',
        }}
      >
        {checked && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        )}
      </span>

      {/* 步骤信息 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--agent-text)' }}>
          {step.label}
        </div>
        {step.affectedNodes.length > 0 && (
          <div style={{ fontSize: 10.5, color: 'var(--agent-muted)', marginTop: 2 }}>
            影响 {step.affectedNodes.length} 个节点
          </div>
        )}
      </div>

      {/* 估价 */}
      <span style={{ fontSize: 11, color: 'var(--agent-muted)', fontVariantNumeric: 'tabular-nums' }}>
        {step.estimatedCost}
      </span>

      {/* 风险点 */}
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: RISK_COLORS[step.riskLevel] ?? 'var(--agent-muted)',
          flexShrink: 0,
        }}
      />
    </div>
  );
}

