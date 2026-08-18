/**
 * agent-chat/renderers/index.ts — 内置渲染器统一注册
 *
 * 数据驱动显示规则的落地：导入本模块即把 5 种内置 contentType
 * （text / options / article-list / thinking / banner）注册进全局注册表。
 * 业务模块可再注册自定义类型（如 'setup-options'）或覆盖内置类型。
 */

import { registerRenderer } from '../renderer-registry.js';
import { TextRenderer } from './TextRenderer.js';
import { OptionsRenderer } from './OptionsRenderer.js';
import { ArticleListRenderer } from './ArticleListRenderer.js';
import { ThinkingRenderer } from './ThinkingRenderer.js';
import { BannerRenderer } from './BannerRenderer.js';

export { TextRenderer, OptionsRenderer, ArticleListRenderer, ThinkingRenderer, BannerRenderer };

/** 注册全部内置渲染器（幂等，重复导入不会产生副作用） */
export function registerBuiltinRenderers(): void {
  registerRenderer('text', TextRenderer);
  registerRenderer('options', OptionsRenderer);
  registerRenderer('article-list', ArticleListRenderer);
  registerRenderer('thinking', ThinkingRenderer);
  registerRenderer('banner', BannerRenderer);
}

// 模块加载即注册，保证任何使用 AgentChatShell / renderMessage 的模块开箱即用
registerBuiltinRenderers();
