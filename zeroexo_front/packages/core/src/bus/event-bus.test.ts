import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './event-bus.js';

describe('EventBus', () => {
  describe('on / emit', () => {
    it('订阅后能收到事件', () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on('test', handler);
      bus.emit('test', { a: 1 });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        { a: 1 },
        expect.objectContaining({ timestamp: expect.any(Number) }),
      );
    });

    it('多个 handler 都会执行', () => {
      const bus = new EventBus();
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.on('test', h1);
      bus.on('test', h2);
      bus.emit('test', null);
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it('同一 handler 重复订阅会被去重', () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on('test', handler);
      bus.on('test', handler);
      bus.emit('test', null);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('无订阅者 emit 不报错', () => {
      const bus = new EventBus();
      expect(() => bus.emit('none', null)).not.toThrow();
    });

    it('emit 带 source', () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on('test', handler);
      bus.emit('test', null, 'sender');
      expect(handler).toHaveBeenCalledWith(null, expect.objectContaining({ source: 'sender' }));
    });
  });

  describe('unsubscribe', () => {
    it('on 返回的函数可取消订阅', () => {
      const bus = new EventBus();
      const handler = vi.fn();
      const unsub = bus.on('test', handler);
      unsub();
      bus.emit('test', null);
      expect(handler).not.toHaveBeenCalled();
    });

    it('off 取消订阅', () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on('test', handler);
      bus.off('test', handler);
      bus.emit('test', null);
      expect(handler).not.toHaveBeenCalled();
    });

    it('off 不存在的 event 不报错', () => {
      const bus = new EventBus();
      expect(() => bus.off('none', () => undefined)).not.toThrow();
    });
  });

  describe('emitCancelable', () => {
    it('无订阅者返回 true', () => {
      const bus = new EventBus();
      expect(bus.emitCancelable('none', null)).toBe(true);
    });

    it('handler 不取消返回 true', () => {
      const bus = new EventBus();
      bus.on('test', () => undefined);
      expect(bus.emitCancelable('test', null)).toBe(true);
    });

    it('handler 调用 preventDefault 返回 false', () => {
      const bus = new EventBus();
      bus.on('test', (_p, ctx) => {
        ctx.cancelable?.preventDefault();
      });
      expect(bus.emitCancelable('test', null)).toBe(false);
    });

    it('第一个 handler 取消后后续 handler 不执行', () => {
      const bus = new EventBus();
      const h1 = vi.fn((_p, ctx) => ctx.cancelable?.preventDefault());
      const h2 = vi.fn();
      bus.on('test', h1);
      bus.on('test', h2);
      bus.emitCancelable('test', null);
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).not.toHaveBeenCalled();
    });

    it('普通 emit 的 context.cancelable 为 undefined', () => {
      const bus = new EventBus();
      const handler = vi.fn((_p, ctx) => {
        expect(ctx.cancelable).toBeUndefined();
      });
      bus.on('test', handler);
      bus.emit('test', null);
      expect(handler).toHaveBeenCalled();
    });

    it('async handler 在 await 后调用 preventDefault 不影响返回值', async () => {
      const bus = new EventBus();
      bus.on('test', async (_p, ctx) => {
        await Promise.resolve();
        ctx.cancelable?.preventDefault();
      });
      // 同步阶段未取消,返回 true
      expect(bus.emitCancelable('test', null)).toBe(true);
      // 等待微任务执行完
      await Promise.resolve();
    });
  });

  describe('hasListeners', () => {
    it('无订阅者返回 false', () => {
      const bus = new EventBus();
      expect(bus.hasListeners('test')).toBe(false);
    });

    it('有订阅者返回 true', () => {
      const bus = new EventBus();
      bus.on('test', () => undefined);
      expect(bus.hasListeners('test')).toBe(true);
    });

    it('取消订阅后返回 false', () => {
      const bus = new EventBus();
      const unsub = bus.on('test', () => undefined);
      unsub();
      expect(bus.hasListeners('test')).toBe(false);
    });
  });

  describe('clear', () => {
    it('清空所有订阅', () => {
      const bus = new EventBus();
      bus.on('a', () => undefined);
      bus.on('b', () => undefined);
      bus.clear();
      expect(bus.hasListeners('a')).toBe(false);
      expect(bus.hasListeners('b')).toBe(false);
    });
  });
});
