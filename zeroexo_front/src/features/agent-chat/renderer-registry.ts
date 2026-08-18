/**
 * agent-chat/renderer-registry.ts — 消息渲染器注册表
 *
 * 核心机制：消息渲染按 contentType 数据驱动分发。
 * - 业务模块通过 registerRenderer(type, component) 注册自己的渲染形式
 * - AgentChatShell 遍历消息时用 getRenderer(msg.contentType) 取出渲染器
 * - 未注册的类型回退到 TextRenderer，保证任何数据都可渲染
 *
 * 内置类型注册在 renderers/index.ts（Text / Options / ArticleList / Thinking / Banner）。
 */

import { createElement, type ReactElement } from 'react';
import type { AgentContentType, AgentMessageRenderer, MessageRendererProps } from './types.js';

const registry = new Map<string, AgentMessageRenderer>();

/** 注册渲染器（同名覆盖；支持内置类型与业务自定义类型） */
export function registerRenderer(type: AgentContentType, renderer: AgentMessageRenderer): void {
  registry.set(type, renderer);
}

/** 获取渲染器（未注册回退 null，由调用方决定兜底） */
export function getRenderer(type: AgentContentType): AgentMessageRenderer | null {
  return registry.get(type) ?? null;
}

/** 是否已注册 */
export function hasRenderer(type: AgentContentType): boolean {
  return registry.has(type);
}

/** 卸载渲染器（测试 / 热插拔用） */
export function unregisterRenderer(type: AgentContentType): void {
  registry.delete(type);
}

/** 清空全部注册（测试用） */
export function clearRenderers(): void {
  registry.clear();
}

/** 渲染消息：按 contentType 分发（无渲染器时渲染 null） */
export function renderMessage(props: MessageRendererProps): ReactElement | null {
  const Renderer = getRenderer(props.message.contentType);
  if (!Renderer) return null;
  return createElement(Renderer, props);
}
