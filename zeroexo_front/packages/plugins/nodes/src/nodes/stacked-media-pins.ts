import type { Pin } from '@zeroexo/core';

/**
 * StackNode Pin 定义
 *
 * input pin: 接受 generator 生成结果，自动追加为新卡片
 * output pin: 暴露所有卡片内容作为整体参考素材
 */
export function getStackedMediaPins(): Pin[] {
  return [
    { id: 'prompt', name: 'Prompt', direction: 'input' },
    { id: 'media', name: 'Media', direction: 'output' },
  ];
}
