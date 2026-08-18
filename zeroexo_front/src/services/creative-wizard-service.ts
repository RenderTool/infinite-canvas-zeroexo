/**
 * creative-wizard-service - 创意工坊 API 封装
 *
 * 调用后端 /api/creative-wizard 端点。
 */

import { apiGet, apiPost } from './api-client';

/** 预设模板（与后端一致） */
export interface PresetTemplate {
  id: string;
  label: string;
  icon: string;
  description: string;
  params: Record<string, unknown>;
}

/** AI 生成的方案卡片 */
export interface SchemeCard {
  id: string;
  title: string;
  tag: string;
  description: string;
  style: string[];
  duration: string;
  vibe: string;
}

/** 获取预设模板列表 */
export async function getTemplates(): Promise<PresetTemplate[]> {
  return apiGet<PresetTemplate[]>('/creative-wizard/templates');
}

/** AI 根据描述生成创意方案 */
export async function generateSchemes(input: string): Promise<SchemeCard[]> {
  return apiPost<SchemeCard[]>('/creative-wizard/generate', { input });
}