/**
 * agent-chat/index.ts — 通用 Agent 聊天框架出口
 *
 * 接入方式（插件式，MVVM）：
 * 1. 配置：声明 AgentChatConfig（moduleId/title/tag/steps/rules/agentLabel…）
 * 2. 数据：生产 AgentChatMessage[]（携带 contentType 决定渲染形式）
 * 3. 状态：createAgentChatStore(config) 生成 ViewModel（可选）
 * 4. 渲染：<AgentChatShell config messages theme callbacks />，
 *    消息按 contentType 从注册表分发；可 registerRenderer 注册自定义排版
 *
 * 导入本模块即自动注册 5 种内置渲染器（text/options/article-list/thinking/banner）。
 */

export * from './types.js';
export * from './renderer-registry.js';
export * from './store.js';
export * from './StepsSidebar.js';
export * from './AgentChatShell.js';
export * from './components/AgentAvatar.js';
export * from './components/AgentInputBar.js';
export * from './renderers/index.js';
