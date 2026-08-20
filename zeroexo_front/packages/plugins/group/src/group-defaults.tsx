/**
 * GroupDefaults - 全局 Group 默认样式 Context
 *
 * 二层优先级(高 → 低):
 *   1. 节点级覆盖: node.outlineColor / node.outlineWidth / ... / node.backgroundColor / node.borderRadius
 *   2. 全局默认: GroupDefaultsContext.value(本文件)
 *
 * 用 GroupDefaultsProvider 包裹画布,GroupLayer 读取此 context 作为回退默认值。
 * 未 provide 时使用空默认(等价于 undefined,回退到 GroupItem 内置硬编码默认)。
 *
 * 与 render-react 的 PinDefaults 对称:都是"全局默认 + 节点级覆盖"二层模型,
 * 由 app 层从 canvasConfig 注入,保证 ConfigDialog 调参实时生效。
 */

import React from 'react';

/** 全局 Group 默认样式 */
export interface GroupDefaults {
  /** 默认背景色(支持 rgba 含 A 通道;undefined 时 GroupItem 回退到内置默认) */
  backgroundColor?: string;
  /** 默认圆角(世界坐标像素;undefined 时 GroupItem 回退到 2,与配置默认 groupBorderRadius 同值) */
  borderRadius?: number;
  /** 默认外轮廓颜色(支持 rgba 透明;undefined 时 GroupItem 回退到选中红 0.9/未选中红 0.5(与配置默认同值)) */
  outlineColor?: string;
  /** 默认外轮廓厚度(世界坐标像素;undefined 时 GroupItem 回退到 1,与配置默认 groupOutlineWidth 同值) */
  outlineWidth?: number;
  /** 默认外轮廓类型(undefined 时 GroupItem 回退到 dashed) */
  outlineType?: 'solid' | 'dashed';
  /** 默认外轮廓偏移(世界坐标像素;undefined 时 GroupItem 回退到 3,与配置默认 groupOutlineOffset 同值) */
  outlineOffset?: number;
  /** 默认不透明度(0-1;undefined 时 GroupItem 回退到 1) */
  opacity?: number;
  /** 默认标题颜色(undefined 时 GroupItem 回退到 isLight 驱动的内置默认) */
  titleColor?: string;
}

/** 默认值(空,等价于全 undefined,回退到 GroupItem 内置硬编码默认) */
const DEFAULT_VALUE: GroupDefaults = {};

const GroupDefaultsContext = React.createContext<GroupDefaults>(DEFAULT_VALUE);

/** Provider: 包裹画布,提供全局 Group 默认样式(由 EditorPage 从 canvasConfig 注入) */
export const GroupDefaultsProvider = GroupDefaultsContext.Provider;

/** Hook: 读取全局 Group 默认样式(在 GroupLayer 中使用,渲染 GroupItem 时作为回退值) */
export function useGroupDefaults(): GroupDefaults {
  return React.useContext(GroupDefaultsContext);
}
