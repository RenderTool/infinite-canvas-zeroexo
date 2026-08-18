import { describe, it, expect } from 'vitest';
import {
  AddNodeCommand,
  RemoveNodeCommand,
  MoveNodeCommand,
  AddEdgeCommand,
  RemoveEdgeCommand,
  UpdateNodeDataCommand,
} from './builtins.js';
import type { GraphModel, NodeRecord, EdgeRecord } from '../model/types.js';

function makeGraph(nodes: NodeRecord[] = [], edges: EdgeRecord[] = []): GraphModel {
  return { nodes, edges, viewport: { x: 0, y: 0, k: 1 }, metadata: {} };
}

function makeNode(id: string, x = 0, y = 0, data?: unknown): NodeRecord {
  return { id, type: 'test', position: { x, y }, data };
}

function makeEdge(id: string): EdgeRecord {
  return { id, source: { nodeId: 'a' }, target: { nodeId: 'b' } };
}

const ctx = { eventBus: { emit: () => undefined } } as never;

describe('AddNodeCommand', () => {
  it('execute 添加节点', () => {
    const node = makeNode('n1');
    const cmd = new AddNodeCommand(node);
    const result = cmd.execute(makeGraph(), ctx);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toBe(node);
  });

  it('undo 移除节点', () => {
    const node = makeNode('n1');
    const cmd = new AddNodeCommand(node);
    const after = cmd.execute(makeGraph([node]), ctx);
    const restored = cmd.undo(after, ctx);
    expect(restored.nodes).toHaveLength(0);
  });
});

describe('RemoveNodeCommand', () => {
  it('execute 移除节点', () => {
    const node = makeNode('n1');
    const cmd = new RemoveNodeCommand('n1');
    const result = cmd.execute(makeGraph([node]), ctx);
    expect(result.nodes).toHaveLength(0);
  });

  it('undo 恢复被移除的节点', () => {
    const node = makeNode('n1');
    const cmd = new RemoveNodeCommand('n1');
    const after = cmd.execute(makeGraph([node]), ctx);
    const restored = cmd.undo(after, ctx);
    expect(restored.nodes).toHaveLength(1);
    expect(restored.nodes[0]).toBe(node);
  });

  it('节点不存在时 execute 不变,undo 无恢复', () => {
    const cmd = new RemoveNodeCommand('missing');
    const graph = makeGraph([makeNode('other')]);
    const result = cmd.execute(graph, ctx);
    expect(result.nodes).toHaveLength(1);
    const restored = cmd.undo(result, ctx);
    expect(restored.nodes).toHaveLength(1);
  });
});

describe('MoveNodeCommand', () => {
  it('execute 按 delta 移动节点', () => {
    const node = makeNode('n1', 10, 20);
    const cmd = new MoveNodeCommand('n1', { x: 5, y: -5 });
    const result = cmd.execute(makeGraph([node]), ctx);
    expect(result.nodes[0]!.position).toEqual({ x: 15, y: 15 });
  });

  it('undo 反向移动', () => {
    const node = makeNode('n1', 10, 20);
    const cmd = new MoveNodeCommand('n1', { x: 5, y: -5 });
    const after = cmd.execute(makeGraph([node]), ctx);
    const restored = cmd.undo(after, ctx);
    expect(restored.nodes[0]!.position).toEqual({ x: 10, y: 20 });
  });

  it('节点不存在时 execute 不变', () => {
    const cmd = new MoveNodeCommand('missing', { x: 1, y: 1 });
    const graph = makeGraph([makeNode('other', 0, 0)]);
    const result = cmd.execute(graph, ctx);
    expect(result.nodes[0]!.position).toEqual({ x: 0, y: 0 });
  });
});

describe('AddEdgeCommand', () => {
  it('execute 添加边', () => {
    const edge = makeEdge('e1');
    const cmd = new AddEdgeCommand(edge);
    const result = cmd.execute(makeGraph([], []), ctx);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toBe(edge);
  });

  it('undo 移除边', () => {
    const edge = makeEdge('e1');
    const cmd = new AddEdgeCommand(edge);
    const after = cmd.execute(makeGraph([], [edge]), ctx);
    const restored = cmd.undo(after, ctx);
    expect(restored.edges).toHaveLength(0);
  });
});

describe('RemoveEdgeCommand', () => {
  it('execute 移除边', () => {
    const edge = makeEdge('e1');
    const cmd = new RemoveEdgeCommand('e1');
    const result = cmd.execute(makeGraph([], [edge]), ctx);
    expect(result.edges).toHaveLength(0);
  });

  it('undo 恢复被移除的边', () => {
    const edge = makeEdge('e1');
    const cmd = new RemoveEdgeCommand('e1');
    const after = cmd.execute(makeGraph([], [edge]), ctx);
    const restored = cmd.undo(after, ctx);
    expect(restored.edges).toHaveLength(1);
    expect(restored.edges[0]).toBe(edge);
  });

  it('边不存在时 execute 不变,undo 无恢复', () => {
    const cmd = new RemoveEdgeCommand('missing');
    const graph = makeGraph([], [makeEdge('other')]);
    const result = cmd.execute(graph, ctx);
    expect(result.edges).toHaveLength(1);
    const restored = cmd.undo(result, ctx);
    expect(restored.edges).toHaveLength(1);
  });
});

describe('UpdateNodeDataCommand', () => {
  it('execute 合并 patch 到现有 data', () => {
    const node = makeNode('n1', 0, 0, { a: 1, b: 2 });
    const cmd = new UpdateNodeDataCommand('n1', { b: 3, c: 4 });
    const result = cmd.execute(makeGraph([node]), ctx);
    expect(result.nodes[0]!.data).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('undo 恢复原始 data', () => {
    const node = makeNode('n1', 0, 0, { a: 1 });
    const cmd = new UpdateNodeDataCommand('n1', { b: 2 });
    const after = cmd.execute(makeGraph([node]), ctx);
    const restored = cmd.undo(after, ctx);
    expect(restored.nodes[0]!.data).toEqual({ a: 1 });
  });

  it('节点不存在时 execute 不变', () => {
    const cmd = new UpdateNodeDataCommand('missing', { x: 1 });
    const graph = makeGraph([makeNode('other', 0, 0, { y: 1 })]);
    const result = cmd.execute(graph, ctx);
    expect(result.nodes[0]!.data).toEqual({ y: 1 });
  });

  it('data 为非对象时替换为 patch', () => {
    const node = makeNode('n1', 0, 0, 'string-data');
    const cmd = new UpdateNodeDataCommand('n1', { x: 1 });
    const result = cmd.execute(makeGraph([node]), ctx);
    expect(result.nodes[0]!.data).toEqual({ x: 1 });
  });

  it('data 为 null 时替换为 patch', () => {
    const node = makeNode('n1', 0, 0, null);
    const cmd = new UpdateNodeDataCommand('n1', { x: 1 });
    const result = cmd.execute(makeGraph([node]), ctx);
    expect(result.nodes[0]!.data).toEqual({ x: 1 });
  });
});
