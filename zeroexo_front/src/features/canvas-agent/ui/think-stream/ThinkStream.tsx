/**
 * ThinkStream - 思考态（融入消息流）
 *
 * 以 .msg.assistant 风格渲染为对话流中的一条消息条目（不再顶部固定）:
 * - 角色行:「思考」+ 活跃绿点 + 开始时间
 * - 正文: 打字机效果（TypingText）+ 步骤胶囊（StepCapsuleList）
 * - 思考完成后 2 秒自动折叠为「查看思考过程」摘要行,点击可展开
 * 随消息流滚动呈现。
 */

import { useState, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import { useCanvasAgentStore } from '../store.js';
import { TypingText } from './TypingText.js';
import { StepCapsuleList } from './StepCapsule.js';

/** 时间戳 → HH:MM（与消息列表 msg-time 一致） */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function ThinkStream(): React.ReactElement {
  const thinking = useCanvasAgentStore((s) => s.thinking);
  const setThinking = useCanvasAgentStore((s) => s.setThinking);

  // 首次渲染时记录开始时间（ThinkingState 无时间戳字段）
  const [startedAt] = useState(() => Date.now());
  const [collapsed, setCollapsed] = useState(false);

  // 思考完成时自动折叠（收敛为一行摘要）
  useEffect(() => {
    if (!thinking.active && thinking.text) {
      const timer = setTimeout(() => setCollapsed(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [thinking.active, thinking.text]);

  // 开始思考时展开
  useEffect(() => {
    if (thinking.active) setCollapsed(false);
  }, [thinking.active]);

  if (!thinking.active && !thinking.text) return <></>;

  return (
    <div className="msg assistant">
      {/* 角色行 */}
      <div className="role">
        <span>思考</span>
        {thinking.active && (
          <span
            className="agent-pulse-dot"
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#4ade80',
              display: 'inline-block',
            }}
          />
        )}
        <span className="msg-time">{formatTime(startedAt)}</span>
      </div>

      {/* 正文区 */}
      <div className="ai-body">
        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            title="展开思考过程"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              border: 'none',
              background: 'transparent',
              padding: 0,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--agent-accent)',
            }}
          >
            <ChevronRight
              size={11}
              style={{
                transition: 'transform 0.2s',
                transform: 'rotate(90deg)',
              }}
            />
            查看思考过程
          </button>
        ) : (
          <>
            {thinking.text && (
              <TypingText
                text={thinking.text}
                streaming={thinking.active}
                onStop={() => {
                  setThinking({ active: false });
                }}
              />
            )}
            <StepCapsuleList steps={thinking.steps} />
          </>
        )}
      </div>
    </div>
  );
}
