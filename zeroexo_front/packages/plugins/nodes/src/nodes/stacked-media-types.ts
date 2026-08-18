/**
 * StackNode 资源浏览器类型定义
 *
 * StackNode 是一个资源浏览器节点，专门收纳离散资源（image/video/audio）。
 * 类似相册/图集——把 N 张图堆叠在一起，用户翻页查看，
 * 生成器连入时结果自动追加到卡片堆中，输出时所有卡片作为整体参考素材传递给下游。
 */

import type { ToolContext } from '@zeroexo/core';

/** 堆叠卡片中的源类型。视图按 capability 选择对应的预览器。 */
export type StackMediaType = 'image' | 'video' | 'audio' | 'text' | 'storyboard' | 'script' | 'custom';

/** 单张堆叠卡片 */
export interface StackCard {
  /** 唯一标识 */
  id: string;
  /** 原始节点类型 */
  sourceType: StackMediaType;
  /** 被收纳前的源节点 id，仅用于追踪和 Agent/Debug，不要求节点仍存在。 */
  sourceNodeId?: string;
  /** 原始节点数据（拷贝自原节点 data） */
  data: Record<string, unknown>;
  /** 原始节点标题 */
  title?: string;
  /** 原始节点尺寸 */
  size?: { width: number; height: number };
  /** 是否星标 */
  starred?: boolean;
}

/** StackNode 节点数据 */
export interface StackedMediaData {
  /** 卡片列表（有序） */
  cards: StackCard[];
  /** 当前活跃卡片索引 */
  activeIndex: number;
  /** 继承自原节点的 pin 引用 */
  metadata?: Record<string, unknown>;
}

/** 创建 StackNode 默认数据 */
export function createStackedMediaDefaultData(): StackedMediaData {
  return {
    cards: [],
    activeIndex: 0,
  };
}

/** 从当前 schema 解析 StackedMediaData。 */
export function parseStackedMediaData(data: Record<string, unknown> | undefined): StackedMediaData {
  if (!data) return createStackedMediaDefaultData();
  const cards = (data.cards as StackCard[] | undefined) ?? [];
  const activeIndex = (data.activeIndex as number | undefined) ?? 0;
  return { cards, activeIndex };
}

/** 堆叠媒体工具操作类型 */
export type StackedMediaToolAction = 'remove' | 'add';

/** 堆叠媒体工具上下文 */
export interface StackedMediaToolContext {
  /** 标准工具上下文 */
  toolContext: ToolContext;
  /** 当前节点 id */
  nodeId: string;
  /** 当前节点位置 */
  nodePosition: { x: number; y: number };
  /** 当前卡片数据 */
  cards: StackCard[];
  /** 当前活跃卡片索引 */
  activeIndex: number;
}
