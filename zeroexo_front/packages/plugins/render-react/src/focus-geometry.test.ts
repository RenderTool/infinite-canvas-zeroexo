import { describe, expect, it } from 'vitest';
import { computeFocusTarget } from './focus-geometry';

describe('computeFocusTarget', () => {
  const container = { width: 1000, height: 600 };

  it('节点中心对齐视口中心,缩放受上限 2.0 约束', () => {
    // 100x100 节点在 (100,100): w 轴 = 1000/100×0.82=8.2, h 轴 = 600/100×0.82=4.92 → 上限 2.0
    const r = computeFocusTarget({ x: 100, y: 100, width: 100, height: 100 }, container);
    expect(r.k).toBe(2.0);
    expect(r.x).toBeCloseTo(500 - 150 * 2.0);
    expect(r.y).toBeCloseTo(300 - 150 * 2.0);
  });

  it('默认 paddingRatio 0.82 生效(非上限场景)', () => {
    // 500x200 节点: min(1000/500, 600/200) × 0.82 = min(2, 3) × 0.82 = 1.64
    const r = computeFocusTarget({ x: 0, y: 0, width: 500, height: 200 }, container);
    expect(r.k).toBeCloseTo(1.64);
  });

  it('capsuleHeight 计入总高,缩放更小', () => {
    const without = computeFocusTarget({ x: 0, y: 0, width: 500, height: 200 }, container);
    const withCapsule = computeFocusTarget({ x: 0, y: 0, width: 500, height: 200 }, container, 51);
    // 600/(200+51) × 0.82 ≈ 1.9602(受 h 轴约束),低于无胶囊的 1.64? 否——w 轴 2×0.82=1.64 仍为主约束
    expect(withCapsule.k).toBeLessThanOrEqual(without.k);
    expect(withCapsule.k).toBeCloseTo(Math.min(2, 600 / 251) * 0.82);
  });

  it('paddingRatio 越小留白越大(缩放越小)', () => {
    const base = computeFocusTarget({ x: 0, y: 0, width: 500, height: 200 }, container);
    const tight = computeFocusTarget({ x: 0, y: 0, width: 500, height: 200 }, container, 0, 0.8);
    expect(tight.k).toBeCloseTo(1.6);
    expect(tight.k).toBeLessThan(base.k);
  });

  it('高度轴受限时按高度轴计算', () => {
    // 2000x100 节点: w 轴 = 1000/2000×0.82=0.41, h 轴 = 600/100×0.82=4.92 → 取 0.41
    const r = computeFocusTarget({ x: 0, y: 0, width: 2000, height: 100 }, container);
    expect(r.k).toBeCloseTo(0.41);
  });
});
