/**
 * AI 工作台共享类型定义
 *
 * 包含图像、视频、语音等多 Tab 共享的类型。
 * 参数相关类型（ParameterDef / PersistedParamConfig / ChannelConstraints）
 * 定义在 ./param-types 中，不在此重复。
 */
import type { ParameterDef, ChannelConstraints } from './param-types';

/** AI 渠道基本类型，多 Tab 共享 */
export interface ProviderItem {
  id: string;
  name: string;
  provider: string;
  config?: Record<string, any>;
}

/** 模型下拉选项 */
export interface ModelOption {
  label: string;
  value: string;
  type: string;
  iconProvider: string;
}

/** 参考图（图生图输入） */
export interface ReferenceImage {
  id: string;
  url: string;
  name: string;
}

/** 参考视频 */
export interface ReferenceVideo {
  id: string;
  url: string;
  name: string;
  duration?: number; // 视频时长（秒）
}

/** 参考音频 */
export interface ReferenceAudio {
  id: string;
  url: string;
  name: string;
  duration?: number; // 音频时长（秒）
}

/** 生成结果图片 */
export interface ResultImage {
  id: string;
  url: string;
  width: number;
  height: number;
  size?: number;
  durationMs?: number;
  costTokens?: number;
}

/** 生成结果视频 */
export interface ResultVideo {
  id: string;
  url: string;
  width: number;
  height: number;
  durationMs?: number;
  costTokens?: number;
}

/** 历史记录中的一条生成记录（前端展示用） */
export interface GenerationRecord {
  id: string;
  createdAt: number;
  prompt: string;
  providerId: string;
  providerName: string;
  model: string;
  params: Record<string, any>;
  rawParams: Record<string, any>;  // 未过滤的原始参数（含 _resultUrl 等）
  references: ReferenceImage[];
  results: ResultImage[];
  successCount: number;
  failCount: number;
  durationMs: number;
  status: 'success' | 'failed' | 'running' | 'cancelled' | 'pending';
  errorMessage?: string;
}

/** 模板定义（与后端返回的模板结构一致） */
export interface TemplateDef {
  id: string;
  name: string;
  parameters: ParameterDef[];
  channelConstraints?: ChannelConstraints;
  matchKeywords: string[];
  maxPromptLength?: number;
}
