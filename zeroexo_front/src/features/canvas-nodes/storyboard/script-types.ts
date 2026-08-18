/**
 * script-editor/types.ts - 剧本编辑器数据类型
 */

/** 剧本来源类型 */
export type ScriptSource = 'full' | 'topic';

/** 剧本来源定义 */
export interface ScriptSourceDef {
  type: ScriptSource;
  label: string;
  icon: string;
  description: string;
}

/** AI 聊天消息 */
export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/** 剧集分析结果 */
export interface EpisodeAnalysis {
  intents: string[];
  narrative_rhythm: string;
  emotional_arc: string[];
  key_plot_points: string[];
  scene_count: number;
  tone: string;
  pacing: string;
}

/** 剧集状态 */
export type EpisodeStatus = 'draft' | 'reviewing' | 'complete';

/** 剧集 */
export interface Episode {
  id: string;
  number: number;
  title: string;
  content: string;
  analysis?: EpisodeAnalysis;
  sourceEpisode?: {
    versionId: string;
    episodeId: string;
  };
  // ===== Phase 5 扩展字段（保持向后兼容，旧数据无这些字段） =====
  /** 剧情摘要（AI 自动生成或手动编辑） */
  summary?: string;
  /** 剧集状态：草稿 / 审核中 / 已完成 */
  status?: EpisodeStatus;
  /** 该集占多少页（自动计算） */
  pageCount?: number;
  /** 估算时长（分钟，1 页 ≈ 1 分钟） */
  estimatedDuration?: number;
  /** 手动分页标记（字符索引数组） */
  pageBreaks?: number[];
  createdAt?: string;
  updatedAt?: string;
}

/** 剧本版本 */
export interface ScriptVersion {
  id: string;
  name: string;
  source: string; // 'AI生成-悬疑' | '用户手写' | '混合版-...'
  createdAt: string;
  episodes: Episode[];
}

/** 剧本编辑器状态 */
export interface ScriptEditorState {
  versions: ScriptVersion[];
  activeVersionId: string;
  activeEpisodeId: string;
  loading: boolean;
  saving: boolean;
  lastSavedAt: string | null;
  chatHistory?: AiChatMessage[];
  // ===== Phase 5 扩展（可选，保持向后兼容） =====
  /** 当前版本总页数（自动计算） */
  pageCount?: number;
  /** 当前版本估算时长 */
  estimatedDuration?: string;
}

/** 剧本块类型（Phase 5 好莱坞格式） */
export type ScriptBlockType =
  | 'scene-heading'
  | 'action'
  | 'character'
  | 'dialogue'
  | 'parenthetical'
  | 'transition'
  | 'text';

/** 结构化剧本块 */
export interface ScriptBlock {
  id: string;
  type: ScriptBlockType;
  content: string;
  pageNumber?: number; // 所在页码
  episodeId?: string;  // 所属剧集 ID
}

/** 页信息 */
export interface ScriptPage {
  pageNumber: number;
  startBlock: string; // 起始 block ID
  endBlock: string;   // 结束 block ID
  estimatedDuration: number; // 估算时长（分钟）
}

/** 阅读模式配置 */
export interface ReadingModeConfig {
  open: boolean;
  currentPage: number;
  totalPages: number;
  animation: 'fade' | 'flip' | 'slide';
  episodes: Array<{
    id: string;
    title: string;
    pages: Array<{
      pageNumber: number;
      content: string; // 该页的 HTML 内容
    }>;
  }>;
}
