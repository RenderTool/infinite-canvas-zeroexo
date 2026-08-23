/**
 * BriefBlock - 任务简报卡（Plan#36 R2-5 emit_brief 协议）
 *
 * 任务完成交付的结构化呈现：
 * - 成果摘要 + 产出节点引用（点击聚焦画布节点，走 focusOnBounds 契约 经验 #16）
 * - 待审核声明 + 「继续提问」引导
 */

import { Sparkles, Crosshair } from 'lucide-react';
import { App as AntdApp } from 'antd';
import type { CanvasAgentMessage } from '../types.js';
import { executeCanvasOp } from '../canvas-op-bridge.js';

export function BriefBlock(props: { message: CanvasAgentMessage }): React.ReactElement {
  const { message } = props;
  const { message: msg } = AntdApp.useApp();
  const brief = message.brief;
  if (!brief) return <></>;

  // R3-A2: 节点已被删除时桥接层返回 false → 友好提示而非静默无反应
  const handleFocusNode = async (nodeId: string) => {
    const ok = await executeCanvasOp({ op: 'focus', args: { id: nodeId } });
    if (!ok) msg.warning('该节点已删除');
  };

  return (
    <div
      style={{
        width: '100%',
        margin: '6px 0',
        padding: '12px 14px',
        background: 'linear-gradient(135deg, var(--agent-accent-soft), transparent 65%)',
        border: '1px solid var(--agent-accent)',
        borderRadius: 12,
        animation: 'agentFadeUp 0.4s ease',
      }}
    >
      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Sparkles size={13} color="var(--agent-accent)" />
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: 'var(--agent-accent)',
          }}
        >
          任务简报
        </span>
      </div>

      {/* 成果摘要 */}
      <div style={{ fontSize: 13, color: 'var(--agent-text)', lineHeight: 1.65 }}>
        {brief.summary}
      </div>

      {/* 产出节点引用 */}
      {brief.nodeRefs && brief.nodeRefs.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {brief.nodeRefs.map((ref) => (
            <button
              key={ref.nodeId}
              type="button"
              onClick={() => handleFocusNode(ref.nodeId)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 10px',
                border: '1px solid var(--agent-border)',
                borderRadius: 7,
                background: 'var(--agent-surface)',
                color: 'var(--agent-text)',
                fontSize: 11.5,
                fontWeight: 500,
                fontFamily: 'inherit',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              title="点击聚焦画布节点"
            >
              <Crosshair size={11} color="var(--agent-accent)" />
              {ref.label}
            </button>
          ))}
        </div>
      )}

      {/* 待审核声明 */}
      {brief.note && (
        <div style={{ fontSize: 11.5, color: 'var(--agent-muted)', marginTop: 8, lineHeight: 1.5 }}>
          {brief.note}
        </div>
      )}
    </div>
  );
}
