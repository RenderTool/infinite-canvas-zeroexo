import { describe, expect, it } from 'vitest';
import { quantizeZoom } from './edge-layer';

describe('quantizeZoom', () => {
  it('静止时为精确值(桶心),无量化误差', () => {
    for (const k of [0.057, 0.2, 0.5, 1, 1.653, 2.0, 17.5]) {
      const n = quantizeZoom(k);
      // 桶心映射回同一值:再量化一次结果不变,且误差在 5% 桶内
      expect(quantizeZoom(n)).toBe(n);
      expect(Math.abs(n - k) / k).toBeLessThanOrEqual(0.05);
    }
  });

  it('同一 5% 桶内的连续 k 映射到同一量化值(缓存命中前提)', () => {
    // 模拟缩放动画:1% 步进 20 帧
    const values = new Set<number>();
    for (let i = 0; i < 20; i++) values.add(quantizeZoom(1 + i * 0.01));
    // 1.00-1.19 跨 5% 桶边界 10 个桶,实际 20 帧应只产生 ≤ 5 个不同值
    expect(values.size).toBeLessThanOrEqual(5);
  });

  it('边界与非法输入安全', () => {
    expect(quantizeZoom(0)).toBe(0);
    expect(quantizeZoom(-3)).toBe(-3);
    expect(quantizeZoom(Number.NaN)).toBe(Number.NaN);
    expect(quantizeZoom(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });
});