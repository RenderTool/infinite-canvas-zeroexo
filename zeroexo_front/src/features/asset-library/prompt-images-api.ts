/**
 * prompt-images-api - 提示词图片后端 API 客户端
 *
 * 支持同一个提示词关联多张参考图(每张有 role 字段区分用途)。
 *
 * 后端路由: /prompts/:promptId/images
 *   GET                  list
 *   POST                 add (单张)
 *   POST /set            setAll (覆盖式批量)
 *   DELETE /:imageId     remove
 */

import { apiFetch } from '@/services/api-client.js';

export type PromptImageRole = 'reference' | 'output' | 'cover';

export interface PromptImage {
  id: string;
  promptId: string;
  storageKey: string;
  role: PromptImageRole;
  sortOrder: number;
  createdAt: string;
}

/** 列出指定提示词的所有图片 */
export async function listPromptImages(promptId: string): Promise<PromptImage[]> {
  return apiFetch<PromptImage[]>(`/prompts/${encodeURIComponent(promptId)}/images`);
}

/** 添加图片到提示词 */
export async function addPromptImage(
  promptId: string,
  input: { storageKey: string; role?: PromptImageRole; sortOrder?: number },
): Promise<PromptImage> {
  return apiFetch<PromptImage>(`/prompts/${encodeURIComponent(promptId)}/images`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** 批量设置提示词图片(替换整个列表) */
export async function setPromptImages(
  promptId: string,
  images: Array<{ storageKey: string; role?: PromptImageRole; sortOrder?: number }>,
): Promise<PromptImage[]> {
  return apiFetch<PromptImage[]>(
    `/prompts/${encodeURIComponent(promptId)}/images/set`,
    {
      method: 'POST',
      body: JSON.stringify({ images }),
    },
  );
}

/** 从提示词中移除指定图片 */
export async function removePromptImage(
  promptId: string,
  imageId: string,
): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(
    `/prompts/${encodeURIComponent(promptId)}/images/${encodeURIComponent(imageId)}`,
    { method: 'DELETE' },
  );
}