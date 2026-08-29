/**
 * prompt-images-api - 提示词图片 API 客户端
 *
 * 封面模型(2026-08-29 修正):封面不再用 role='cover' 第三态表达——
 * 设为封面不改参考/生成角色,封面是独立布尔 isCover(仅星标填充)。
 * 画布据此:封面图仍留在原列(reference→参考列 / output→输出列),只多一个星标。
 * 端点:
 *   POST /:promptId/images   add (单张)
 *   DELETE /:imageId         remove
 *   POST /set                setAll (覆盖式批量)
 */

import { apiFetch } from '@/services/api-client.js';

export type PromptImageRole = 'reference' | 'output';

export interface PromptImage {
  id: string;
  promptId: string;
  storageKey: string;
  role: PromptImageRole;
  /** 封面标记(独立布尔,不改变 reference/output 角色;仅星标填充) */
  isCover?: boolean;
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
  input: { storageKey: string; role?: PromptImageRole; isCover?: boolean; sortOrder?: number },
): Promise<PromptImage> {
  return apiFetch<PromptImage>(`/prompts/${encodeURIComponent(promptId)}/images`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** 批量设置提示词图片(替换整个列表) */
export async function setPromptImages(
  promptId: string,
  images: Array<{ storageKey: string; role?: PromptImageRole; isCover?: boolean; sortOrder?: number }>,
): Promise<PromptImage[]> {
  return apiFetch<PromptImage[]>(
    `/prompts/${encodeURIComponent(promptId)}/images/set`,
    {
      method: 'POST',
      body: JSON.stringify({ images }),
    },
  );
}

/** 删除提示词中的一张图片 */
export async function removePromptImage(promptId: string, imageId: string): Promise<unknown> {
  return apiFetch(`/prompts/${encodeURIComponent(promptId)}/images/${imageId}`, {
    method: 'DELETE',
  });
}
