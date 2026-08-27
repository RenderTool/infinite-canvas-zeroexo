/**
 * 智能排列算法冒烟测试（临时，验证后删除）
 * 场景覆盖：混合（组+树+散落）/ 纯树 / 纯散落 / 空输入
 */
import { describe, it, expect } from 'vitest';
import { smartLayout } from './smart-layout.js';
import { forceLayout } from './force-layout.js';
import { radialLayout } from './radial-layout.js';
import { maxRectsPacking } from './packing.js';
import { ARRANGE_GAP, type LayoutNode } from '../types.js';

function node(id: string, w = 200, h = 80, x = 0, y = 0): LayoutNode {
  return { id, x, y, width: w, height: h, type: 'text' };
}

/** 校验无重叠：任意两节点矩形不相交（含 ARRANGE_GAP 容差） */
function assertNoOverlap(
  nodes: LayoutNode[],
  positions: Map<string, { x: number; y: number }>,
): void {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      const pa = positions.get(a.id);
      const pb = positions.get(b.id);
      if (!pa || !pb) continue;
      const overlapX = pa.x < pb.x + b.width && pb.x < pa.x + a.width;
      const overlapY = pa.y < pb.y + b.height && pb.y < pa.y + a.height;
      expect(overlapX && overlapY, `${a.id} 与 ${b.id} 重叠`).toBe(false);
    }
  }
}

describe('smartLayout 混合场景', () => {
  it('组 + 树 + 散落节点，全部不重叠且都返回位置', () => {
    // 真实 UI 路径：选中组时 promoteGroupSelection 只传组节点（子节点跟随组移动）
    const groupA = node('gA', 500, 300);
    // 树B：dagre 结构 4 节点
    const b1 = node('b1', 200, 80);
    const b2 = node('b2', 200, 80);
    const b3 = node('b3', 200, 80);
    const b4 = node('b4', 200, 80);
    // 散落节点
    const s1 = node('s1', 160, 90);
    const s2 = node('s2', 240, 70);

    const nodes = [groupA, b1, b2, b3, b4, s1, s2];
    const edges = [
      { source: 'b1', target: 'b2' },
      { source: 'b1', target: 'b3' },
      { source: 'b2', target: 'b4' },
    ];
    const groups = new Map<string, string[]>();
    groups.set('gA', ['gA-1', 'gA-2', 'gA-3']);

    const result = smartLayout(nodes, edges, { groups });

    expect(result.size).toBe(nodes.length);
    assertNoOverlap(nodes, result);
    // 所有节点都移动到了非负坐标
    for (const [, pos] of result) {
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeGreaterThanOrEqual(0);
    }
    // 组节点作为原子块保留（其子节点在 UI 层跟随移动）
    expect(result.has('gA')).toBe(true);
  });

  it('纯散落节点：紧凑打包且无重叠', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d'), node('e')];
    const result = smartLayout(nodes, []);
    expect(result.size).toBe(5);
    assertNoOverlap(nodes, result);
  });

  it('空输入返回空结果', () => {
    expect(smartLayout([], []).size).toBe(0);
  });
});

describe('forceLayout 冒烟', () => {
  it('图结构运行不抛错且返回全部节点', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d')];
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'd' },
    ];
    const result = forceLayout(nodes, edges, { iterations: 50 });
    expect(result.size).toBe(4);
  });
});

describe('radialLayout 冒烟', () => {
  it('根节点居中，子节点按层展开', () => {
    const nodes = [node('root', 220, 90), node('c1'), node('c2'), node('c3'), node('d1')];
    const edges = [
      { source: 'root', target: 'c1' },
      { source: 'root', target: 'c2' },
      { source: 'root', target: 'c3' },
      { source: 'c1', target: 'd1' },
    ];
    const result = radialLayout(nodes, edges, { rootId: 'root' });
    expect(result.size).toBe(5);
    expect(result.has('root')).toBe(true);
  });
});

describe('maxRectsPacking 冒烟', () => {
  it('不同尺寸节点紧凑打包', () => {
    const nodes = [
      node('a', 300, 200),
      node('b', 120, 120),
      node('c', 200, 100),
      node('d', 90, 90),
      node('e', 250, 150),
    ];
    const result = maxRectsPacking(nodes, ARRANGE_GAP);
    expect(result.size).toBe(5);
    assertNoOverlap(nodes, result);
  });
});
