/**
 * PinDefaults - 全局 Pin 默认配置 Context
 *
 * 三层优先级(高 → 低):
 *   1. 节点级覆盖: node.pinColor / node.pinShape / node.pinSize
 *   2. 全局默认: PinDefaultsContext.value(本文件)
 *   3. Pin 级/pin 自带: pin.color / pin.shape / pin.size / dataType 内置色
 *
 * 用 PinDefaultsProvider 包裹画布,所有 NodeShell/EdgeLayer 读取此 context。
 * 未 provide 时使用空默认(等价于 undefined,回退到 pin 级)。
 */

import React from 'react';

/** 全局 Pin 默认配置 */
export interface PinDefaults {
  /** 默认 Pin 颜色(支持 rgba;undefined 时 pin.color/dataType 决定) */
  color?: string;
  /** 默认 Pin 形状('circle'|'square';undefined 用 'circle') */
  shape?: 'circle' | 'square';
  /** 默认 Pin 尺寸(像素;undefined 用 14,与配置默认 pinSize 同值) */
  size?: number;
  /** 默认 Pin 透明度(0-1;undefined 用 1) */
  opacity?: number;
}

/** 默认值(空,等价于全 undefined,回退到 pin 级) */
const DEFAULT_VALUE: PinDefaults = {};

const PinDefaultsContext = React.createContext<PinDefaults>(DEFAULT_VALUE);

/** Provider: 包裹画布,提供全局 Pin 默认配置 */
export const PinDefaultsProvider = PinDefaultsContext.Provider;

/** Hook: 读取全局 Pin 默认配置(在 NodeShell/EdgeLayer 中使用) */
export function usePinDefaults(): PinDefaults {
  return React.useContext(PinDefaultsContext);
}

// ===== NodeDefaults - 全局 Node 默认样式 Context =====
//
// 与 GroupDefaults 对称:三层优先级(高 → 低):
//   1. 节点级覆盖: node.borderRadius / node.outlineWidth / node.outlineColor / node.backgroundColor / node.nodeColor
//   2. 全局默认: NodeDefaultsContext.value(本文件,由 app 层从 canvasConfig + theme 注入)
//   3. NodeShell/DefaultNodeContent 内置硬编码默认
//
// 用 NodeDefaultsProvider 包裹画布,NodeShell/NodeLayer 读取此 context。
// 未 provide 时使用空默认(等价于 undefined,回退到内置硬编码)。
//
// 设计:render-react 不依赖 plugin-theme,故颜色 token(outlineColor/fillColor 等)
// 由 app 层从 theme.node 读取后注入,保持 render-react 与 theme 解耦。

/** 全局 Node 默认样式 */
export interface NodeDefaults {
  /** 默认圆角(世界坐标像素;undefined 时 NodeShell 回退到 2,与配置默认 nodeBorderRadius 同值) */
  borderRadius?: number;
  /** 默认外轮廓厚度(世界坐标像素;undefined 时 NodeShell 回退到 0 = 无常驻描边) */
  outlineWidth?: number;
  /** 默认外轮廓颜色(非选中;undefined 时 NodeShell 回退到内置默认) */
  outlineColor?: string;
  /** 选中态外轮廓颜色(undefined 时 NodeShell 回退到内置默认 #e94560) */
  outlineSelectedColor?: string;
  /** 默认底色(undefined 时 NodeShell 回退到 color prop / 内置默认) */
  fillColor?: string;
  /** 标题栏颜色(未选中;undefined 时 NodeShell 回退到内置默认) */
  titleColor?: string;
  /** 标题栏选中态颜色(undefined 时 NodeShell 回退到内置默认) */
  titleSelectedColor?: string;
  /** 内容区文本颜色(undefined 时 NodeShell 回退到内置默认) */
  contentTextColor?: string;
  /** 标题栏底色(undefined 时 NodeShell 回退到 canvas 背景色) */
  titleBackground?: string;
}

/** 默认值(空,等价于全 undefined,回退到 NodeShell 内置硬编码默认) */
const NODE_DEFAULT_VALUE: NodeDefaults = {};

const NodeDefaultsContext = React.createContext<NodeDefaults>(NODE_DEFAULT_VALUE);

/** Provider: 包裹画布,提供全局 Node 默认样式(由 EditorPage 从 canvasConfig + theme 注入) */
export const NodeDefaultsProvider = NodeDefaultsContext.Provider;

/** Hook: 读取全局 Node 默认样式(在 NodeShell/NodeLayer 中使用,渲染节点时作为回退值) */
export function useNodeDefaults(): NodeDefaults {
  return React.useContext(NodeDefaultsContext);
}
