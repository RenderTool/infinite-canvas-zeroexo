/**
 * PromptTextarea - 提示词输入框(纯展示)
 *
 * 根据 mode 显示不同 placeholder。Enter 提交(无 Shift),Shift+Enter 换行。
 * 中文输入法合成态(isComposing)下 Enter 不触发提交,避免误提交。
 *
 * Phase E 将替换为 CanvasResourceMentionTextarea(@ 资源引用)。
 */

import type { CSSProperties, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/plugin-theme';
import type { GenerationMode } from './prompt-panel.js';

export interface PromptTextareaProps {
  value: string;
  mode: GenerationMode;
  theme: ThemeConfig;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export function PromptTextarea({
  value,
  mode,
  theme,
  disabled = false,
  onChange,
  onSubmit,
}: PromptTextareaProps): React.ReactElement {
  const { t } = useTranslation();
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <textarea
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={t(`prompt.placeholder${mode.charAt(0).toUpperCase()}${mode.slice(1)}`)}
      style={textareaStyle(theme.node.contentBackground, theme.node.outlineColor, theme.toolbar.text)}
    />
  );
}

const textareaStyle = (background: string, border: string, color: string): CSSProperties => ({
  width: '100%',
  height: 96,
  resize: 'none',
  borderRadius: 12,
  border: `1px solid ${border}`,
  background,
  color,
  padding: '8px 12px',
  fontSize: 13,
  lineHeight: '20px',
  outline: 'none',
  fontFamily: 'inherit',
});
