/**
 * StackNode Model - 纯数据操作层(MVVM 试点)
 *
 * 视图层消费本模块构造命令,数据变换规则集中于此,无 React 依赖。
 * 每个操作返回「正向命令数组」,撤销由 commandQueue 的 undo 栈负责。
 */

import {
  AddNodeCommand,
  AddEdgeCommand,
  RemoveEdgeCommand,
  RemoveNodeCommand,
  UpdateNodeDataCommand,
  BatchCommand,
} from '@zeroexo/core';
import type { Command, NodeRecord, EdgeRecord } from '@zeroexo/core';
import type { StackedMediaData, StackCard } from './stacked-media-types.js';

/** 兄弟垂直队列间距 */
const SIBLING_GAP = 40;
/** 移出节点放置在 StackNode 前方的间距 */
const EJECT_OFFSET_X = 40;

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 单张卡片媒体源类型 */
export type StackMediaSource = 'image' | 'video';

export interface CollectResult {
  /** 正向命令(BatchCommand 打包) */
  command: BatchCommand;
  /** 更新后的卡片列表 */
  cards: StackCard[];
  /** 新卡片 id(供视图快照撤销用) */
  cardId: string;
}

/**
 * 收纳:把源节点(图片/视频)收纳为堆叠卡片
 * 正向:删边 + 更新堆叠数据 + 删源节点
 */
export function collectCard(
  nodeId: string,
  data: StackedMediaData,
  sourceNode: NodeRecord,
  edge: EdgeRecord,
): CollectResult {
  const card: StackCard = {
    id: genId('card'),
    sourceType: sourceNode.type as StackCard['sourceType'],
    sourceNodeId: sourceNode.id,
    data: (sourceNode.data as Record<string, unknown>) ?? {},
    title: sourceNode.title,
    size: sourceNode.size,
  };
  const cards = [...data.cards, card];
  return {
    command: new BatchCommand([
      new RemoveEdgeCommand(edge.id),
      new UpdateNodeDataCommand(nodeId, { cards, activeIndex: cards.length - 1 } as Record<string, unknown>),
      new RemoveNodeCommand(sourceNode.id),
    ], 'stacked-media-collect'),
    cards,
    cardId: card.id,
  };
}

export interface MergeStacksResult {
  command: BatchCommand;
  cards: StackCard[];
  activeIndex: number;
}

/** 合并 StackNode：源堆叠进入目标堆叠，目标节点拥有最终领域状态。 */
export function mergeStacks(
  targetNode: NodeRecord,
  targetData: StackedMediaData,
  sourceNode: NodeRecord,
  incomingEdge: EdgeRecord,
  graph: { edges: EdgeRecord[] },
): MergeStacksResult {
  const sourceData = (sourceNode.data ?? {}) as Record<string, unknown>;
  const sourceCards = (sourceData.cards as StackCard[] | undefined) ?? [];
  const cards = [...targetData.cards, ...sourceCards];
  const commands: Command[] = [
    new RemoveEdgeCommand(incomingEdge.id),
    new UpdateNodeDataCommand(targetNode.id, { cards, activeIndex: Math.max(0, cards.length - 1) } as Record<string, unknown>),
  ];

  // 源 Stack 的下游边转移到目标 Stack，避免合并时静默丢失图关系。
  for (const edge of graph.edges) {
    if (edge.source.nodeId !== sourceNode.id || edge.id === incomingEdge.id) continue;
    commands.push(new RemoveEdgeCommand(edge.id));
    commands.push(new AddEdgeCommand({
      ...edge,
      id: genId('merged-edge'),
      source: { ...edge.source, nodeId: targetNode.id },
    }));
  }
  commands.push(new RemoveNodeCommand(sourceNode.id));
  return {
    command: new BatchCommand(commands, 'stacked-media-merge'),
    cards,
    activeIndex: Math.max(0, cards.length - 1),
  };
}

export interface UndoCollectResult {
  command: BatchCommand;
  activeIndex: number;
}

/**
 * 撤销收纳:恢复源节点 + 连线 + 卡片列表(快照反向命令,不依赖 undo 栈,
 * 避免 5 秒窗口内其他操作污染撤销历史)
 */
export function undoCollect(
  nodeId: string,
  sourceNode: NodeRecord,
  edge: EdgeRecord,
  prevCards: StackCard[],
  prevActiveIndex: number,
): UndoCollectResult {
  const nextActive = Math.min(prevActiveIndex, Math.max(0, prevCards.length - 1));
  return {
    command: new BatchCommand([
      new UpdateNodeDataCommand(nodeId, { cards: prevCards, activeIndex: nextActive } as Record<string, unknown>),
      new AddNodeCommand(sourceNode),
      new AddEdgeCommand(edge),
    ], 'stacked-media-undo-collect'),
    activeIndex: nextActive,
  };
}

export interface EjectResult {
  command: BatchCommand;
  cards: StackCard[];
  activeIndex: number;
}

/** 移出:活跃卡片 → 断开关系的独立节点 + StackNode 前方垂直排序 */
export function ejectCard(
  commandQueue: { getState: () => { nodes: NodeRecord[]; edges: EdgeRecord[] } },
  node: NodeRecord,
  data: StackedMediaData,
  cardIndex: number,
): EjectResult | null {
  const card = data.cards[cardIndex];
  if (!card) return null;

  const graph = commandQueue.getState();
  const newCards = data.cards.filter((_, idx) => idx !== cardIndex);
  const newIndex = newCards.length === 0 ? 0 : Math.min(cardIndex, newCards.length - 1);

  const siblings = graph.edges
    .filter((e) => e.target.nodeId === node.id)
    .map((e) => graph.nodes.find((n) => n.id === e.source.nodeId))
    .filter((n): n is NodeRecord => !!n);
  const siblingBottom = siblings.length > 0
    ? Math.max(...siblings.map((s) => s.position.y + (s.size?.height ?? 0)))
    : node.position.y;
  const position = {
    x: node.position.x - (card.size?.width ?? 620) - EJECT_OFFSET_X,
    y: Math.max(node.position.y, siblingBottom + SIBLING_GAP),
  };

  const newNode: NodeRecord = {
    id: genId('stacked-ejected'),
    type: card.sourceType,
    title: card.title ?? '',
    position,
    size: card.size ?? { width: 620, height: 348 },
    data: { ...card.data },
  };
  return {
    command: new BatchCommand([
      new UpdateNodeDataCommand(node.id, { cards: newCards, activeIndex: newIndex } as Record<string, unknown>),
      new AddNodeCommand(newNode),
    ], 'stacked-media-eject'),
    cards: newCards,
    activeIndex: newIndex,
  };
}

export interface ReplaceResult {
  command: BatchCommand;
  cards: StackCard[];
}

/** 替换指定索引的卡片内容 */
export function replaceCardContent(
  nodeId: string,
  cards: StackCard[],
  cardIndex: number,
  newCard: StackCard,
): ReplaceResult {
  const next = cards.map((c, i) => (i === cardIndex ? newCard : c));
  return {
    command: new BatchCommand([
      new UpdateNodeDataCommand(nodeId, { cards: next } as Record<string, unknown>),
    ], 'stacked-media-replace'),
    cards: next,
  };
}

export interface AppendResult {
  command: BatchCommand;
  cards: StackCard[];
  activeIndex: number;
}

/** 追加多张卡片(空态上传入口),并跳到本次上传的第一张 */
export function appendCards(
  nodeId: string,
  cards: StackCard[],
  newCards: StackCard[],
): AppendResult {
  const next = [...cards, ...newCards];
  const nextActive = next.length - newCards.length;
  return {
    command: new BatchCommand([
      new UpdateNodeDataCommand(nodeId, { cards: next, activeIndex: nextActive } as Record<string, unknown>),
    ], 'stacked-media-append'),
    cards: next,
    activeIndex: nextActive,
  };
}

export interface SwitchResult {
  patch: { cards: StackCard[]; activeIndex: number };
}

/** 切换活跃卡片 */
export function switchActive(data: StackedMediaData, index: number): SwitchResult {
  return { patch: { cards: data.cards, activeIndex: index } };
}
