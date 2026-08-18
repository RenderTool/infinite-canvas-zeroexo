/**
 * FullscreenDropdown - 全屏头部下拉菜单（共享组件）
 *
 * 复用运镜下拉的 portal 方案:通过 createPortal 渲染到 document.body,
 * fixed 定位 + zIndex(遮罩 19999 / 面板 20000)。
 * 供剧本/分镜节点视图与全屏视图复用,保证集数下拉形式与按钮样式一致。
 */
import { memo, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '@zeroexo/plugin-theme';
import { Z_INDEX } from '@/shared/constants/z-index.js';

export interface FullscreenMenuOption {
  key: string;
  label: ReactNode;
  disabled?: boolean;
  active?: boolean;
}

export interface FullscreenDropdownProps {
  children: ReactNode;
  options: FullscreenMenuOption[];
  onSelect: (key: string) => void;
  /** 面板最大高度(默认 240) */
  maxHeight?: number;
}

export const FullscreenDropdown = memo(function FullscreenDropdown({
  children,
  options,
  onSelect,
  maxHeight = 240,
}: FullscreenDropdownProps): ReactElement {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const bgCanvas = isDark ? '#171717' : '#ffffff';
  const bgHover = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
  const borderMuted = isDark ? '#2e2e2e' : '#e5e5e5';
  const textColor = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;

  return (
    <div
      style={{ display: 'inline-flex', alignItems: 'center' }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (open) {
          setOpen(false);
        } else {
          setRect({ top: r.bottom, left: r.left, width: r.width });
          setOpen(true);
        }
      }}
    >
      {children}
      {open && rect && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: Z_INDEX.FULLSCREEN_DROPDOWN_MASK }} onClick={() => setOpen(false)} />
          <div style={{ position: 'fixed', top: rect.top + 4, left: rect.left, minWidth: Math.max(rect.width, 140), zIndex: Z_INDEX.FULLSCREEN_DROPDOWN, maxHeight, overflow: 'auto', border: `1px solid ${borderMuted}`, borderRadius: 6, background: bgCanvas, boxShadow: '0 6px 20px rgba(0,0,0,0.28)' }}>
            {options.map((opt) => (
              <div
                key={opt.key}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!opt.disabled) onSelect(opt.key);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', cursor: opt.disabled ? 'not-allowed' : 'pointer',
                  fontSize: 12, whiteSpace: 'nowrap',
                  color: opt.disabled ? textMuted : (opt.active ? accent : textColor),
                  background: opt.active ? bgHover : 'transparent',
                }}
                onMouseEnter={(e) => { if (!opt.disabled) e.currentTarget.style.background = bgHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = opt.active ? bgHover : 'transparent'; }}
              >
                {opt.label}
              </div>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
});

/** 全屏工具栏/集数下拉按钮:icon + 文本描述,统一节点视图与全屏视图样式 */
export const fullToolBtnStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  fontSize: 12,
};