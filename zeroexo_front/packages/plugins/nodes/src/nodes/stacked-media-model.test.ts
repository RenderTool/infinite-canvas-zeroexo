import { describe, expect, it } from 'vitest';
import type { GraphModel, NodeRecord } from '@zeroexo/core';
import { activateStackCard, getStackDisplayHeight } from './stacked-media-model.js';

const context = { eventBus: { emit: () => undefined } } as never;

function createStackNode(): NodeRecord {
  return {
    id: 'stack',
    type: 'stacked-media',
    position: { x: 80, y: 120 },
    size: { width: 500, height: 337 },
    data: {},
  };
}

function createGraph(node: NodeRecord): GraphModel {
  return { nodes: [node], edges: [], viewport: { x: 0, y: 0, k: 1 }, metadata: {} };
}

describe('StackNode model', () => {
  it('derives height from active media ratio plus navigation', () => {
    expect(getStackDisplayHeight({ id: 'wide', sourceType: 'image', data: { naturalWidth: 1000, naturalHeight: 500 } }, 500)).toBe(306);
    expect(getStackDisplayHeight({ id: 'invalid', sourceType: 'image', data: {} }, 500)).toBeNull();
  });

  it('switches active card and resizes in one undoable command', () => {
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
    expect(stack.size).toEqual({ width: 500, height: 1056 });
    expect(result.command.undo(after, context)).toEqual(createGraph(node));
  });
});
