/**
 * ShotStatePicker - 景别/运镜选择器组件
 *
 * 从 StoryboardTable.tsx 中抽离的运镜选择器，接收 options 和 onChange 回调。
 * 通过 portal 渲染到 document.body，fixed 定位，zIndex 高于全屏 overlay。
 */
import { type ReactElement } from 'react';
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
}

export function ShotStatePicker({
  rect,
  options,
  currentValue,
  onSelect,
  onClose,
  textColor,
  bgHover,
  bgCanvas,
  borderMuted,
  accent,
}: ShotStatePickerProps): ReactElement | null {
  if (!rect) return null;
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
      </div>
    </>,
    document.body,
  );
}