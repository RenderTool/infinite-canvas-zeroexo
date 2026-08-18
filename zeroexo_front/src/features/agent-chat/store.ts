/**
 * agent-chat/store.ts — 通用 Agent 聊天状态机工厂（ViewModel 层）
 *
 * MVVM：业务模块通过 createAgentChatStore(config) 生成自己的状态机，
 * 再交给 AgentChatShell 渲染。状态与动作与具体业务解耦：
 * - messages：消息流（contentType 驱动渲染）
 * - confirmedSteps：已确认步骤（key/value/summary）
 * - currentStepKey：当前步骤
 * - 通用动作：addMessage / confirmStep / setCurrentStep / reset / rewindToStep
 *
 * 业务模块可在 config 中声明步骤组（steps），步骤进度由状态机自动维护。
 */

import { create } from 'zustand';
import type { AgentChatConfig, AgentChatMessage, AgentStepGroup } from './types.js';

/** 已确认步骤 */
export interface ConfirmedStep {
  key: string;
  value: unknown;
  summary: string;
  confirmedAt: number;
}

export interface AgentChatState {
  messages: AgentChatMessage[];
  /** 步骤组（来自 config.steps） */
  stepGroups: AgentStepGroup[];
  /** 已确认步骤（按 key 唯一） */
  confirmedSteps: ConfirmedStep[];
  currentStepKey: string | null;
  isActive: boolean;
  isComplete: boolean;

  addMessage: (msg: AgentChatMessage) => void;
  confirmStep: (key: string, value: unknown, summary: string) => void;
  setCurrentStep: (key: string | null) => void;
  setActive: (active: boolean) => void;
  setComplete: (complete: boolean) => void;
  reset: () => void;
  /** 回退到指定步骤：移除该步骤及下游的确认状态与消息 */
  rewindToStep: (key: string) => void;
  /** 已确认步骤 key 集合（派生） */
  getConfirmedKeys: () => Set<string>;
}

/**
 * 创建泛型 Agent 聊天状态机
 * @param config 模块配置（moduleId / steps / rules）
 */
export function createAgentChatStore(config: AgentChatConfig) {
  const allStepKeys = (config.steps ?? []).flatMap((g) => g.steps.map((s) => s.key));

  return create<AgentChatState>((set, get) => ({
    messages: [],
    stepGroups: config.steps ?? [],
    confirmedSteps: [],
    currentStepKey: null,
    isActive: false,
    isComplete: false,

    addMessage: (msg) => {
      set((state) => ({ messages: [...state.messages, msg] }));
    },

    confirmStep: (key, value, summary) => {
      const now = Date.now();
      set((state) => {
        const existingIdx = state.confirmedSteps.findIndex((s) => s.key === key);
        const newStep: ConfirmedStep = { key, value, summary, confirmedAt: now };
        const newSteps =
          existingIdx >= 0
            ? state.confirmedSteps.map((s, i) => (i === existingIdx ? newStep : s))
            : [...state.confirmedSteps, newStep];

        const confirmedKeys = new Set(newSteps.map((s) => s.key));
        const allDone = allStepKeys.length > 0 && allStepKeys.every((k) => confirmedKeys.has(k));

        return {
          confirmedSteps: newSteps,
          isComplete: allDone,
        };
      });
    },

    setCurrentStep: (key) => set({ currentStepKey: key }),
    setActive: (active) => set({ isActive: active }),
    setComplete: (complete) => set({ isComplete: complete }),

    reset: () =>
      set({
        messages: [],
        confirmedSteps: [],
        currentStepKey: null,
        isActive: false,
        isComplete: false,
      }),

    rewindToStep: (key) => {
      set((state) => {
        const idx = allStepKeys.indexOf(key);
        if (idx < 0) return state;

        // 保留到该步骤的 options 消息为止（含），移除下游消息
        let targetMsgIdx = -1;
        for (let i = state.messages.length - 1; i >= 0; i--) {
          const m = state.messages[i];
          if (m && m.contentType === 'options' && m.stepKey === key) {
            targetMsgIdx = i;
            break;
          }
        }
        const messages = targetMsgIdx >= 0 ? state.messages.slice(0, targetMsgIdx + 1) : state.messages;

        // 移除该步骤及下游的确认状态
        const confirmedSteps = state.confirmedSteps.filter((s) => allStepKeys.indexOf(s.key) < idx);

        return {
          messages,
          confirmedSteps,
          currentStepKey: key,
          isComplete: false,
        };
      });
    },

    getConfirmedKeys: () => new Set(get().confirmedSteps.map((s) => s.key)),
  }));
}

/** createAgentChatStore 返回类型 */
export type AgentChatStore = ReturnType<typeof createAgentChatStore>;
