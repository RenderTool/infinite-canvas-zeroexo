/**
 * canvas-agent/ui/store.ts — zustand store
 *
 * 独立 store，不依赖旧 agent-chat 的 createAgentChatStore。
 * 策略定义：
 *   - confirm_each: 每步都确认
 *   - auto_low_risk: 低风险步骤自动执行，高风险步骤确认
 *   - plan_only: 只规划不执行
 */

import { create } from 'zustand';
import type {
  CanvasAgentMessage,
  ClarifyItem,
  ClarifyAnswer,
  PlanData,
  ThinkingState,
  Reference,
  AgentStrategy,
} from './types.js';

/** 模拟器回调，由 simulator 注入 */
let _simulationResume: ((answers: ClarifyAnswer[]) => void) | null = null;

export function setSimulationResume(fn: ((answers: ClarifyAnswer[]) => void) | null): void {
  _simulationResume = fn;
}

export function getSimulationResume(): ((answers: ClarifyAnswer[]) => void) | null {
  return _simulationResume;
}

export interface CanvasAgentState {
  // ---- Dock 状态 ----
  dockOpen: boolean;
  setDockOpen: (open: boolean) => void;
  toggleDock: () => void;

  // ---- 消息流 ----
  messages: CanvasAgentMessage[];
  addMessage: (msg: CanvasAgentMessage) => void;
  updateMessage: (id: string, patch: Partial<CanvasAgentMessage>) => void;
  clearMessages: () => void;

  // ---- 思考态 ----
  thinking: ThinkingState;
  setThinking: (state: Partial<ThinkingState>) => void;
  appendThinkingText: (text: string) => void;
  addThinkingStep: (step: ThinkingState['steps'][0]) => void;
  updateThinkingStep: (index: number, patch: Partial<ThinkingState['steps'][0]>) => void;
  clearThinking: () => void;

  // ---- 待确认 ----
  pendingConfirm: PlanData | null;
  setPendingConfirm: (plan: PlanData | null) => void;

  // ---- 待澄清 ----
  pendingClarify: ClarifyItem[];
  setPendingClarify: (items: ClarifyItem[]) => void;
  clearPendingClarify: () => void;

  // ---- 生成状态 ----
  isGenerating: boolean;
  setIsGenerating: (v: boolean) => void;

  // ---- 输入区 ----
  inputText: string;
  setInputText: (text: string) => void;
  strategy: AgentStrategy;
  setStrategy: (s: AgentStrategy) => void;
  references: Reference[];
  addReference: (ref: Reference) => void;
  removeReference: (nodeId: string) => void;
  clearReferences: () => void;

  // ---- 选中节点（画布联动） ----
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;

  // ---- 会话（真连层使用） ----
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;

  // ---- 当前任务（真连层使用: 协议事件回执需要 taskId） ----
  currentTaskId: string | null;
  setCurrentTaskId: (id: string | null) => void;

  // ---- 重置 ----
  reset: () => void;
}

const initialThinking: ThinkingState = {
  active: false,
  text: '',
  steps: [],
  tools: [],
};

export const useCanvasAgentStore = create<CanvasAgentState>((set) => ({
  // Dock
  dockOpen: false,
  setDockOpen: (open) => set({ dockOpen: open }),
  toggleDock: () => set((s) => ({ dockOpen: !s.dockOpen })),

  // 消息流
  messages: [],
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  updateMessage: (id, patch) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),
  clearMessages: () => set({ messages: [] }),

  // 思考态
  thinking: { ...initialThinking },
  setThinking: (state) => set((s) => ({ thinking: { ...s.thinking, ...state } })),
  appendThinkingText: (text) =>
    set((s) => ({ thinking: { ...s.thinking, text: s.thinking.text + text } })),
  addThinkingStep: (step) =>
    set((s) => ({ thinking: { ...s.thinking, steps: [...s.thinking.steps, step] } })),
  updateThinkingStep: (index, patch) =>
    set((s) => {
      const steps = [...s.thinking.steps];
      if (steps[index]) steps[index] = { ...steps[index], ...patch };
      return { thinking: { ...s.thinking, steps } };
    }),
  clearThinking: () => set({ thinking: { ...initialThinking } }),

  // 待确认
  pendingConfirm: null,
  setPendingConfirm: (plan) => set({ pendingConfirm: plan }),

  // 待澄清
  pendingClarify: [],
  setPendingClarify: (items) => set({ pendingClarify: items }),
  clearPendingClarify: () => set({ pendingClarify: [] }),

  // 生成状态
  isGenerating: false,
  setIsGenerating: (v) => set({ isGenerating: v }),

  // 输入区
  inputText: '',
  setInputText: (text) => set({ inputText: text }),
  strategy: 'confirm_each',
  setStrategy: (s) => set({ strategy: s }),
  references: [],
  addReference: (ref) => set((s) => ({ references: [...s.references, ref] })),
  removeReference: (nodeId) =>
    set((s) => ({ references: s.references.filter((r) => r.nodeId !== nodeId) })),
  clearReferences: () => set({ references: [] }),

  // 选中节点
  selectedNodeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  // 会话
  activeConversationId: null,
  setActiveConversationId: (id) => set({ activeConversationId: id }),

  // 当前任务
  currentTaskId: null,
  setCurrentTaskId: (id) => set({ currentTaskId: id }),

  // 重置
  reset: () =>
    set({
      messages: [],
      thinking: { ...initialThinking },
      pendingConfirm: null,
      pendingClarify: [],
      isGenerating: false,
      inputText: '',
      strategy: 'confirm_each',
      references: [],
      selectedNodeId: null,
      currentTaskId: null,
    }),
}));