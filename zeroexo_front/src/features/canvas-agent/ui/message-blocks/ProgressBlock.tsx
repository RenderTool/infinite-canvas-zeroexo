/**
 * ProgressBlock - 任务进度块
 *
 * 参考 tvc-agent (2).html 设计，100% 复刻样式：
 * - 进度条（渐变填充）
 * - 阶段文案 + 百分比
 * - 步骤时间线
 * - 取消按钮
 */

import { CheckCircle, XCircle, Loader, Clock } from 'lucide-react';
import { stopGenerating } from '../session/agent-session.js';
import type { CanvasAgentMessage, ProgressStep } from '../types.js';

const STATUS_ICONS: Record<string, React.ReactElement> = {
  queued: <Clock size={12} />,
  running: <Loader size={12} className="agent-spin" />,
  completed: <CheckCircle size={12} color="#4ade80" />,
  failed: <XCircle size={12} color="#f87171" />,
};

export function ProgressBlock(props: { message: CanvasAgentMessage }): React.ReactElement {
  const { message } = props;
  const progress = message.progress!;

  const hasFailed = progress.steps.some((s) => s.status === 'failed');
  const allDone = progress.steps.every((s) => s.status === 'completed');

  return (
    <div
      style={{
        width: '100%',
        margin: '6px 0',
        background: '#0d1220',
        border: '1px solid #1e293b',
        borderRadius: 10,
        overflow: 'hidden',
        animation: 'agentFadeUp 0.35s ease',
      }}
    >
      {/* 整体进度 */}
      <div style={{ padding: '12px 14px 8px' }}>
        {/* 进度条 */}
        <div className="agent-progress-track">
          <div
            className="agent-progress-fill"
            style={{
              width: `${progress.totalProgress}%`,
              background: hasFailed
                ? '#f87171'
                : allDone
                  ? '#4ade80'
                  : 'linear-gradient(90deg, #6366f1, #a855f7)',
            }}
          />
        </div>

        {/* 阶段文案 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 6,
          }}
        >
          <span style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 500 }}>
            {allDone
              ? '全部完成'
              : hasFailed
                ? '部分失败'
                : progress.currentStep
                  ? progress.currentStep
                  : '准备中…'}
          </span>
          <span style={{ fontSize: 11, color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
            {progress.totalProgress}%
          </span>
        </div>
      </div>

      {/* 步骤时间线 */}
      <div style={{ padding: '6px 0' }}>
        {progress.steps.map((step, i) => (
          <ProgressStepRow
            key={step.key}
            step={step}
            isLast={i === progress.steps.length - 1}
          />
        ))}
      </div>

      {/* 底部：取消按钮 */}
      {!allDone && !hasFailed && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '4px 14px 8px',
          }}
        >
          <button
            type="button"
            onClick={() => stopGenerating()}
            style={{
              padding: '4px 12px',
              borderRadius: 7,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
              background: 'transparent',
              border: '1.5px solid #334155',
              color: '#94a3b8',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#dc2626';
              e.currentTarget.style.color = '#dc2626';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#334155';
              e.currentTarget.style.color = '#94a3b8';
            }}
          >
            停止
          </button>
        </div>
      )}
    </div>
  );
}

interface ProgressStepRowProps {
  step: ProgressStep;
  isLast: boolean;
}

function ProgressStepRow({ step }: ProgressStepRowProps): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 14px',
        opacity: step.status === 'queued' ? 0.5 : 1,
      }}
    >
      <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        {STATUS_ICONS[step.status] ?? <Clock size={12} />}
      </span>
      <span style={{ flex: 1, fontSize: 12, color: '#cbd5e1' }}>
        {step.label}
      </span>
      {step.status === 'running' && step.progress !== undefined && (
        <span style={{ fontSize: 11, color: '#a5b4fc', fontVariantNumeric: 'tabular-nums' }}>
          {step.progress}%
        </span>
      )}
      {step.status === 'completed' && (
        <span style={{ fontSize: 10, color: '#4ade80' }}>✓</span>
      )}
      {step.status === 'failed' && (
        <span style={{ fontSize: 10, color: '#f87171' }}>✗</span>
      )}
    </div>
  );
}