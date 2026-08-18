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
  /** 外轮廓偏移(世界坐标像素;正值向外扩,负值向内缩;undefined 用 0) */
  outlineOffset: number | undefined;
  /** 不透明度(0-1;undefined 用 1) */
  opacity: number | undefined;
  isSelected: boolean;
  isPreview: boolean;
  invK: number; // 1/viewport.k,用于视觉属性缩放
  isRenaming?: boolean;
  renameValue?: string;
  /** 是否显示版本文件夹折叠按钮 */
  showVersionFolderFold?: boolean;
  /** 版本文件夹折叠回调(切回叠卡模式) */
  onVersionFolderFold?: (groupId: string) => void;
  onGroupPointerDown?: (e: React.PointerEvent, groupId: string) => void;
  onGroupDoubleClick?: (e: React.MouseEvent, groupId: string) => void;
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
    outlineOffset,
    opacity,
    isSelected,
    isPreview,
    invK,
    isRenaming,
    renameValue,
    onGroupPointerDown,
    onGroupDoubleClick,
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
    const resolvedOutlineColor = outlineColor ?? groupDefaults?.outlineColor ?? (isSelected
      ? 'rgba(233, 69, 96, 0.9)'
      : 'rgba(120, 160, 220, 0.6)');
    // 厚度:node.outlineWidth 自定义,默认 2,按 1/k 缩放保持视觉恒定
    const resolvedOutlineWidth = (outlineWidth ?? 2) * invK;
    const resolvedOutlineOffset = (outlineOffset ?? 0) * invK;
    const bg = backgroundColor ?? 'rgba(255, 255, 255, 0.04)';
    // 判断是否为渐变值(包含 gradient 关键字)
    const isGradient = typeof bg === 'string' && bg.includes('gradient');
    // 圆角:支持 node.borderRadius 自定义,默认 8,按 1/k 缩放保持视觉恒定
    const radius = (borderRadius ?? 2) * invK;
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
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            outline: `${resolvedOutlineWidth}px dashed ${resolvedOutlineColor}`,
            outlineOffset: resolvedOutlineOffset,
            borderRadius: radius,
            opacity: resolvedOpacity,
            boxShadow: isSelected
              ? `0 0 0 ${4 * invK}px rgba(233, 69, 96, 0.2)`
              : `0 ${2 * invK}px ${6 * invK}px rgba(0, 0, 0, 0.15)`,
            pointerEvents: 'none',
          }}
        />
        {/* 子节点计数徽标 — 右上角(磨砂玻璃风格,小尺寸) */}
        {childrenCount > 0 ? (
          <div
            style={{
              position: 'absolute',
              top: 2 * invK,
              right: 2 * invK,
              padding: `1px ${5 * invK}px`,
              borderRadius: 6 * invK,
              backgroundColor: 'rgba(255, 255, 255, 0.12)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 8 * invK,
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
            top: -(GROUP_TITLE_HEIGHT * invK) - 2 * invK,
            left: 0,
            right: 0,
            height: GROUP_TITLE_HEIGHT * invK,
            padding: `0 ${8 * invK}px`,
            display: 'flex',
            alignItems: 'center',
            fontSize: 11 * invK,
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
                fontSize: 12 * invK,
                background: 'rgba(30, 40, 60, 0.95)',
                border: `${1 * invK}px solid rgba(100, 180, 255, 0.8)`,
                borderRadius: 3 * invK,
                color: '#e0e8f0',
                padding: `0 ${4 * invK}px`,
                outline: 'none',
                pointerEvents: 'auto',
              }}
            />
          ) : title.trim() ? (
            <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 4 * invK }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
              {showVersionFolderFold && onVersionFolderFold ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onVersionFolderFold(groupId); }}
                  title="折叠为叠卡预览"
                  style={{
                    flexShrink: 0,
                    width: 16 * invK,
                    height: 16 * invK,
                    borderRadius: 3 * invK,
                    border: 'none',
                    background: 'rgba(255,255,255,0.1)',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    padding: 0,
                    fontSize: 10 * invK,
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
                invK={invK}
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
    prev.outlineOffset === next.outlineOffset &&
    prev.opacity === next.opacity &&
    prev.isSelected === next.isSelected &&
    prev.isPreview === next.isPreview &&
    prev.invK === next.invK &&
    prev.isRenaming === next.isRenaming &&
    prev.renameValue === next.renameValue &&
    prev.showVersionFolderFold === next.showVersionFolderFold &&
    prev.onVersionFolderFold === next.onVersionFolderFold &&
    prev.onGroupPointerDown === next.onGroupPointerDown &&
    prev.onGroupDoubleClick === next.onGroupDoubleClick &&
    prev.onRenameChange === next.onRenameChange &&
    prev.onRenameCommit === next.onRenameCommit &&
    prev.onRenameCancel === next.onRenameCancel &&
    prev.onResizeHandlePointerDown === next.onResizeHandlePointerDown &&
    prev.onGroupPinPointerDown === next.onGroupPinPointerDown &&
    prev.onGroupPinPointerEnter === next.onGroupPinPointerEnter &&
    prev.onGroupPinPointerLeave === next.onGroupPinPointerLeave,
);
