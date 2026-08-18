/**
 * script-import-service - 剧本导入服务
 * 
 * 提供文件解析和 AI 调用功能
 */
import { apiGet } from '@/services/api-client.js';

export interface AiChannel {
  id: string;
  provider: string;
  name: string;
  models: Array<{ name: string; capabilities?: string[] }>;
}

export async function fetchAiChannels(): Promise<AiChannel[]> {
  try {
    const res = await apiGet<{ items: AiChannel[] }>('/ai/channels');
    return res?.items ?? [];
  } catch {
    return [];
  }
}