/**
 * cards - 卡片组件导出
 *
 * 各卡片组件在模块加载时自动调用 registerCard 注册到卡片注册表。
 * 只需导入此文件即可触发所有卡片注册。
 */

export { registerCard, getCardRenderer, getRegisteredTypes, isRegistered } from './card-registry.js';
export type { GridCardRendererProps, ListCardRendererProps } from './card-registry.js';

// 导入卡片组件以触发注册（side-effect import）
import './asset-card.js';
import './script-card.js';
import './prompt-card.js';