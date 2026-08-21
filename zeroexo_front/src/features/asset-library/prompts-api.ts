/**
 * prompts-api - 提示词后端 API 客户端
 *
 * 与后端 /prompts 端点对接,提供提示词 CRUD 操作。
 * 与后端 PromptImage 表关联,支持多图参考。
 */

import { apiFetch } from '@/services/api-client.js';

export type PromptCategory = 'role' | 'scene' | 'prop' | 'style' | 'shot' | 'other';

export interface Prompt {
  id: string;
  ownerId: string;
  title: string;
  content: string;
  contentEn?: string | null;
  contentJa?: string | null;
  note?: string | null;
  category: PromptCategory;
  tags: string[];
  imageKeys: string[];
  favorite: boolean;
  folderId: string | null;
  source?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePromptInput {
  title: string;
  content: string;
  contentEn?: string;
  contentJa?: string;
  note?: string;
  category?: PromptCategory;
  tags?: string[];
  imageKeys?: string[];
  favorite?: boolean;
  folderId?: string | null;
  source?: string;
}

export type UpdatePromptInput = Partial<CreatePromptInput>;

/** 列出当前用户的所有提示词(可按 category/folderId 过滤) */
export async function listPrompts(params?: {
  category?: PromptCategory;
  folderId?: string;
}): Promise<Prompt[]> {
  const search = new URLSearchParams();
  if (params?.category) search.set('category', params.category);
  if (params?.folderId) search.set('folderId', params.folderId);
  const qs = search.toString();
  const res = await apiFetch<{ items: Prompt[]; nextCursor: string | null }>(`/prompts${qs ? `?${qs}` : ''}`);
  return res.items ?? [];
}

/** 获取单个提示词 */
export async function getPrompt(id: string): Promise<Prompt> {
  return apiFetch<Prompt>(`/prompts/${encodeURIComponent(id)}`);
}

/** 新建提示词 */
export async function createPrompt(input: CreatePromptInput): Promise<Prompt> {
  return apiFetch<Prompt>('/prompts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** 更新提示词 */
export async function updatePrompt(
  id: string,
  patch: UpdatePromptInput,
): Promise<Prompt> {
  return apiFetch<Prompt>(`/prompts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** 删除提示词 */
export async function deletePrompt(id: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/prompts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}