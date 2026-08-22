/**
 * ShotStatePicker - 景别/运镜/状态选择器组件
 *
 * 从 StoryboardTable.tsx 中抽离的运镜选择器，接收 options 和 onChange 回调。
 * 通过 portal 渲染到 document.body，fixed 定位，zIndex 高于全屏 overlay。
 * 支持 showCustom：底部显示"自定义输入"按钮，点击后弹出输入框（供运镜字段使用）。
 */
import { useState, useRef, useEffect, type ReactElement, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Z_INDEX } from '@/shared/constants/z-index.js';

export interface ShotStatePickerProps {
  rect: { top: number; left: number; width: number } | null;
  options: string[];
  currentValue: string;
  onSelect: (opt: string) => void;
  onClose: () => void;
  textColor: string;
  mutedColor: string;
  bgHover: string;
  bgCanvas: string;
  borderMuted: string;
  accent: string;
  /** 是否显示"自定义输入"选项（运镜使用，支持复合运镜文本） */
  showCustom?: boolean;
}

export function ShotStatePicker({
  rect,
  options,
  currentValue,
  onSelect,
  onClose,
  textColor,
  mutedColor,
  bgHover,
  bgCanvas,
  borderMuted,
  accent,
  showCustom,
}: ShotStatePickerProps): ReactElement | null {
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (customOpen) {
      inputRef.current?.focus();
    }
  }, [customOpen]);

  if (!rect) return null;

  const handleCustomConfirm = () => {
    const val = customValue.trim();
    if (val) {
      onSelect(val);
      setCustomOpen(false);
      setCustomValue('');
    }
  };

  const handleCustomKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleCustomConfirm();
    } else if (e.key === 'Escape') {
      setCustomOpen(false);
      setCustomValue('');
    }
  };

  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: Z_INDEX.FULLSCREEN_DROPDOWN_MASK }} onClick={onClose} />
      <div style={{ position: 'fixed', top: rect.top + 4, left: rect.left, minWidth: rect.width, zIndex: Z_INDEX.FULLSCREEN_DROPDOWN, maxHeight: 200, overflow: 'auto', border: `1px solid ${borderMuted}`, borderRadius: 4, background: bgCanvas, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
        {options.map((opt) => (
          <div
            key={opt}
            onClick={(e) => { e.stopPropagation(); onSelect(opt); }}
            style={{
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: 11,
              color: opt === currentValue ? accent : textColor,
              background: opt === currentValue ? bgHover : 'transparent',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = bgHover; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = opt === currentValue ? bgHover : 'transparent'; }}
          >
            {opt}
          </div>
        ))}
        {showCustom && !customOpen && (
          <div
            onClick={(e) => { e.stopPropagation(); setCustomOpen(true); }}
            style={{ padding: '4px 8px', cursor: 'pointer', fontSize: 11, color: mutedColor, borderTop: `1px solid ${borderMuted}`, fontStyle: 'italic' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = bgHover; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          >
            + 自定义输入
          </div>
        )}
        {showCustom && customOpen && (
          <div style={{ padding: '4px 8px', borderTop: `1px solid ${borderMuted}`, display: 'flex', gap: 4 }}>
            <input
              ref={inputRef}
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              onKeyDown={handleCustomKeyDown}
              placeholder="输入复合运镜..."
              style={{ flex: 1, fontSize: 11, border: `1px solid ${borderMuted}`, borderRadius: 2, padding: '2px 4px', background: bgCanvas, color: textColor, outline: 'none' }}
            />
            <span
              onClick={(e) => { e.stopPropagation(); handleCustomConfirm(); }}
              style={{ padding: '2px 6px', fontSize: 11, cursor: 'pointer', color: accent, fontWeight: 600 }}
            >
              确定
            </span>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}