/**
 * script-import types - 剧本导入模块类型定义
 */

import type { ThinkingStep } from '@/services/ai-think-service.js';
import type { ScriptEditorState } from './script-types.js';

/** 剧本来源方式 */
export type ScriptSourceType = 'import' | 'inspire';

/** 导入的文件信息 */
export interface ImportFileInfo {
  name: string;
  size: number;
  type: 'txt' | 'docx' | 'md';
  content: string;
  status: 'pending' | 'parsing' | 'done' | 'error';
  error?: string;
}

/** 多文件分析结果 */
export interface FileAnalysisResult {
  duplicateDetected: boolean;
  duplicateFiles: string[];
  formatDetected: 'script' | 'storyboard' | 'novel' | 'essay' | 'unknown';
  suggestedOrder: string[];
  totalLength: number;
  estimatedTokens: number;
}

/** 分集配置 */
export interface EpisodeConfig {
  mode: 'auto' | 'manual' | 'none';
  count: number;
  aiAssigned: boolean;
  aiPreview?: string[];  // AI 建议的各集标题
}

/** 分批处理状态 */
export interface BatchProcessState {
  totalBatches: number;
  currentBatch: number;
  status: 'idle' | 'processing' | 'done' | 'error';
  errorMessage: string | null;
  batchSummaries: string[];
}

/** 参数对比项 */
export interface ParamDiff {
  key: string;
  label: string;
  importValue: string;
  setupValue: string;
  suggestedValue: string;
  severity: 'critical' | 'minor' | 'same';
}

/** 参数对比结果 */
export interface ParamComparison {
  diffs: ParamDiff[];
  hasDifferences: boolean;
}

/** 剧本导入完整状态 */
export interface ScriptImportState {
  sourceType: ScriptSourceType | null;
  step: 'select' | 'upload' | 'file_analysis' | 'episode_config' | 'param_compare' | 'preview' | 'done';
  files: ImportFileInfo[];
  fileAnalysis: FileAnalysisResult | null;
  episodeConfig: EpisodeConfig | null;
  paramComparison: ParamComparison | null;
  batchProcess: BatchProcessState | null;
}

/** 剧本导入步骤 */
export type FlowStep = 'upload' | 'confirm_files' | 'episode_config' | 'ai_generating' | 'preview';

/** AI 返回的剧集数据 */
export interface ParsedEpisode {
  number: number;
  title: string;
  content: string;
}

/** 历史记录 */
export interface HistoryRecord {
  id: string;
  fileName: string;
  fileSize: number;
  fileHash: string;
  importedAt: number;
  episodeCount: number;
  fileType: 'txt' | 'docx' | 'md';
}

/** 步骤缓存 */
export interface StepCache {
  step: FlowStep;
  files: ImportFileInfo[];
  mergedContent: string;
  episodeMode: 'auto' | 'manual' | 'none';
  manualEpisodeCount: number;
  thinkingSteps: ThinkingStep[];
  parsedEpisodes: ParsedEpisode[];
  savedAt: number;
}

/** 后端思考任务断点记录结构 */
export interface TaskPersist {
  taskId: string;
  files: ImportFileInfo[];
  mergedContent: string;
  episodeMode: 'auto' | 'manual' | 'none';
  manualEpisodeCount: number;
  savedAt: number;
}

/** AI 渠道 */
export interface AiChannel {
  id: string;
  provider: string;
  name: string;
  models: Array<{ name: string; capabilities?: string[] }>;
}

/** ScriptImportModal Props */
export interface ScriptImportModalProps {
  open: boolean;
  onClose: () => void;
  project: { id: string; config?: Record<string, unknown>; script?: unknown };
  projectSetupConfig: { setupStatus: string; brief: string; report: unknown; schemes: unknown[]; selectedSchemeId: string | null; confirmedScheme: unknown; };
  onComplete: (scriptState: ScriptEditorState) => void;
}