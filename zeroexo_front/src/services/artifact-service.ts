/**
 * artifact-service - 画布项目 API 封装
 * 
 * 封装对后端 /api/projects 端点的 CRUD 调用。
 * 使用现有 apiGet、apiPost、apiPatch、apiDelete 基础设施。
 */

import { apiGet, apiPost, apiPatch, apiDelete } from './api-client';

/** 画布项目数据模型（与后端一致） */
export interface Project {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  script: unknown;
  storyboard: unknown;
  generations: unknown;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl?: string | null;
}

/** 创建画布项目请求 */
export interface CreateArtifactRequest {
  title: string;
  description?: string;
}

/** 更新画布项目请求 */
export interface UpdateArtifactRequest {
  title?: string;
  description?: string;
  thumbnailUrl?: string | null;
  script?: unknown;
  storyboard?: unknown;
  generations?: unknown;
}

/** 分页响应 */
export interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * 获取画布项目列表（游标分页）
 */
export async function listArtifacts(
  cursor?: string,
  limit?: number,
  keyword?: string,
): Promise<PaginatedResponse<Project>> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', String(limit));
  if (keyword) params.set('keyword', keyword);
  const qs = params.toString();
  return apiGet<PaginatedResponse<Project>>(`/projects${qs ? `?${qs}` : ''}`);
}

/**
 * 创建画布项目
 */
export async function createArtifact(dto: CreateArtifactRequest): Promise<Project> {
  return apiPost<Project>('/projects', dto);
}

/**
 * 获取画布项目详情
 */
export async function getArtifact(id: string): Promise<Project> {
  return apiGet<Project>(`/projects/${id}`);
}

/**
 * 更新画布项目
 */
export async function updateArtifact(id: string, dto: UpdateArtifactRequest): Promise<Project> {
  return apiPatch<Project>(`/projects/${id}`, dto);
}

/**
 * 删除画布项目
 */
export async function deleteArtifact(id: string): Promise<{ message: string }> {
  return apiDelete<{ message: string }>(`/projects/${id}`);
}