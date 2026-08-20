/**
 * text-model 纯函数单测(Plan#12 T3)
 *
 * 覆盖:
 * - buildTextContentCommand: graph 上 execute 合并 patch + undo 恢复旧 data
 * - 不存在节点 no-op 安全(卸载时提交不炸)
 * - isTextContentDirty 提交判定
 */
import { describe, it, expect } from 'vitest';
import { buildTextContentCommand, isTextContentDirty } from './text-model.js';
import type { GraphModel } from '@zeroexo/core';

function graph(content?: string): GraphModel {
  return {
    nodes: [
      {
        id: 't1',
        type: 'text',
        position: { x: 0, y: 0 },
        size: { width: 200, height: 150 },
        data: { content: content ?? '旧内容' },
      },
    ],
    edges: [],
  };
}

describe('isTextContentDirty', () => {
  it('内容变化判定为 dirty', () => {
    expect(isTextContentDirty('旧', '新')).toBe(true);
  });

  it('内容相同判定为 clean(不产生命令)', () => {
    expect(isTextContentDirty('相同', '相同')).toBe(false);
    expect(isTextContentDirty('', '')).toBe(false);
  });
});

describe('buildTextContentCommand', () => {
  it('execute 合并 content patch 到节点 data(保留其他字段)', () => {
    const cmd = buildTextContentCommand('t1', '新内容');
    const next = cmd.execute(graph());
    expect(next.nodes[0].data).toEqual({ content: '新内容' });
  });

  it('undo 恢复编辑前 data', () => {
    const cmd = buildTextContentCommand('t1', '新内容');
    const next = cmd.execute(graph('旧内容'));
    const restored = cmd.undo(next);
    expect(restored.nodes[0].data).toEqual({ content: '旧内容' });
  });

  it('节点不存在时 no-op(卸载时提交安全)', () => {
    const cmd = buildTextContentCommand('ghost', '内容');
    const g = graph();
    expect(cmd.execute(g)).toBe(g);
  });
});
