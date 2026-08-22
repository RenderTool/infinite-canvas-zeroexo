/**
 * MessageRenderer - 消息分发渲染器
 *
 * 基于 contentType 分发到对应的消息块组件。
 * 注册机制：registerBlockRenderer(type, component)
 * 未注册类型回退到 TextBlock
 */

import { createElement, type ComponentType } from 'react';
import type { CanvasAgentMessage, CanvasAgentMessageType } from '../types.js';
import { TextBlock } from './TextBlock.js';
import { QuestionBlock } from './QuestionBlock.js';
import { ClarifyBlock } from './ClarifyBlock.js';
import { PlanBlock } from './PlanBlock.js';
import { ProgressBlock } from './ProgressBlock.js';
import { StepBlock } from './StepBlock.js';
import { MarkdownBlock } from './MarkdownBlock.js';
import { TimelineBlock } from './TimelineBlock.js';

/** 注册表：消息类型 → 渲染组件 */
const registry: Partial<Record<CanvasAgentMessageType, ComponentType<{ message: CanvasAgentMessage }>>> = {
  text: TextBlock,
  question: QuestionBlock,
  clarify: ClarifyBlock,
  plan: PlanBlock,
  progress: ProgressBlock,
  step: StepBlock,
  md: MarkdownBlock,
  timeline: TimelineBlock,
};

export interface MessageRendererProps {
  message: CanvasAgentMessage;
}

export function MessageRenderer({ message }: MessageRendererProps): React.ReactElement {
  const Component = registry[message.type];
  if (!Component) {
    // 回退到 TextBlock
    return <TextBlock message={message} />;
  }
  return createElement(Component, { message });
}

/** 注册自定义消息渲染器 */
export function registerBlockRenderer(
  type: CanvasAgentMessageType,
  component: ComponentType<{ message: CanvasAgentMessage }>,
): void {
  registry[type] = component;
}