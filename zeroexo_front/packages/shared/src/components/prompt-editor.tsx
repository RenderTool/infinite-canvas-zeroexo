/**
 * PromptEditor - 共享提示词编辑器组件
 *
 * 从 src/features/prompt-panel/components/prompt-textarea.tsx 提取基础功能
 * 适配双端（AgentPanel 和 Generator）
 * 支持 @ 引用（通过 scope 参数区分作用域）
 *
 * G17: 双端共用同一 PromptEditor 组件
 * - Agent 的 @ 引用作用域为整个画布节点
 * - Generator 的 @ 引用作用域为已连入的引用素材
 */

import type { CSSProperties, KeyboardEvent } from 'react';

export interface PromptEditorProps {
  value: string;
  /** 占位符文本 */
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /**
   * @ 引用作用域
   * - 'agent': 画布节点
   * - 'generator': 已连入的引用素材
   */
  scope?: 'agent' | 'generator';
  /** 自定义样式 */
  style?: CSSProperties;
}

const DEFAULT_MAX_LENGTH = 2000;

export function PromptEditor({
  value,
  placeholder,
  disabled = false,
  maxLength = DEFAULT_MAX_LENGTH,
  onChange,
  onSubmit,
  scope = 'generator',
  style,
}: PromptEditorProps): React.ReactElement {
  const charCount = value.length;
  const isOverLimit = charCount > maxLength;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!isOverLimit) {
        onSubmit();
      }
    }
  };

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    if (next.length <= maxLength) {
      onChange(next);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', ...style }}>
      <textarea
        value={value}
        disabled={disabled}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        maxLength={maxLength}
        placeholder={placeholder}
        data-prompt-editor-scope={scope}
        style={textareaStyle}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 6,
          right: 10,
          fontSize: 10,
          color: isOverLimit ? '#ef4444' : 'inherit',
          pointerEvents: 'none',
          lineHeight: 1,
          opacity: 0.6,
        }}
      >
        {charCount}/{maxLength}
      </div>
    </div>
  );
}

const textareaStyle: CSSProperties = {
  width: '100%',
  height: 96,
  resize: 'none',
  borderRadius: 12,
  padding: '8px 12px',
  fontSize: 13,
  lineHeight: '20px',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};