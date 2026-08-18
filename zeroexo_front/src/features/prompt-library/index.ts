/**
 * prompt-library feature - 提示词库(Phase D3)
 *
 * 提供本地提示词管理:CRUD + 搜索 + 分类筛选 + 收藏 + 拖拽到画布。
 */

export { usePrompts } from './use-prompts.js';
export {
  listPrompts,
  addPrompt,
  updatePrompt,
  removePrompt,
  removePrompts,
  clearAllPrompts,
  PROMPT_CATEGORIES,
} from './prompt-store.js';
export type {
  Prompt,
  PromptCategory,
  CreatePromptInput,
  UpdatePromptInput,
  InsertPromptPayload,
} from './prompt-store.js';
