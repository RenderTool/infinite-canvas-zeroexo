/**
 * TextBlock - 文本消息
 *
 * 参考 tvc-agent (2).html 设计，100% 复刻样式：
 * - 用户消息：右对齐，渐变气泡，圆角
 * - AI 消息：左对齐，ai-body 样式
 *
 * AI 消息正文含 `<question-form>` artifact 时（Plan#36 P0-2）：
 * 解析并内联渲染表单（FormBlock），文本前后部分照常展示。
 */

import type { CanvasAgentMessage } from '../types.js';
import { parseQuestionForm } from './form-utils.js';
import { FormBlock } from './FormBlock.js';

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
          background: 'var(--agent-user-bubble)',
          color: 'var(--agent-text)',
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

  // 内联澄清表单：解析正文中的 <question-form> 块，拆为「文本 + 表单 + 文本」
  const parsed = parseQuestionForm(message.text ?? '');
  if (parsed) {
    return (
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13.5,
          lineHeight: 1.7,
          color: 'var(--agent-text)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {parsed.before && <div>{parsed.before}</div>}
        <FormBlock form={parsed.form} />
        {parsed.after && <div>{parsed.after}</div>}
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
        color: 'var(--agent-text)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {message.text}
    </div>
  );
}