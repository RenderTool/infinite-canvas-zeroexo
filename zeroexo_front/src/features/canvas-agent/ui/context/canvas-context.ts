/**
 * canvas-agent/ui/context/canvas-context.ts — 画布上下文
 *
 * 提供画布节点引用、画布操作等上下文。
 * 在 M2 第二阶段集成 CanvasOpBridge 时扩展。
 */

import { createContext, useContext } from 'react';
import type { Reference } from '../types.js';

export interface CanvasContextValue {
  /** 获取画布节点列表（用于 @ 提及搜索；storageKey 供媒体节点解析缩略图） */
  getNodes: () => { id: string; title: string; type: string; storageKey?: string }[];
  /** 添加引用到画布 */
  addReference?: (ref: Reference) => void;
  /** 获取当前选中节点 */
  getSelectedNodeId: () => string | null;
}

const CanvasContext = createContext<CanvasContextValue | null>(null);

export function useCanvasContext(): CanvasContextValue {
  const ctx = useContext(CanvasContext);
  if (!ctx) {
    // 提供默认实现，避免在 Provider 外使用时报错
    return {
      getNodes: () => [],
      getSelectedNodeId: () => null,
    };
  }
  return ctx;
}

export const CanvasContextProvider = CanvasContext.Provider;