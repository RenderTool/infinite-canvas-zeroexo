/**
 * subjects-api - 主体(角色/场景/道具)后端 API 客户端
 *
 * 与后端 /api/subjects 端点对接,提供主体 CRUD 操作。
 */

import { apiFetch } from '@/services/api-client.js';

export type SubjectType = 'character' | 'scene' | 'prop';

export interface SubjectVoice {
  id: string;
  name: string;
  note?: string;
}

export interface Subject {
  id: string;
  ownerId: string;
  type: SubjectType;
  name: string;
  aliases: string;
  description: string;
  avatarKey: string | null;
  avatarEmoji: string | null;
  status: 'ok' | 'warn' | 'err';
  consistency: string;
  fields: Record<string, string>;
  tags: string[];
  imageKeys: string[];
  voice: SubjectVoice | null;
  folderId: string | null;
  favorite?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSubjectInput {
  type: SubjectType;
  name: string;
  aliases?: string;
  description?: string;
  avatarKey?: string | null;
  avatarEmoji?: string | null;
  status?: 'ok' | 'warn' | 'err';
  consistency?: string;
  fields?: Record<string, string>;
  tags?: string[];
  imageKeys?: string[];
  folderId?: string | null;
}

export type UpdateSubjectInput = Partial<CreateSubjectInput & { favorite?: boolean }>;

/** 列出当前用户的所有主体(可按 type/folderId 过滤) */
export async function listSubjects(params?: {
  type?: SubjectType;
  folderId?: string;
}): Promise<Subject[]> {
  const search = new URLSearchParams();
  if (params?.type) search.set('type', params.type);
  if (params?.folderId) search.set('folderId', params.folderId);
  const qs = search.toString();
  const res = await apiFetch<{ items: Subject[]; nextCursor: string | null }>(`/subjects${qs ? `?${qs}` : ''}`);
  return res.items ?? [];
}

/** 获取单个主体 */
export async function getSubject(id: string): Promise<Subject> {
  return apiFetch<Subject>(`/subjects/${encodeURIComponent(id)}`);
}

/** 新建主体 */
export async function createSubject(input: CreateSubjectInput): Promise<Subject> {
  return apiFetch<Subject>('/subjects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** 更新主体 */
export async function updateSubject(
  id: string,
  patch: UpdateSubjectInput,
): Promise<Subject> {
  return apiFetch<Subject>(`/subjects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** 删除主体 */
export async function deleteSubject(id: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/subjects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** 类型本地化映射 */
export function getSubjectTypeLabel(t: SubjectType): 'character' | 'scene' | 'prop' {
  return t;
}