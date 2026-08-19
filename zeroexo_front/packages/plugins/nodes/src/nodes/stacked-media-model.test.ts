import { describe, expect, it } from 'vitest';
import type { GraphModel, NodeRecord, EdgeRecord } from '@zeroexo/core';
import { activateStackCard, getStackDisplayHeight, stackSelectedNodes } from './stacked-media-model.js';

const context = { eventBus: { emit: () => undefined } } as never;

function createStackNode(): NodeRecord {
  return {
    id: 'stack',
    type: 'stacked-media',
    position: { x: 80, y: 120 },
    size: { width: 500, height: 404 },
    data: {},
  };
}

function createGraph(node: NodeRecord): GraphModel {
  return { nodes: [node], edges: [], viewport: { x: 0, y: 0, k: 1 }, metadata: {} };
}

describe('StackNode model', () => {
  it('uses the fixed image display baseline plus navigation', () => {
    expect(getStackDisplayHeight({ id: 'wide', sourceType: 'image', data: { naturalWidth: 1000, naturalHeight: 500 } }, 500)).toBe(404);
    expect(getStackDisplayHeight({ id: 'invalid', sourceType: 'image', data: {} }, 500)).toBe(404);
  });

  it('switches active card without moving the stage', () => {
    const node = createStackNode();
    const data = {
      activeIndex: 0,
      cards: [
        { id: 'landscape', sourceType: 'image' as const, data: { naturalWidth: 1000, naturalHeight: 500 } },
        { id: 'portrait', sourceType: 'image' as const, data: { naturalWidth: 500, naturalHeight: 1000 } },
      ],
    };
    const result = activateStackCard(node, data, 1);
    const after = result.command.execute(createGraph(node), context);
    const stack = after.nodes[0]!;

    expect((stack.data as { activeIndex: number }).activeIndex).toBe(1);
    expect(stack.size).toEqual({ width: 500, height: 404 });
    expect(result.command.undo(after, context)).toEqual(createGraph(node));
  });

  it('stacks selected nodes atomically and skips unsupported ones', () => {
    const image: NodeRecord = { id: 'img1', type: 'image', position: { x: 0, y: 0 }, size: { width: 620, height: 348 }, title: '图1', data: { content: 'blob:x' } };
    const video: NodeRecord = { id: 'vid1', type: 'video', position: { x: 0, y: 100 }, size: { width: 620, height: 348 }, title: '视频1', data: { content: 'blob:y' } };
    const generator: NodeRecord = { id: 'gen1', type: 'generator', position: { x: 0, y: 200 }, size: { width: 300, height: 200 }, title: '生成器', data: {} };
    const down: NodeRecord = { id: 'text1', type: 'text', position: { x: 800, y: 0 }, size: { width: 200, height: 80 }, title: '下游', data: {} };
    const edge: EdgeRecord = { id: 'e1', source: { nodeId: 'img1', pinId: 'image' }, target: { nodeId: 'text1', pinId: 'input' } };
    const graph: GraphModel = { nodes: [image, video, generator, down], edges: [edge], viewport: { x: 0, y: 0, k: 1 }, metadata: {} };

    const isStackable = (n: NodeRecord): boolean => n.type !== 'generator' && n.type !== 'group';
    const result = stackSelectedNodes({ x: 800, y: 0 }, [image, video, generator], { edges: graph.edges }, isStackable);
    expect(result).not.toBeNull();
    const after = result!.command.execute(graph, context);

    // 新 StackNode 收纳 2 张卡片,生成器保持原位
    const stackNode = after.nodes.find((n) => n.id === result!.stackNodeId)!;
    const cards = (stackNode.data as { cards: unknown[] }).cards;
    expect(cards.length).toBe(2);
    expect(cards[0]).toMatchObject({ sourceNodeId: 'img1' });
    expect(cards[1]).toMatchObject({ sourceNodeId: 'vid1' });
    expect(after.nodes.some((n) => n.id === 'gen1')).toBe(true);
    expect(after.nodes.some((n) => n.id === 'img1')).toBe(false);
    // 源节点下游边转移到新 StackNode,避免悬挂边
    expect(after.edges.some((e) => e.source.nodeId === result!.stackNodeId && e.target.nodeId === 'text1')).toBe(true);
    expect(after.edges.some((e) => e.source.nodeId === 'img1')).toBe(false);
    // 摘要
    expect(result!.collectedCount).toBe(2);
    expect(result!.skippedCount).toBe(1);
    expect(result!.skippedIds).toEqual(['gen1']);
    // 一次 undo 完整还原(节点恢复顺序与原始不同,按 id 排序后深比较)
    const restored = result!.command.undo(after, context);
    const byId = <T extends { id: string }>(items: T[]): T[] => [...items].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(restored.nodes)).toEqual(byId(graph.nodes));
    expect(byId(restored.edges)).toEqual(byId(graph.edges));
  });

  it('flattens source stack cards into the new stack and rebases downstream edges', () => {
    const srcStack: NodeRecord = {
      id: 'stack-src', type: 'stacked-media', position: { x: 0, y: 0 }, size: { width: 500, height: 404 }, title: '源堆叠',
      data: { cards: [{ id: 'c1', sourceType: 'image', data: { content: 'blob:a' } }, { id: 'c2', sourceType: 'video', data: { content: 'blob:b' } }], activeIndex: 0 },
    };
    const gen: NodeRecord = { id: 'gen2', type: 'generator', position: { x: 700, y: 0 }, size: { width: 300, height: 200 }, title: '下游生成器', data: {} };
    const edge: EdgeRecord = { id: 'e2', source: { nodeId: 'stack-src', pinId: 'media' }, target: { nodeId: 'gen2', pinId: 'prompt' } };
    const graph: GraphModel = { nodes: [srcStack, gen], edges: [edge], viewport: { x: 0, y: 0, k: 1 }, metadata: {} };

    const isStackable = (n: NodeRecord): boolean => n.type !== 'generator' && n.type !== 'group';
    const result = stackSelectedNodes({ x: 800, y: 0 }, [srcStack], { edges: graph.edges }, isStackable);
    const after = result!.command.execute(graph, context);

    const stackNode = after.nodes.find((n) => n.id === result!.stackNodeId)!;
    const cards = (stackNode.data as { cards: Array<{ sourceType: string }> }).cards;
    expect(cards.map((c) => c.sourceType)).toEqual(['image', 'video']);
    expect(after.nodes.some((n) => n.id === 'stack-src')).toBe(false);
    // 下游边转移:源 Stack → 新 Stack
    expect(after.edges.some((e) => e.source.nodeId === result!.stackNodeId && e.target.nodeId === 'gen2')).toBe(true);
    expect(after.edges.some((e) => e.source.nodeId === 'stack-src')).toBe(false);
  });
});
