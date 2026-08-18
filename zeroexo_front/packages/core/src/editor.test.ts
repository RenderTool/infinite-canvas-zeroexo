import { describe, it, expect, vi } from 'vitest';
import { createEditor } from './editor.js';
import { AddNodeCommand } from './command/builtins.js';
import type { Plugin } from './plugin/plugin-host.js';

describe('createEditor', () => {
  it('返回编辑器实例', () => {
    const editor = createEditor();
    expect(editor.eventBus).toBeDefined();
    expect(editor.commandQueue).toBeDefined();
    expect(editor.plugins).toBeDefined();
    expect(typeof editor.getGraph).toBe('function');
    expect(typeof editor.install).toBe('function');
    expect(typeof editor.dispose).toBe('function');
  });

  it('默认初始 graph 为空', () => {
    const editor = createEditor();
    const graph = editor.getGraph();
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.viewport).toEqual({ x: 0, y: 0, k: 1 });
    expect(graph.metadata).toEqual({});
  });

  it('自定义 initialGraph', () => {
    const initial = {
      nodes: [{ id: 'n1', type: 'test', position: { x: 1, y: 2 } }],
      edges: [],
      viewport: { x: 10, y: 20, k: 2 },
      metadata: { custom: true },
    };
    const editor = createEditor({ initialGraph: initial });
    const graph = editor.getGraph();
    expect(graph.nodes).toHaveLength(1);
    expect(graph.viewport.k).toBe(2);
    expect(graph.metadata.custom).toBe(true);
  });

  it('自定义 historyCapacity', () => {
    const editor = createEditor({ historyCapacity: 3 });
    // 通过执行 4 次命令验证容量(第 1 次应被丢弃)
    for (let i = 0; i < 4; i++) {
      editor.commandQueue.execute(
        new AddNodeCommand({ id: `n${i}`, type: 't', position: { x: 0, y: 0 } }),
      );
    }
    expect(editor.getGraph().nodes).toHaveLength(4);
    // undo 3 次应到底
    editor.commandQueue.undo();
    editor.commandQueue.undo();
    editor.commandQueue.undo();
    expect(editor.commandQueue.canUndo()).toBe(false);
    expect(editor.getGraph().nodes).toHaveLength(1);
  });

  it('getGraph 委托给 commandQueue.getState 保持一致', () => {
    const editor = createEditor();
    editor.commandQueue.execute(
      new AddNodeCommand({ id: 'n1', type: 't', position: { x: 0, y: 0 } }),
    );
    expect(editor.getGraph()).toBe(editor.commandQueue.getState());
    expect(editor.getGraph().nodes).toHaveLength(1);
  });

  it('install 委托给 plugins.install', () => {
    const editor = createEditor();
    const calls: string[] = [];
    const p: Plugin = {
      id: 'test',
      install: () => calls.push('install'),
      activate: () => calls.push('activate'),
    };
    editor.install(p);
    expect(calls).toEqual(['install', 'activate']);
    expect(editor.plugins.has('test')).toBe(true);
  });

  it('getPlugin 通过 context 委托给 PluginHost', () => {
    const editor = createEditor();
    let resolved: Plugin | undefined;
    const consumer: Plugin = {
      id: 'consumer',
      install: (ctx) => {
        resolved = ctx.getPlugin<Plugin>('target');
      },
    };
    const target: Plugin = { id: 'target' };
    editor.install(target);
    editor.install(consumer);
    expect(resolved).toBe(target);
  });

  it('dispose 先 deactivate 所有插件再 clear eventBus', () => {
    const editor = createEditor();
    const calls: string[] = [];
    editor.install({
      id: 'a',
      install: () => calls.push('a-install'),
      activate: () => calls.push('a-activate'),
      deactivate: () => calls.push('a-deactivate'),
      uninstall: () => calls.push('a-uninstall'),
    });
    editor.install({
      id: 'b',
      install: () => calls.push('b-install'),
      activate: () => calls.push('b-activate'),
      deactivate: () => calls.push('b-deactivate'),
      uninstall: () => calls.push('b-uninstall'),
    });
    const handler = vi.fn();
    editor.eventBus.on('test', handler);
    editor.dispose();
    // 两个插件都应被 deactivate
    expect(calls).toContain('a-deactivate');
    expect(calls).toContain('b-deactivate');
    // eventBus 被清空,emit 不再触发
    editor.eventBus.emit('test', null);
    expect(handler).not.toHaveBeenCalled();
  });

  it('dispose 期间插件抛错不中断后续清理', () => {
    const editor = createEditor();
    const calls: string[] = [];
    editor.install({
      id: 'a',
      activate: () => calls.push('a-activate'),
      deactivate: () => {
        calls.push('a-deactivate');
        throw new Error('a boom');
      },
    });
    editor.install({
      id: 'b',
      activate: () => calls.push('b-activate'),
      deactivate: () => calls.push('b-deactivate'),
    });
    expect(() => editor.dispose()).not.toThrow();
    expect(calls).toContain('a-deactivate');
    expect(calls).toContain('b-deactivate');
  });
});
