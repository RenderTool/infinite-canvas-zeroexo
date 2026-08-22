/**
 * TimelineBlock - 工具调用时间线（Plan#36 P0-4）
 *
 * 在消息流内渲染 Agent 的工具调用序列（步骤 + 状态 + 画布操作），
 * 与顶部瞬时 ThinkStream 互补：时间线是对话内可回溯的持久记录。
 */

import { Check, MousePointerClick, Wrench, X } from 'lucide-react';
import type { CanvasAgentMessage, TimelineStep } from '../types.js';

const NODE_SIZE = 18;
const LINE_WIDTH = 2;

function nodeIcon(step: TimelineStep): React.ReactElement {
  if (step.status === 'done') {
    return (
      <span
        style={{
          width: NODE_SIZE,
          height: NODE_SIZE,
          borderRadius: '50%',
          background: '#10b981',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Check size={10} strokeWidth={3} color="#fff" />
      </span>
    );
  }
  if (step.status === 'failed') {
    return (
      <span
        style={{
          width: NODE_SIZE,
          height: NODE_SIZE,
          borderRadius: '50%',
          background: 'var(--agent-danger)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <X size={10} strokeWidth={3} color="#fff" />
      </span>
    );
  }
  // running: 旋转环
  return (
    <span
      style={{
        width: NODE_SIZE,
        height: NODE_SIZE,
        borderRadius: '50%',
        border: '2px solid var(--agent-accent-soft)',
        borderTopColor: 'var(--agent-accent)',
        flexShrink: 0,
        animation: 'spin 0.9s linear infinite',
      }}
    />
  );
}

export function TimelineBlock({ message }: { message: CanvasAgentMessage }): React.ReactElement {
  const data = message.timeline;
  if (!data || data.steps.length === 0) return <></>;

  return (
    <div
      style={{
        width: '100%',
        margin: '6px 0',
        padding: '10px 14px',
        background: 'var(--agent-surface)',
        border: '1px solid var(--agent-border)',
        borderRadius: 10,
        animation: 'agentFadeUp 0.35s ease',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--agent-muted)',
          marginBottom: 8,
          letterSpacing: 0.4,
        }}
      >
        执行时间线
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {data.steps.map((step, i) => {
          const isLast = i === data.steps.length - 1;
          return (
            <div key={step.id} style={{ display: 'flex', gap: 10 }}>
              {/* 节点 + 连线 */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {nodeIcon(step)}
                {!isLast && (
                  <div
                    style={{
                      width: LINE_WIDTH,
                      flex: 1,
                      minHeight: 14,
                      margin: '2px 0',
                      background: step.status === 'done' ? 'rgba(16,185,129,0.4)' : 'var(--agent-border)',
                    }}
                  />
                )}
              </div>
              {/* 名称 */}
              <div
                style={{
                  paddingBottom: isLast ? 0 : 14,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12.5,
                    fontWeight: step.status === 'running' ? 600 : 500,
                    color: step.status === 'running'
                      ? 'var(--agent-accent)'
                      : step.status === 'failed'
                        ? 'var(--agent-danger)'
                        : 'var(--agent-text)',
                    lineHeight: `${NODE_SIZE}px`,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {step.kind === 'canvas' ? (
                    <MousePointerClick size={11} color="var(--agent-accent)" style={{ flexShrink: 0 }} />
                  ) : (
                    <Wrench size={11} color="var(--agent-muted)" style={{ flexShrink: 0 }} />
                  )}
                  {step.name}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
