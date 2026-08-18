/**
 * SimpleSelect - 轻量主题化下拉选择（零原生 <select>）
 *
 * 动机: 项目全局禁用浏览器原生 <select>（样式无法完全 theme 化,
 * 尤其是 Windows/Linux 下 option 面板仍为系统白/灰）。
 * 本组件基于自研 Dropdown 实现, 颜色/圆角/阴影完全遵循项目 theme。
 *
 * 规则:
 * - 无内部圆角(borderRadius=0)
 * - 触发器样式 = 与项目其它输入控件一致（边框/背景/字体均取自 theme）
 * - 列表项 hover 背景使用 theme 约定 10% 色级
 */
import { useState, useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { Dropdown } from './dropdown.js';
import i18n from '@/i18n/config';

export interface SimpleSelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** 可选的附加左侧展示 */
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SimpleSelectProps<T extends string = string> {
  value?: T;
  placeholder?: string;
  options: SimpleSelectOption<T>[];
  onChange: (value: T) => void;
  width?: number | string;
  minWidth?: number;
  height?: number;
  align?: 'left' | 'right';
  /** 触发器字体/颜色自定义 (可选,默认 theme 文本) */
  triggerFontFamily?: string;
  triggerFontWeight?: number | string;
  triggerColor?: string;
  triggerBorder?: string;
  triggerBackground?: string;
  /** 阻止触发按钮冒泡, 避免拖动画布/节点 */
  stopPropagation?: boolean;
  className?: string;
  /** 受控展开状态(可选,传入则由外部控制) */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 自定义 z-index(默认 200;全屏模式等需要更高层级时传入) */
  zIndex?: number;
  /** 使用 fixed 定位(脱离父容器,悬浮在节点之上,避免被父容器 overflow:hidden 裁剪) */
  fixed?: boolean;
}

export function SimpleSelect<T extends string = string>({
  value,
  placeholder = i18n.t('simpleSelect.placeholder'),
  options,
  onChange,
  width,
  minWidth,
  height = 26,
  align = 'left',
  triggerFontFamily,
  triggerFontWeight,
  triggerColor,
  triggerBorder,
  triggerBackground,
  stopPropagation = false,
  className,
  open: controlledOpen,
  onOpenChange,
  zIndex,
  fixed = false,
}: SimpleSelectProps<T>): React.ReactElement {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled
    ? (v: boolean) => onOpenChange?.(v)
    : setInternalOpen;

  const selected = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  const hoverBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';

  const triggerStyle: CSSProperties = {
    width: width ?? undefined,
    minWidth: minWidth ?? undefined,
    height,
    padding: '0 8px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    border: triggerBorder ?? `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
    borderRadius: 0,
    background: triggerBackground ?? 'transparent',
    color: triggerColor ?? theme.toolbar.text,
    fontSize: 12,
    fontFamily: triggerFontFamily ?? 'inherit',
    fontWeight: triggerFontWeight ?? 400,
    outline: 'none',
    boxSizing: 'border-box',
    cursor: 'pointer',
    transition: 'background 0.12s, border-color 0.12s',
  };

  const dropdownItems = options.map((o) => ({
    key: o.value,
    label: o.label,
    icon: o.icon,
    disabled: o.disabled,
    onClick: () => onChange(o.value),
  }));

  // 触发按钮的 pointer 事件 (可阻止冒泡, 放在节点工具栏时不触发节点拖拽/画布平移)
  const onTriggerPointerDown = stopPropagation
    ? (e: React.PointerEvent) => e.stopPropagation()
    : undefined;

  return (
    <div className={className}>
      <Dropdown
        open={open}
        onOpenChange={setOpen}
        theme={theme}
        align={align}
        width={typeof width === 'number' ? width : undefined}
        items={dropdownItems}
        zIndex={zIndex}
        fixed={fixed}
        trigger={
          <div
            style={triggerStyle}
            onPointerDown={onTriggerPointerDown}
            onMouseEnter={(e) => {
              if (!triggerBackground) (e.currentTarget as HTMLElement).style.background = hoverBg;
            }}
            onMouseLeave={(e) => {
              if (!triggerBackground) (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                opacity: selected ? 1 : 0.6,
              }}
            >
              {selected ? selected.label : placeholder}
            </span>
            <ChevronDown size={12} style={{ opacity: 0.7, flexShrink: 0 }} />
          </div>
        }
      />
    </div>
  );
}
