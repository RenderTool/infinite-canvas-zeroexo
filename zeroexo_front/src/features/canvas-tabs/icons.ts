/**
 * canvas-tabs/icons.ts — 顶部页签类型图标映射
 *
 * 遵循经验 #19（interaction-metadata-mapping）：新增图标一律走模块级 icons.ts Map，
 * 禁止在组件内散落内联 lucide。
 *
 * 契约铁律：页签图标必须与画布节点左上角 / 层级面板的「节点类型图标」同源，
 * 见 creation-node-view.tsx（script=FileText / storyboard=Aperture / workbench=Film）
 * 与 hierarchy-list-view.tsx getTypeIcon（同一套映射）。
 * 新增资源页签类型时必须同步这两处与下面的 Map，避免页签图标与节点图标不一致。
 */
import { FileText, Aperture, Film, ClipboardList, type LucideIcon } from 'lucide-react';
import type { CanvasTabKind } from './canvas-tab-store.js';

/** 页签类型 → Lucide 图标 */
export const CANVAS_TAB_ICONS: Record<CanvasTabKind, LucideIcon> = {
  /** 剧本（与 script 节点同款） */
  script: FileText,
  /** 分镜（与 storyboard 节点同款） */
  storyboard: Aperture,
  /** 出片（与 workbench 节点同款 Film） */
  workbench: Film,
  /** 制作计划（Plan#51，非画布节点类型，取清单语义图标） */
  plan: ClipboardList,
};
