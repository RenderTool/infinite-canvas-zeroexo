/**
 * SettingsPopoverShell - 设置弹出面板通用骨架
 *
 * 提供按钮 + createPortal 面板定位 + 点击外部/滚动关闭。
 * 图片/视频/音频 SettingsPopover 复用此骨架,各自实现面板内容。
 * 同时导出通用 UI 组件(SettingGroup/OptionPill/SwitchRow/NumberInput)。
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { Tooltip } from 'antd';
import { Settings2, ChevronDown } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/plugin-theme';

export type PopoverPlacement = 'topLeft' | 'top' | 'topRight' | 'bottomLeft' | 'bottom' | 'bottomRight';

/** 触发器外观:pill=胶囊边框按钮(默认),dropdown=透明无边框下拉同款(与 StyledSelect 一致) */
export type TriggerVariant = 'pill' | 'dropdown';

export interface SettingsPopoverShellProps {
  /** 按钮显示的摘要文字(如 "auto·1:1·3张") */
  summary: string;
  /** 面板内容 */
  children: ReactNode;
  theme: ThemeConfig;
  placement?: PopoverPlacement;
  /** 面板宽度 */
  panelWidth?: number;
  /** 触发器外观变体 */
  triggerVariant?: TriggerVariant;
}

export function SettingsPopoverShell({
  summary,
  children,
  theme,
  placement = 'topLeft',
  panelWidth = 320,
  triggerVariant = 'pill',
}: SettingsPopoverShellProps): React.ReactElement {
  const buttonRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!open) return;
    const syncPosition = () => setButtonRect(buttonRef.current?.getBoundingClientRect() ?? null);
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    // 仅当滚动发生在面板/按钮之外时才关闭:
    // 面板内部内容滚动(scroll 事件 target 为面板自身)不得关闭,否则参数面板一滚动就收起
    const closeOnScroll = (event: Event) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    syncPosition();
    window.addEventListener('resize', syncPosition);
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('pointerdown', closeOnOutside, true);
    return () => {
      window.removeEventListener('resize', syncPosition);
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('pointerdown', closeOnOutside, true);
    };
  }, [open]);

  return (
    <>
      <span ref={buttonRef} style={{ display: 'inline-flex', minWidth: 0 }}>
        <Tooltip title={summary}>
          <button
            type="button"
            onClick={() => {
              setButtonRect(buttonRef.current?.getBoundingClientRect() ?? null);
              setOpen((prev) => !prev);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onMouseEnter={(event) => {
              if (triggerVariant === 'dropdown') {
                const isDark = theme.mode === 'dark';
                event.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
              }
            }}
            onMouseLeave={(event) => {
              if (triggerVariant === 'dropdown') event.currentTarget.style.background = 'transparent';
            }}
            style={buttonStyle(theme, triggerVariant)}
          >
            {triggerVariant === 'dropdown' ? (
              <>
                <Settings2 size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
                <span style={summaryStyle}>{summary}</span>
                <ChevronDown size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
              </>
            ) : (
              <>
                <Settings2 size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
                <span style={summaryStyle}>{summary}</span>
              </>
            )}
          </button>
        </Tooltip>
      </span>
      {open && buttonRect ? (
        <SettingsPortal
          buttonRect={buttonRect}
          panelRef={panelRef}
          placement={placement}
          theme={theme}
          width={panelWidth}
        >
          {children}
        </SettingsPortal>
      ) : null}
    </>
  );
}

function SettingsPortal({
  buttonRect,
  panelRef,
  placement,
  theme,
  width,
  children,
}: {
  buttonRect: DOMRect;
  panelRef: RefObject<HTMLDivElement>;
  placement: PopoverPlacement;
  theme: ThemeConfig;
  width: number;
  children: ReactNode;
}): React.ReactElement {
  const gap = 8;
  const margin = 12;
  const alignRight = placement.endsWith('Right');
  const alignCenter = placement === 'top' || placement === 'bottom';
  const left = alignCenter
    ? buttonRect.left + buttonRect.width / 2 - width / 2
    : alignRight
      ? buttonRect.right - width
      : buttonRect.left;
  const topPlacement = placement.startsWith('top');
  const style: CSSProperties = {
    position: 'fixed',
    zIndex: 1200,
    width,
    left: Math.max(margin, Math.min(window.innerWidth - width - margin, left)),
    ...(topPlacement
      ? { bottom: window.innerHeight - buttonRect.top + gap, maxHeight: Math.max(260, buttonRect.top - margin * 2) }
      : { top: buttonRect.bottom + gap, maxHeight: Math.max(260, window.innerHeight - buttonRect.bottom - margin * 2) }),
    background: theme.toolbar.panel,
    borderRadius: 14,
    boxShadow: '0 18px 54px rgba(28, 25, 23, 0.16)',
    padding: 16,
    overflowY: 'auto',
    color: theme.toolbar.text,
  };
  return createPortal(
    <div
      ref={panelRef}
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

// ===== 通用面板 UI 组件 =====

export function SettingGroup({
  title,
  color,
  children,
}: {
  title: string;
  color: string;
  children: ReactNode;
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color }}>{title}</div>
      {children}
    </div>
  );
}

export function OptionPill({
  selected,
  disabled = false,
  theme,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  theme: ThemeConfig;
  onClick: () => void;
  children: ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      style={{
        height: 32,
        padding: '0 10px',
        borderRadius: 9999,
        border: `1px solid ${selected ? theme.toolbar.text : theme.toolbar.border}`,
        background: 'transparent',
        color: theme.toolbar.text,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        fontSize: 12,
        transition: 'opacity 0.12s',
      }}
    >
      {children}
    </button>
  );
}

export function SwitchRow({
  label,
  checked,
  theme,
  onChange,
}: {
  label: string;
  checked: boolean;
  theme: ThemeConfig;
  onChange: (checked: boolean) => void;
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', height: 32, alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 12, color: theme.toolbar.text }}>{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          width: 36,
          height: 20,
          borderRadius: 9999,
          border: 'none',
          background: checked ? theme.toolbar.accent : theme.toolbar.border,
          cursor: 'pointer',
          position: 'relative',
          transition: 'background 0.15s',
        }}
        aria-pressed={checked}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 0.15s',
          }}
        />
      </button>
    </div>
  );
}

export function NumberInput({
  value,
  min,
  max,
  theme,
  onChange,
}: {
  value: string;
  min: number;
  max: number;
  theme: ThemeConfig;
  onChange: (value: string) => void;
}): React.ReactElement {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      style={{
        height: 32,
        borderRadius: 9999,
        border: `1px solid ${theme.toolbar.border}`,
        background: 'transparent',
        color: theme.toolbar.text,
        padding: '0 10px',
        fontSize: 12,
        textAlign: 'center',
        outline: 'none',
        width: 60,
        // 隐藏 number 输入的 spin 按钮
        WebkitAppearance: 'textfield' as unknown as 'none',
      }}
    />
  );
}

export function TextInput({
  value,
  placeholder,
  theme,
  onChange,
}: {
  value: string;
  placeholder?: string;
  theme: ThemeConfig;
  onChange: (value: string) => void;
}): React.ReactElement {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      style={{
        height: 32,
        borderRadius: 8,
        border: `1px solid ${theme.toolbar.border}`,
        background: 'transparent',
        color: theme.toolbar.text,
        padding: '0 10px',
        fontSize: 12,
        outline: 'none',
        flex: 1,
        minWidth: 0,
      }}
    />
  );
}

// ===== 样式 =====

const buttonStyle = (theme: ThemeConfig, variant: TriggerVariant): CSSProperties => {
  if (variant === 'dropdown') {
    // 与生成器 StyledSelect 同款:无边框透明、hover 灰底、等宽高度
    return {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      height: 26,
      maxWidth: 180,
      padding: '0 6px',
      border: 'none',
      borderRadius: 4,
      background: 'transparent',
      color: theme.toolbar.text,
      cursor: 'pointer',
      fontSize: 12,
      fontFamily: 'inherit',
      transition: 'background 0.12s',
      boxSizing: 'border-box',
      userSelect: 'none',
    };
  }
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 32,
    maxWidth: 180,
    padding: '0 10px',
    borderRadius: 9999,
    border: `1px solid ${theme.toolbar.border}`,
    background: 'transparent',
    color: theme.toolbar.text,
    cursor: 'pointer',
    fontSize: 12,
  };
};

const summaryStyle: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
};
