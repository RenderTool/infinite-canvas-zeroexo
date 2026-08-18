/**
 * agent-panel/types.ts — 全局 Agent 面板类型定义
 */

import type { AgentChatMessage } from '@/features/agent-chat/types.js';

/** 阶段对应的 Agent 角色配置 */
export interface PhaseAgentRole {
  key: string;
  label: string;
  /** Agent 角色名（如"立项大师"） */
  role: string;
  /** 后端 Agent 类型（对应 skills/ 目录下的目录名） */
  agentType: string;
  /** 默认欢迎消息 */
  welcomeMessage: string;
}

/** 预定义的阶段 Agent 角色 */
export const PHASE_AGENT_ROLES: PhaseAgentRole[] = [
  {
    key: 'setup',
    label: '立项',
    role: '立项大师',
    agentType: 'project_setup',
    welcomeMessage: '你好！我是立项大师，我可以帮你完善项目信息、填写配置参数。\n\n你可以选择以下预设模板，或直接输入你的项目需求：',
  },
  {
    key: 'script',
    label: '剧本',
    role: '剧本大师',
    agentType: 'script_writer',
    welcomeMessage: '你好！我是剧本大师，我可以帮你生成剧本大纲、改写、扩写等。\n\n选择以下功能，或直接描述你的剧本需求：',
  },
  {
    key: 'storyboard',
    label: '分镜',
    role: '分镜大师',
    agentType: 'storyboard_assistant',
    welcomeMessage: '你好！我是分镜大师，我可以帮你设计分镜方案。',
  },
  {
    key: 'workbench',
    label: '出片',
    role: '出片大师',
    agentType: 'canvas_agent',
    welcomeMessage: '你好！我是出片大师，我可以帮你生成素材与合成方案。',
  },
  {
    key: 'editor',
    label: '剪辑',
    role: '剪辑大师',
    agentType: 'canvas_agent',
    welcomeMessage: '你好！我是剪辑大师，我可以帮你规划剪辑方案。',
  },
];

/**
 * 根据 phase key 获取对应的 agentType
 * @param phaseKey 阶段 key（如 'setup', 'script' 等）
 * @returns 后端 agentType，如 'project_setup', 'script_writer' 等
 */
export function getAgentTypeByPhase(phaseKey: string): string {
  const role = PHASE_AGENT_ROLES.find((r) => r.key === phaseKey);
  return role?.agentType ?? 'canvas_agent';
}

/** 全局 Agent 面板状态 */
export interface AgentPanelState {
  open: boolean;
  activePhase: string;
  /** 按阶段存储的聊天消息 */
  phaseMessages: Record<string, AgentChatMessage[]>;
  /** 输入文本 */
  inputText: string;
}