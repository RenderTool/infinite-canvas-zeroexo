/**
 * GroupItem - 单个组的渲染单元(memo 包裹)
 *
 * 职责:
 * - 背景层(磨砂玻璃/渐变) + 外轮廓(选中红/未选中蓝,厚度按 1/k 缩放)
 * - 标题栏(轮廓边缘上方,支持重命名输入/版本文件夹折叠按钮)
 * - 子节点计数徽标
 * - resize handles(选中正式组) + 聚合 pin(选中或连线拖拽期间)
 *
 * 视觉属性(outlineWidth/borderRadius/fontSize)按 invK(=1/viewport.k)缩放,保持视觉恒定。
 */

import React from 'react';
import type { Rect } from '@zeroexo/core';
import { GROUP_Z_INDEX, GROUP_TITLE_HEIGHT, GROUP_INPUT_PIN_ID, GROUP_OUTPUT_PIN_ID } from '../constants.js';
import { useGroupDefaults } from '../group-defaults.js';
import { GroupResizeHandle, GROUP_HANDLE_DEFS, type ResizeHandleType } from './group-resize-handle.js';
import { GroupPin } from './group-pin.js';

export interface GroupItemProps {
  groupId: string;
  title: string;
  bounds: Rect;
  /** 组内直接子节点数量(用于右上角统计显示) */
  childrenCount: number;
  backgroundColor: string | undefined;
  /** 圆角(世界坐标像素,默认 8;undefined 走默认值) */
  borderRadius: number | undefined;
  /** 外轮廓颜色(支持 rgba 透明;undefined 用默认:选中红/未选中蓝) */
  outlineColor: string | undefined;
  /** 外轮廓厚度(世界坐标像素;undefined 用 2) */
  outlineWidth: number | undefined;
  /** 外轮廓类型(undefined 用 dashed) */
  outlineType: 'solid' | 'dashed' | undefined;
  /** 外轮廓偏移(世界坐标像素;正值向外扩,负值向内缩;undefined 用 0) */
  outlineOffset: number | undefined;
  /** 不透明度(0-1;undefined 用 1) */
  opacity: number | undefined;
  isSelected: boolean;
  isPreview: boolean;
  /** 组数超阈值时关闭磨砂玻璃背景(合成层上限降级,由 GroupLayer 计算) */
  blurDisabled?: boolean;
  isRenaming?: boolean;
  renameValue?: string;
  /** 是否显示版本文件夹折叠按钮 */
  showVersionFolderFold?: boolean;
  /** 版本文件夹折叠回调(切回叠卡模式) */
  onVersionFolderFold?: (groupId: string) => void;
  onGroupPointerDown?: (e: React.PointerEvent, groupId: string) => void;
  onGroupDoubleClick?: (e: React.MouseEvent, groupId: string) => void;
  /** 标题文字双击(与普通节点标题行为一致:进入重命名;不冒泡到组聚焦) */
  onTitleDoubleClick?: (groupId: string) => void;
  onRenameChange?: (value: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  onResizeHandlePointerDown?: (
    e: React.PointerEvent,
    groupId: string,
    handle: ResizeHandleType,
  ) => void;
  onGroupPinPointerDown?: (
    e: React.PointerEvent,
    pinEl: HTMLElement,
    groupId: string,
    pinId: string,
    direction: 'input' | 'output',
  ) => void;
  onGroupPinPointerEnter?: (
    e: React.PointerEvent,
    groupId: string,
    pinId: string,
    direction: 'input' | 'output',
  ) => void;
  onGroupPinPointerLeave?: () => void;
  /** 强制显示所有引脚(连线拖拽期间) */
  forceShowPins?: boolean;
}

export const GroupItem = React.memo(
  function GroupItem({
    groupId,
    title,
    bounds,
    childrenCount,
    backgroundColor,
    borderRadius,
    outlineColor,
    outlineWidth,
    outlineType,
    outlineOffset,
    opacity,
    isSelected,
    isPreview,
    blurDisabled,
    isRenaming,
    renameValue,
    onGroupPointerDown,
    onGroupDoubleClick,
    onTitleDoubleClick,
    onRenameChange,
    onRenameCommit,
    onRenameCancel,
    onResizeHandlePointerDown,
    onGroupPinPointerDown,
    onGroupPinPointerEnter,
    onGroupPinPointerLeave,
    forceShowPins,
    showVersionFolderFold,
    onVersionFolderFold,
  }: GroupItemProps): React.ReactElement {
    const groupDefaults = useGroupDefaults();
    const isLight = React.useMemo(() => {
      if (typeof window === 'undefined') return true;
      return !window.matchMedia('(prefers-color-scheme: dark)').matches;
    }, []);
    // 颜色:undefined 时回退全局默认,未注入 Provider 时兜底与配置默认 groupOutlineColor 同值(红)
    // 选中态强化红 0.9 仅在未注入 Provider 路径生效(注入路径用配置色)
    const resolvedOutlineColor = outlineColor ?? groupDefaults?.outlineColor ?? (isSelected
      ? 'rgba(233, 69, 96, 0.9)'
      : 'rgba(233, 69, 96, 0.5)');
    // 厚度:undefined 用 1(与配置默认同值),按 1/k 缩放保持视觉恒定
    // T3: 改走连续 CSS 变量 --zx-invk(GroupLayer 容器每帧写入),缩放逐帧连续跟随
    const invKVar = 'var(--zx-invk, 1)';
    const resolvedOutlineWidth = `calc(${outlineWidth ?? 1}px * ${invKVar})`;
    // 类型:undefined 默认 dashed(与全局默认同源)
    const resolvedOutlineType = outlineType ?? 'dashed';
    // 偏移:undefined 用 3(与配置默认同值),按 1/k 缩放保持视觉恒定
    const resolvedOutlineOffset = `calc(${outlineOffset ?? 3}px * ${invKVar})`;
    const bg = backgroundColor ?? 'rgba(255, 255, 255, 0.04)';
    // 判断是否为渐变值(包含 gradient 关键字)
    const isGradient = typeof bg === 'string' && bg.includes('gradient');
    // 圆角:支持 node.borderRadius 自定义,默认 8,按 1/k 缩放保持视觉恒定
    const radius = `calc(${borderRadius ?? 2}px * ${invKVar})`;
    // 透明度:node.opacity(0-1),undefined 用 1
    const resolvedOpacity = opacity ?? 1;

    return (
      <div
        data-canvas-group-id={isPreview ? undefined : groupId}
        data-canvas-group-preview={isPreview ? 'true' : undefined}
        onPointerDown={
          onGroupPointerDown
            ? (e) => onGroupPointerDown(e, groupId)
            : undefined
        }
        onDoubleClick={
          onGroupDoubleClick
            ? (e) => onGroupDoubleClick(e, groupId)
            : undefined
        }
        style={{
          position: 'absolute',
          left: bounds.x,
          top: bounds.y,
          width: bounds.width,
          height: bounds.height,
          boxSizing: 'border-box',
          pointerEvents: 'auto',
          borderRadius: radius,
          zIndex: GROUP_Z_INDEX,
          cursor: 'grab',
          opacity: 1,
        }}
      >
        {/* 背景层:磨砂玻璃效果,支持渐变背景 */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            ...(isGradient
              ? { background: `${bg} padding-box` }
              : { backgroundColor: bg }),
            // T5: 组数超阈值时关闭磨砂玻璃(合成层上限降级,视觉仅失去背景模糊)
            // blur 半径反缩放(世界固定 16px):缩放容器内固定屏幕半径会在放大时采样不足,
            // 背景呈像素块/马赛克;反缩放后任何缩放级别屏幕模糊半径恒定,采样比例恒定
            ...(blurDisabled
              ? {}
              : {
                  backdropFilter: `blur(calc(16px * ${invKVar}))`,
                  WebkitBackdropFilter: `blur(calc(16px * ${invKVar}))`,
                }),
            outline: `${resolvedOutlineWidth}px ${resolvedOutlineType} ${resolvedOutlineColor}`,
            outlineOffset: resolvedOutlineOffset,
            borderRadius: radius,
            opacity: resolvedOpacity,
            boxShadow: isSelected
              ? `0 0 0 calc(4px * ${invKVar}) rgba(233, 69, 96, 0.2)`
              : `0 calc(2px * ${invKVar}) calc(6px * ${invKVar}) rgba(0, 0, 0, 0.15)`,
            pointerEvents: 'none',
          }}
        />
        {/* 子节点计数徽标 — 右上角(磨砂玻璃风格,小尺寸) */}
        {childrenCount > 0 ? (
          <div
            style={{
              position: 'absolute',
              top: `calc(2px * ${invKVar})`,
              right: `calc(2px * ${invKVar})`,
              padding: `1px calc(5px * ${invKVar})`,
              borderRadius: `calc(6px * ${invKVar})`,
              backgroundColor: 'rgba(255, 255, 255, 0.12)',
              backdropFilter: `blur(calc(8px * ${invKVar}))`,
              WebkitBackdropFilter: `blur(calc(8px * ${invKVar}))`,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: `calc(7px * ${invKVar})`,
              fontWeight: 500,
              lineHeight: 1,
              pointerEvents: 'none',
              zIndex: 1,
              whiteSpace: 'nowrap',
            }}
          >
            {childrenCount}个节点
          </div>
        ) : null}
        {/* 标题栏 — 渲染在轮廓边缘上方(不在组内) */}
        <div
          style={{
            position: 'absolute',
            top: `calc(-${GROUP_TITLE_HEIGHT + 2}px * ${invKVar})`,
            left: 0,
            right: 0,
            height: `calc(${GROUP_TITLE_HEIGHT}px * ${invKVar})`,
            padding: `0 calc(8px * ${invKVar})`,
            display: 'flex',
            alignItems: 'center',
            // 征集 #87 验收轮三:组标题基准 11→10px(用户要求缩小)
            fontSize: `calc(10px * ${invKVar})`,
            color: groupDefaults?.titleColor ?? (isSelected ? 'rgba(233, 69, 96, 0.95)' : (isLight ? '#1c1917' : 'rgba(245, 245, 244, 0.9)')),
            fontWeight: 600,
            userSelect: 'none',
            pointerEvents: 'none',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            background: 'var(--zeroexo-canvas-bg, transparent)',
          }}
        >
          {isRenaming ? (
            <input
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              value={renameValue}
              onChange={(e) => onRenameChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onRenameCommit?.();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onRenameCancel?.();
                }
              }}
              onBlur={() => onRenameCommit?.()}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                height: '100%',
                fontSize: `calc(11px * ${invKVar})`,
                background: 'rgba(30, 40, 60, 0.95)',
                border: `calc(1px * ${invKVar}) solid rgba(100, 180, 255, 0.8)`,
                borderRadius: `calc(3px * ${invKVar})`,
                color: '#e0e8f0',
                padding: `0 calc(4px * ${invKVar})`,
                outline: 'none',
                pointerEvents: 'auto',
              }}
            />
          ) : title.trim() ? (
            <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: `calc(4px * ${invKVar})` }}>
              <span
                style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'auto', cursor: 'text' }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onTitleDoubleClick?.(groupId);
                }}
              >
                {title}
              </span>
              {showVersionFolderFold && onVersionFolderFold ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onVersionFolderFold(groupId); }}
                  title="折叠为叠卡预览"
                  style={{
                    flexShrink: 0,
                    width: `calc(16px * ${invKVar})`,
                    height: `calc(16px * ${invKVar})`,
                    borderRadius: `calc(3px * ${invKVar})`,
                    border: 'none',
                    background: 'rgba(255,255,255,0.1)',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    padding: 0,
                    fontSize: `calc(10px * ${invKVar})`,
                    lineHeight: 1,
                    pointerEvents: 'auto',
                  }}
                >
                  ⊟
                </button>
              ) : null}
            </div>
          ) : (
            <span style={{ opacity: 0.4, fontStyle: 'italic' }}>Group</span>
          )}
        </div>
        {/* resize handles: 选中正式组时显示 8 角点白圆 */}
        {!isPreview && isSelected && onResizeHandlePointerDown
          ? GROUP_HANDLE_DEFS.map(({ type, cursor }) => (
              <GroupResizeHandle
                key={type}
                type={type}
                cursor={cursor}
                onPointerDown={(e) => onResizeHandlePointerDown(e, groupId, type)}
              />
            ))
          : null}
        {/* group 聚合 pin: 左侧 input + 右侧 output,仅选中或拖拽连线时显示 */}
        {!isPreview && (isSelected || forceShowPins) ? (
          <>
            <GroupPin
              groupId={groupId}
              pinId={GROUP_INPUT_PIN_ID}
              direction="input"
              onPointerDown={onGroupPinPointerDown}
              onPointerEnter={onGroupPinPointerEnter}
              onPointerLeave={onGroupPinPointerLeave}
            />
            <GroupPin
              groupId={groupId}
              pinId={GROUP_OUTPUT_PIN_ID}
              direction="output"
              onPointerDown={onGroupPinPointerDown}
              onPointerEnter={onGroupPinPointerEnter}
              onPointerLeave={onGroupPinPointerLeave}
            />
          </>
        ) : null}
      </div>
    );
  },
  (prev, next) =>
    prev.groupId === next.groupId &&
    prev.title === next.title &&
    prev.bounds === next.bounds &&
    prev.childrenCount === next.childrenCount &&
    prev.backgroundColor === next.backgroundColor &&
    prev.borderRadius === next.borderRadius &&
    prev.outlineColor === next.outlineColor &&
    prev.outlineWidth === next.outlineWidth &&
    prev.outlineType === next.outlineType &&
    prev.outlineOffset === next.outlineOffset &&
    prev.opacity === next.opacity &&
    prev.isSelected === next.isSelected &&
    prev.isPreview === next.isPreview &&
    prev.blurDisabled === next.blurDisabled &&
    prev.isRenaming === next.isRenaming &&
    prev.renameValue === next.renameValue &&
    prev.showVersionFolderFold === next.showVersionFolderFold &&
    prev.onVersionFolderFold === next.onVersionFolderFold &&
    prev.onGroupPointerDown === next.onGroupPointerDown &&
    prev.onGroupDoubleClick === next.onGroupDoubleClick &&
    prev.onTitleDoubleClick === next.onTitleDoubleClick &&
    prev.onRenameChange === next.onRenameChange &&
    prev.onRenameCommit === next.onRenameCommit &&
    prev.onRenameCancel === next.onRenameCancel &&
    prev.onResizeHandlePointerDown === next.onResizeHandlePointerDown &&
    prev.onGroupPinPointerDown === next.onGroupPinPointerDown &&
    prev.onGroupPinPointerEnter === next.onGroupPinPointerEnter &&
    prev.onGroupPinPointerLeave === next.onGroupPinPointerLeave &&
    prev.forceShowPins === next.forceShowPins,
);
