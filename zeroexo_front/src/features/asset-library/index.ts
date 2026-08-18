/**
 * asset-library - 资产库模块
 *
 * 统一管理素材、提示词、主体(角色/场景/道具)。
 * 待测试通过后,旧版 assets/prompts 页面会移除,此模块改名为 assets。
 */

export { AssetLibraryPage } from './asset-library-page.js';
export { AssetLibraryModal } from './asset-library-modal.js';
export { SubjectCreatePage } from './subject-create-page.js';
export { PromptCreatePage, type PublicPromptInitialData } from './prompt-create-page.js';
export { PublicPromptsPage, getLocalizedTitle, type PublicPromptItem } from './public-prompts-page.js';