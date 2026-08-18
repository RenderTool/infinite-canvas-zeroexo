/**
 * ThinkStream - 思考区容器
 *
 * 顶部可折叠区域，包含：
 * - 打字机正文（TypingText）
 * - 步骤胶囊列表（StepCapsuleList）
 * 工具调用时显示折叠卡片（入参摘要）
 *
 * 默认展开（正在 thinking 时），完成后自动折叠。
 */

import { useState, useEffect } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { useCanvasAgentStore } from '../store.js';
import { useAgentTheme } from '../context/theme-context.js';
import { TypingText } from './TypingText.js';
import { StepCapsuleList } from './StepCapsule.js';

export function ThinkStream(): React.ReactElement {
  const t = useAgentTheme();
  const thinking = useCanvasAgentStore((s) => s.thinking);
  const setThinking = useCanvasAgentStore((s) => s.setThinking);

  const [collapsed, setCollapsed] = useState(false);

  // 思考完成时自动折叠
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

  const titleColor = t.isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)';
  const lineColor = t.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)';

  return (
    <div
      style={{
        borderBottom: `1px solid ${t.border}`,
        flexShrink: 0,
      }}
    >
      {/* 折叠/展开头部 */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          padding: '8px 14px',
          background: 'transparent',
          border: 'none',
          color: titleColor,
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <Sparkles size={12} />
        <span>
          {thinking.active ? '思考中…' : '思考完成'}
        </span>
        {thinking.active && (
          <span className="agent-pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', display: 'inline-block', marginLeft: 4 }} />
        )}
        <ChevronDown
          size={12}
          style={{
            marginLeft: 'auto',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        />
      </button>

      {/* 内容区 */}
      {!collapsed && (
        <div
          style={{
            padding: '0 14px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {/* 打字机正文 */}
          {thinking.text && (
            <div
              style={{
                paddingLeft: 12,
                borderLeft: `2px solid ${lineColor}`,
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

          {/* 步骤胶囊 */}
          <StepCapsuleList steps={thinking.steps} />
        </div>
      )}
    </div>
  );
}