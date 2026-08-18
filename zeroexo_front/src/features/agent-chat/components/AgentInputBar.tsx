/**
 * AgentInputBar - 统一的 Agent 对话输入栏（框架内置）
 *
 * 设计要点：
 * - 左侧 TextArea/Input（受控）
 * - 右侧发送按钮（圆形 + 主题色 + 渐变）
 * - 支持 Enter 发送 / Shift+Enter 换行
 * - 支持 disabled 状态
 * - 边框与背景色统一使用 token
 */
import { useCallback, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react';
import { Send } from 'lucide-react';
import { Input } from 'antd';

export interface AgentInputBarProps {
  /** 当前输入值（受控） */
  value: string;
  /** 值变化回调 */
  onChange: (value: string) => void;
  /** 发送回调 */
  onSend: () => void;
  /** 主题强调色 */
  accent: string;
  /** 卡片边框色 */
  cardBorder: string;
  /** 占位符 */
  placeholder?: string;
  /** 是否禁用（loading 时） */
  disabled?: boolean;
  /** 是否多行（默认 false，单行 Enter 发送） */
  multiline?: boolean;
  /** ref 转发到内部输入元素 */
  inputRef?: React.Ref<HTMLInputElement | HTMLTextAreaElement>;
  /** 自定义类名 */
  className?: string;
}

export function AgentInputBar({
  value,
  onChange,
  onSend,
  accent,
  cardBorder,
  placeholder = '输入指令，回车发送…',
  disabled = false,
  multiline = false,
  inputRef,
  className,
}: AgentInputBarProps): ReactElement {
  const handleSend = useCallback(() => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend();
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInputKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const wrapperStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderTop: `1px solid ${cardBorder}`,
    flexShrink: 0,
    background: 'transparent',
  };

  const sendDisabled = disabled || !value.trim();

  return (
    <div style={wrapperStyle} className={className}>
      {multiline ? (
        <Input.TextArea
          ref={inputRef as any}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoSize={{ minRows: 1, maxRows: 5 }}
          variant="borderless"
          style={{ fontSize: 13, resize: 'none' }}
          disabled={disabled}
        />
      ) : (
        <Input
          ref={inputRef as any}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          variant="borderless"
          style={{ fontSize: 13 }}
          disabled={disabled}
        />
      )}
      <button
        type="button"
        onClick={handleSend}
        disabled={sendDisabled}
        aria-label="发送"
        style={sendBtnStyle(accent, sendDisabled)}
      >
        <Send size={14} />
      </button>
    </div>
  );
}

function sendBtnStyle(accent: string, disabled: boolean): CSSProperties {
  return {
    width: 34,
    height: 34,
    borderRadius: '50%',
    border: 'none',
    background: disabled
      ? 'rgba(128, 128, 128, 0.25)'
      : `linear-gradient(135deg, ${accent} 0%, ${accent}cc 100%)`,
    color: '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'all 0.2s ease',
    boxShadow: disabled ? 'none' : `0 2px 8px ${accent}55`,
  };
}
