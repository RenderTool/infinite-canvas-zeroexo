/**
 * SelectionController - 选择控制器
 * 处理: 框选(Marquee)状态机 + 命中检测
 *
 * 工作流:
 * 1. 用户在空白处 pointerdown → beginMarquee(世界坐标)
 * 2. pointermove → updateMarquee(世界坐标),实时命中检测
 * 3. pointerup → endMarquee,应用最终选择到 store
 *
 * 不依赖 React,可在任意框架使用。框选状态通过 subscribe 暴露。
 */

import type { ReactGraphStore } from '@zeroexo/plugin-render-react';

/** 框选矩形(世界坐标) */
export interface MarqueeRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export class SelectionController {
  private marquee: MarqueeRect | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private store: ReactGraphStore,
  ) {}

  // ===== 框选状态订阅 =====

  getMarquee = (): MarqueeRect | null => this.marquee;
  subscribeMarquee = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private notify = (): void => {
    this.listeners.forEach((l) => l());
  };

  // ===== 框选操作 =====

  /** 开始框选(世界坐标) */
  beginMarquee = (worldX: number, worldY: number): void => {
    this.marquee = { startX: worldX, startY: worldY, currentX: worldX, currentY: worldY };
    this.notify();
  };

  /** 更新框选终点(世界坐标) */
  updateMarquee = (worldX: number, worldY: number): void => {
    if (!this.marquee) return;
    this.marquee = { ...this.marquee, currentX: worldX, currentY: worldY };
    this.notify();
  };

  /**
   * 结束框选,应用选择到 store
   * @param additive 是否追加(Shift 键)
   * @returns 命中的节点 id 集合
   */
  endMarquee = (additive: boolean): Set<string> => {
    const hit = this.hitTest();
    const existing = additive ? this.store.getSelection().selectedNodeIds : new Set<string>();
    const next = new Set([...existing, ...hit]);
    this.store.setSelection({ selectedNodeIds: next, selectedEdgeIds: new Set() });
    this.marquee = null;
    this.notify();
    return hit;
  };

  /** 取消框选(不应用选择) */
  cancelMarquee = (): void => {
    this.marquee = null;
    this.notify();
  };

  /** 命中检测: 返回与框选矩形相交的节点 id 集合 */
  hitTest = (): Set<string> => {
    if (!this.marquee) return new Set();
    const rect = this.normalizeRect(this.marquee);
    // P1-5: 使用网格空间索引 O(Gq+H) 替代 O(N) 全量遍历
    // queryRect 内部已执行精确 AABB 过滤,无需额外去重
    return this.store.getSpatialIndex().queryRect(rect.minX, rect.minY, rect.maxX, rect.maxY);
  };

  // ===== 内部方法 =====

  private normalizeRect(m: MarqueeRect): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    return {
      minX: Math.min(m.startX, m.currentX),
      minY: Math.min(m.startY, m.currentY),
      maxX: Math.max(m.startX, m.currentX),
      maxY: Math.max(m.startY, m.currentY),
    };
  }
}
