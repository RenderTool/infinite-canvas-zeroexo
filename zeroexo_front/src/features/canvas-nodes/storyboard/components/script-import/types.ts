/**
 * script-import types - 剧本导入流程类型定义
 */

/** 文本素材项（带预览状态） */
export interface TextAssetItem {
  id: string;
  title: string;
  content: string;
  chapters: number;
  bytes: number;
  estimatedTokens: number;
}

/** 生成偏好 */
export interface GenerationPreference {
  dramaType: 'short' | 'standard' | 'long' | 'custom';
  customDuration?: number;
  genres?: string[];
  language: 'zh' | 'en' | 'bilingual';
}

/** 剧集分配方式 */
export type AssignMode = 'merge' | 'one-to-one' | 'ai-split';

/** 流程步骤 */
export type FlowStep = 'select' | 'confirm' | 'preference' | 'assign' | 'generating' | 'preview';

/** Token 预估统计 */
export interface TokenEstimate {
  inputTokens: number;
  totalChars: number;
}

/** AI 返回的剧集数据 */
export interface ParsedEpisode {
  number: number;
  title: string;
  content: string;
}