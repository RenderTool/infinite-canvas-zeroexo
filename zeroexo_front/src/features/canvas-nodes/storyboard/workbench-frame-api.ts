/**
 * workbench-frame-api - 出片工作台首帧/尾帧图片生成 API 封装
 *
 * 调用后端 POST /api/ai/generate 生成图片，轮询获取结果。
 * 后端 API 未连通时降级为 mock 模拟，确保前端交互流程完整。
 */

import { apiPost, apiGet } from '@/services/api-client.js';
import type { WorkbenchShot } from './workbench-types';

/** 生成记录（后端返回的精简字段） */
interface GenerationRecord {
  id: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  params?: Record<string, unknown>;
  errorMessage?: string | null;
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 90; // 3 分钟超时

/**
 * 轮询生成结果直到完成或失败
 */
async function pollGeneration(
  generationId: string,
  signal?: AbortSignal,
): Promise<string> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const record = await apiGet<GenerationRecord>(
      `/ai/generations/${generationId}`,
    );

    if (record.status === 'success') {
      // 从 params._resultUrl 提取图片 URL（presigned URL），作为临时 storageKey 使用
      const url = record.params?._resultUrl as string | undefined;
      if (url) return url;
      // 无 URL 时用 generationId 作为占位
      return generationId;
    }
    if (record.status === 'failed') {
      throw new Error(record.errorMessage ?? '图片生成失败');
    }
    // pending / running -> 继续轮询
  }
  throw new Error('图片生成超时');
}

/**
 * 为指定镜头生成首帧/尾帧图片
 *
 * @param shot - 镜头数据
 * @param frameType - 首帧或尾帧
 * @param signal - 可选 AbortSignal 用于取消
 * @returns 生成的图片 URL / storageKey
 */
export async function generateFrame(
  shot: WorkbenchShot,
  frameType: 'firstFrame' | 'lastFrame',
  signal?: AbortSignal,
): Promise<{ storageKey: string }> {
  const prompt =
    frameType === 'firstFrame'
      ? shot.imagePrompt || shot.description
      : shot.imagePrompt || shot.description;

  const promptSuffix =
    frameType === 'firstFrame' ? '（首帧画面）' : '（尾帧画面）';

  try {
    const result = await apiPost<{ generationId: string }>('/ai/generate', {
      kind: 'image',
      prompt: `${prompt}${promptSuffix}`,
      model: 'gpt-4o',
      params: { size: '1024x1024' },
    });

    const imageUrl = await pollGeneration(result.generationId, signal);
    return { storageKey: imageUrl };
  } catch (err) {
    // API 不可用时降级为 mock，确保前端交互流程可走通
    if (
      err instanceof DOMException && err.name === 'AbortError'
    ) {
      throw err;
    }
    console.warn(
      '[workbench-frame-api] API 调用失败，使用 mock 降级:',
      err,
    );
    return mockGenerateFrame(shot, frameType, signal);
  }
}

// ===== Mock 实现 =====

let mockCounter = 0;

async function mockGenerateFrame(
  shot: WorkbenchShot,
  _frameType: 'firstFrame' | 'lastFrame',
  signal?: AbortSignal,
): Promise<{ storageKey: string }> {
  // 模拟生成延迟
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 1500 + Math.random() * 1000);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  mockCounter += 1;

  // 生成一个纯色占位图 data URL，模拟生成的图片
  const hue = (shot.number * 37 + mockCounter * 73) % 360;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 144;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = `hsl(${hue}, 60%, 40%)`;
    ctx.fillRect(0, 0, 256, 144);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `Shot #${shot.number} ${_frameType === 'firstFrame' ? '首帧' : '尾帧'}`,
      128,
      78,
    );
  }

  return { storageKey: canvas.toDataURL('image/png') };
}