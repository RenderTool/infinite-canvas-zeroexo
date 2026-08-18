import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginHost } from './plugin-host.js';
import type { Plugin, PluginContext } from './plugin-host.js';
import { EventBus, CommandQueue } from '../index.js';

function makeContext(): PluginContext {
  const bus = new EventBus();
  const cq = new CommandQueue(
    { nodes: [], edges: [], viewport: { x: 0, y: 0, k: 1 }, metadata: {} },
    bus,
  );
  return {
    getGraph: () => cq.getState(),
    eventBus: bus,
    commandQueue: cq,
    getPlugin: <T extends Plugin>(id: string) => host?.get<T>(id),
  };
}

let host: PluginHost | undefined;

function makePlugin(id: string, deps?: string[]): Plugin & { calls: string[] } {
  const calls: string[] = [];
  return {
    id,
    dependencies: deps,
    install: () => calls.push('install'),
    activate: () => calls.push('activate'),
    deactivate: () => calls.push('deactivate'),
    uninstall: () => calls.push('uninstall'),
    calls,
  };
}

describe('PluginHost', () => {
  beforeEach(() => {
    host = undefined;
  });

  describe('install', () => {
    it('注册并激活插件', () => {
      host = new PluginHost(makeContext());
      const p = makePlugin('a');
      host.install(p);
      expect(host.has('a')).toBe(true);
      expect(host.isActive('a')).toBe(true);
      expect(p.calls).toEqual(['install', 'activate']);
    });

    it('重复 id 抛错', () => {
      host = new PluginHost(makeContext());
      host.install(makePlugin('a'));
      expect(() => host.install(makePlugin('a'))).toThrowError(/already installed/);
    });

    it('缺失依赖抛错', () => {
      host = new PluginHost(makeContext());
      const p: Plugin = { id: 'b', dependencies: ['a'] };
      expect(() => host.install(p)).toThrowError(/missing dependency "a"/);
    });

    it('依赖已安装时通过', () => {
      host = new PluginHost(makeContext());
      host.install(makePlugin('a'));
      host.install(makePlugin('b', ['a']));
      expect(host.has('b')).toBe(true);
    });

    it('install 抛错时回滚注册', () => {
      host = new PluginHost(makeContext());
      const p: Plugin = {
        id: 'a',
        install: () => {
          throw new Error('boom');
        },
      };
      expect(() => host.install(p)).toThrowError('boom');
      expect(host.has('a')).toBe(false);
    });

    it('activate 抛错时回滚注册', () => {
      host = new PluginHost(makeContext());
      const p: Plugin = {
        id: 'a',
        activate: () => {
          throw new Error('activate boom');
        },
      };
      expect(() => host.install(p)).toThrowError('activate boom');
      expect(host.has('a')).toBe(false);
    });

    it('回滚时静默调用 deactivate/uninstall', () => {
      host = new PluginHost(makeContext());
      const calls: string[] = [];
      const p: Plugin = {
        id: 'a',
        install: () => calls.push('install'),
        activate: () => {
          calls.push('activate');
          throw new Error('boom');
        },
        deactivate: () => calls.push('deactivate'),
        uninstall: () => calls.push('uninstall'),
      };
      expect(() => host.install(p)).toThrowError('boom');
      expect(calls).toEqual(['install', 'activate', 'deactivate', 'uninstall']);
    });

    it('回滚期间 deactivate/uninstall 抛错被静默', () => {
      host = new PluginHost(makeContext());
      const p: Plugin = {
        id: 'a',
        activate: () => {
          throw new Error('primary');
        },
        deactivate: () => {
          throw new Error('secondary');
        },
        uninstall: () => {
          throw new Error('tertiary');
        },
      };
      // 原始错误应被抛出,二次错误被静默
      expect(() => host.install(p)).toThrowError('primary');
      expect(host.has('a')).toBe(false);
    });
  });

  describe('installAll', () => {
    it('拓扑排序: 依赖在前', () => {
      host = new PluginHost(makeContext());
      const order: string[] = [];
      const a: Plugin = { id: 'a', install: () => order.push('a') };
      const b: Plugin = { id: 'b', dependencies: ['a'], install: () => order.push('b') };
      const c: Plugin = { id: 'c', dependencies: ['b'], install: () => order.push('c') };
      // 乱序传入
      host.installAll([c, b, a]);
      expect(order).toEqual(['a', 'b', 'c']);
    });

    it('循环依赖抛错', () => {
      host = new PluginHost(makeContext());
      const a: Plugin = { id: 'a', dependencies: ['b'] };
      const b: Plugin = { id: 'b', dependencies: ['a'] };
      expect(() => host.installAll([a, b])).toThrowError(/Circular dependency/);
    });

    it('依赖指向已安装插件时通过', () => {
      host = new PluginHost(makeContext());
      host.install(makePlugin('a'));
      const b: Plugin = { id: 'b', dependencies: ['a'] };
      expect(() => host.installAll([b])).not.toThrow();
    });

    it('传递 optionsMap', () => {
      host = new PluginHost(makeContext());
      const received: unknown[] = [];
      const p: Plugin = { id: 'a', install: (_ctx, opts) => received.push(opts) };
      host.installAll([p], { a: { enabled: false } });
      expect(received).toEqual([{ enabled: false }]);
    });
  });

  describe('uninstall', () => {
    it('卸载并移除注册', () => {
      host = new PluginHost(makeContext());
      const p = makePlugin('a');
      host.install(p);
      host.uninstall('a');
      expect(host.has('a')).toBe(false);
      expect(p.calls).toEqual(['install', 'activate', 'deactivate', 'uninstall']);
    });

    it('不存在的 id 静默返回', () => {
      host = new PluginHost(makeContext());
      expect(() => host.uninstall('none')).not.toThrow();
    });

    it('有依赖方时抛错', () => {
      host = new PluginHost(makeContext());
      host.install(makePlugin('a'));
      host.install(makePlugin('b', ['a']));
      expect(() => host.uninstall('a')).toThrowError(/depended on by \[b\]/);
    });
  });

  describe('get / list / has / isActive', () => {
    it('get 返回插件实例', () => {
      host = new PluginHost(makeContext());
      const p = makePlugin('a');
      host.install(p);
      expect(host.get('a')).toBe(p);
    });

    it('get 不存在返回 undefined', () => {
      host = new PluginHost(makeContext());
      expect(host.get('none')).toBeUndefined();
    });

    it('list 返回所有已安装插件', () => {
      host = new PluginHost(makeContext());
      host.install(makePlugin('a'));
      host.install(makePlugin('b'));
      expect(host.list().map((p) => p.id)).toEqual(['a', 'b']);
    });

    it('has / isActive', () => {
      host = new PluginHost(makeContext());
      expect(host.has('a')).toBe(false);
      expect(host.isActive('a')).toBe(false);
      host.install(makePlugin('a'));
      expect(host.has('a')).toBe(true);
      expect(host.isActive('a')).toBe(true);
    });
  });

  describe('activate / deactivate', () => {
    it('activate 已激活插件为 no-op', () => {
      host = new PluginHost(makeContext());
      const p = makePlugin('a');
      host.install(p);
      host.activate('a');
      expect(p.calls).toEqual(['install', 'activate']);
    });

    it('activate 不存在的插件抛错', () => {
      host = new PluginHost(makeContext());
      expect(() => host.activate('none')).toThrowError(/not installed/);
    });

    it('activate 调用 activate 回调', () => {
      host = new PluginHost(makeContext());
      const p = makePlugin('a');
      host.install(p);
      host.deactivate('a');
      host.activate('a');
      // install 时的 activate + 手动 activate
      expect(p.calls.filter((c) => c === 'activate')).toHaveLength(2);
    });

    it('deactivate 未激活插件为 no-op', () => {
      host = new PluginHost(makeContext());
      const p = makePlugin('a');
      host.install(p);
      host.deactivate('a');
      // 再次 deactivate
      host.deactivate('a');
      expect(p.calls).toEqual(['install', 'activate', 'deactivate']);
    });

    it('deactivate 不存在的插件静默返回', () => {
      host = new PluginHost(makeContext());
      expect(() => host.deactivate('none')).not.toThrow();
    });

    it('deactivate 有依赖方时抛错', () => {
      host = new PluginHost(makeContext());
      host.install(makePlugin('a'));
      host.install(makePlugin('b', ['a']));
      expect(() => host.deactivate('a')).toThrowError(/depended on by \[b\]/);
    });

    it('activate→deactivate→activate 循环', () => {
      host = new PluginHost(makeContext());
      const p = makePlugin('a');
      host.install(p);
      host.deactivate('a');
      expect(host.isActive('a')).toBe(false);
      host.activate('a');
      expect(host.isActive('a')).toBe(true);
      expect(p.calls).toEqual(['install', 'activate', 'deactivate', 'activate']);
    });
  });
});
