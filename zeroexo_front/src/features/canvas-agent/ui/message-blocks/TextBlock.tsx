/**
 * TextBlock - 文本消息
 *
 * 参考 tvc-agent (2).html 设计，100% 复刻样式：
 * - 用户消息：右对齐，渐变气泡，圆角
 * - AI 消息：左对齐，ai-body 样式
 */

import type { CanvasAgentMessage } from '../types.js';

export interface TextBlockProps {
  message: CanvasAgentMessage;
}

export function TextBlock({ message }: TextBlockProps): React.ReactElement {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div
        style={{
          maxWidth: '85%',
          background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
          color: '#fff',
          padding: '10px 14px',
          borderRadius: '14px 14px 4px 14px',
          fontSize: 13.5,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {message.text}
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        fontSize: 13.5,
        lineHeight: 1.7,
        color: '#cbd5e1',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {message.text}
    </div>
  );
}