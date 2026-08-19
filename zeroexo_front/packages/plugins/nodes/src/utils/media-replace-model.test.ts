/**
 * media-replace-model 纯函数单测(Plan#11 C4)
 *
 * 覆盖 computeVideoReplaceSize 的三种宽度基准:
 * - 常规节点: 保持当前宽度保宽调高
 * - 空节点/小节点: 回退扩展契约基准宽度
 * - 素材宽高缺失: 16:9 兜底不产生 NaN
 */
import { describe, it, expect, vi } from 'vitest';

// 纯函数测试不需要真实上传模块(vitest 未 alias 该包,且上传链路已由 replaceNodeImage 覆盖)
vi.mock('@zeroexo/plugin-persistence', () => ({ uploadMediaFile: vi.fn() }));

import { computeVideoReplaceSize } from './media-replace-model.js';

const videoExt = {
  defaultSize: { width: 620, height: 348 },
  minSize: { width: 80, height: 80 },
};

function node(size?: { width: number; height: number }) {
  return {
    id: 'n1',
    type: 'video',
    position: { x: 0, y: 0 },
    size,
    data: {},
  };
}

describe('computeVideoReplaceSize', () => {
  it('常规节点保持当前宽度,高度按素材比例', () => {
    const size = computeVideoReplaceSize(node({ width: 500, height: 281 }), { width: 1280, height: 720 }, videoExt);
    expect(size).toEqual({ width: 500, height: 281 });
  });

  it('空节点(node.size 缺失)回退扩展契约基准宽度', () => {
    const size = computeVideoReplaceSize(node(undefined), { width: 1920, height: 1080 }, videoExt);
    expect(size).toEqual({ width: 620, height: 349 }); // 620 * 9/16 = 348.75 → 349
  });

  it('小节点(接近 minSize)回退扩展契约基准宽度,避免保持小尺寸', () => {
    const size = computeVideoReplaceSize(node({ width: 80, height: 80 }), { width: 1280, height: 720 }, videoExt);
    expect(size).toEqual({ width: 620, height: 349 });
  });

  it('素材宽高缺失时 16:9 兜底,不产生 NaN', () => {
    const size = computeVideoReplaceSize(node({ width: 400, height: 225 }), {}, videoExt);
    expect(size).toEqual({ width: 400, height: 225 });
  });

  it('无扩展时用 video 契约常量兜底', () => {
    const size = computeVideoReplaceSize(node(undefined), { width: 1280, height: 720 }, undefined);
    expect(size).toEqual({ width: 620, height: 349 });
  });
});
