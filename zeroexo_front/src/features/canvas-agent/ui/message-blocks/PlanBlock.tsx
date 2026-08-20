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
import { getSimulationResume } from '../store.js';
import { stopGenerating } from '../session/agent-session.js';
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
    getSimulationResume()?.([]);
  };

  const handlePlanOnly = () => {
    getSimulationResume()?.([]);
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
        border: `1px solid ${isHighRisk ? '#6366f1' : '#1e293b'}`,
        boxShadow: isHighRisk ? '0 0 0 1px rgba(99,102,241,0.2)' : 'none',
        background: 'rgba(15,20,35,0.6)',
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
          background: isHighRisk ? 'rgba(233,69,96,0.08)' : 'rgba(99,102,241,0.03)',
          borderBottom: '1px solid #1e293b',
        }}
      >
        {isHighRisk ? (
          <AlertTriangle size={14} color="#6366f1" />
        ) : (
          <FileText size={14} color="#64748b" />
        )}
        <span style={{ fontSize: 13, fontWeight: 600, color: '#cbd5e1' }}>
          执行计划
        </span>
        {isHighRisk && (
          <span
            style={{
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 5,
              background: '#6366f1',
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
          borderTop: '1px solid #1e293b',
          background: 'rgba(0,0,0,0.15)',
        }}
      >
        <span style={{ fontSize: 11, color: '#64748b' }}>
          已选 <strong style={{ color: '#cbd5e1' }}>{selected.size}</strong>/{plan.steps.length} 步
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#64748b' }}>
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
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
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
            border: '1.5px solid #334155',
            borderRadius: 7,
            background: 'transparent',
            color: '#94a3b8',
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
            border: '1.5px solid #334155',
            borderRadius: 7,
            background: 'transparent',
            color: '#94a3b8',
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
  high: '#f87171',
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
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(99,102,241,0.03)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {/* 勾选框 */}
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 4,
          border: `2px solid ${checked ? '#6366f1' : '#334155'}`,
          background: checked ? '#6366f1' : 'transparent',
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
        <div style={{ fontSize: 12.5, fontWeight: 500, color: '#cbd5e1' }}>
          {step.label}
        </div>
        {step.affectedNodes.length > 0 && (
          <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 2 }}>
            影响 {step.affectedNodes.length} 个节点
          </div>
        )}
      </div>

      {/* 估价 */}
      <span style={{ fontSize: 11, color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
        {step.estimatedCost}
      </span>

      {/* 风险点 */}
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: RISK_COLORS[step.riskLevel] ?? '#64748b',
          flexShrink: 0,
        }}
      />
    </div>
  );
}

