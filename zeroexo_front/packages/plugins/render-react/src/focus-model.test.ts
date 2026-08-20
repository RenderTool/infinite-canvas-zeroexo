import { describe, expect, it } from 'vitest';
import { resolveFocusAnimation } from './focus-model';

describe('resolveFocusAnimation', () => {
  it('≤120 节点:全帧 60fps,保留原时长', () => {
    expect(resolveFocusAnimation(0, 400)).toEqual({ durationMs: 400, frameIntervalMs: 0 });
    expect(resolveFocusAnimation(120, 400)).toEqual({ durationMs: 400, frameIntervalMs: 0 });
  });

  it('121~400 节点:30fps 节流,动画总时长不变', () => {
    expect(resolveFocusAnimation(121, 400)).toEqual({ durationMs: 400, frameIntervalMs: 33 });
    expect(resolveFocusAnimation(400, 400)).toEqual({ durationMs: 400, frameIntervalMs: 33 });
  });

  it('401~800 节点:15fps 节流,帧数减到 ~1/4', () => {
    expect(resolveFocusAnimation(401, 400)).toEqual({ durationMs: 400, frameIntervalMs: 66 });
    expect(resolveFocusAnimation(800, 400)).toEqual({ durationMs: 400, frameIntervalMs: 66 });
  });

  it('>800 节点:直接跳转无动画', () => {
    expect(resolveFocusAnimation(801, 400)).toEqual({ durationMs: 0, frameIntervalMs: 0 });
    expect(resolveFocusAnimation(5000, 400)).toEqual({ durationMs: 0, frameIntervalMs: 0 });
  });

  it('自定义时长透传(降级档位保留,仅时长替换)', () => {
    const r = resolveFocusAnimation(200, 600);
    expect(r.durationMs).toBe(600);
    expect(r.frameIntervalMs).toBe(33);
  });
});
