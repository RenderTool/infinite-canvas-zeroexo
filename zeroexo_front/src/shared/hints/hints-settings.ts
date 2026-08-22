/**
 * 教育提示全局开关(localStorage 持久化)
 *
 * 入口:设置弹窗(ConfigDialog)"操作提示"卡片,立即生效。
 * 消费方:ContextualShortcutsPanel(右侧面板) + GroupLayer(锚定胶囊提示,
 *         经 showHints prop 由 EditorPage 传入)。
 */

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'zeroexo:hints-enabled-v1';

function readStored(): boolean {
  try {
    // 仅显式存 '0' 视为关闭;缺失/异常默认开启
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

let enabled = readStored();
const listeners = new Set<() => void>();

/** 读取当前开关状态(非 React 场景) */
export function isHintsEnabled(): boolean {
  return enabled;
}

/** 设置开关(持久化 + 通知订阅者) */
export function setHintsEnabled(value: boolean): void {
  if (enabled === value) return;
  enabled = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // localStorage 不可用时仅内存生效
  }
  listeners.forEach((l) => l());
}

/** 订阅开关变化 */
export function subscribeHintsEnabled(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook:读取开关状态(变更自动重渲染) */
export function useHintsEnabled(): boolean {
  return useSyncExternalStore(subscribeHintsEnabled, isHintsEnabled);
}

// ===== 面板收纳状态(小三角把手,跨会话持久化) =====
// 用户可把右侧快捷键面板收纳成小三角;状态记忆,刷新后保持收纳/展开。
// 与全局开关正交:全局开关关闭时整体隐藏(含把手)。

const COLLAPSED_STORAGE_KEY = 'zeroexo:hints-panel-collapsed-v1';

function readStoredCollapsed(): boolean {
  try {
    // 仅显式存 '1' 视为收纳;缺失/异常默认展开
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let panelCollapsed = readStoredCollapsed();
const collapsedListeners = new Set<() => void>();

/** 读取面板收纳状态(非 React 场景) */
export function isHintsPanelCollapsed(): boolean {
  return panelCollapsed;
}

/** 设置面板收纳状态(持久化 + 通知订阅者) */
export function setHintsPanelCollapsed(value: boolean): void {
  if (panelCollapsed === value) return;
  panelCollapsed = value;
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, value ? '1' : '0');
  } catch {
    // localStorage 不可用时仅内存生效
  }
  collapsedListeners.forEach((l) => l());
}

/** 订阅收纳状态变化 */
export function subscribeHintsPanelCollapsed(listener: () => void): () => void {
  collapsedListeners.add(listener);
  return () => {
    collapsedListeners.delete(listener);
  };
}

/** React hook:读取面板收纳状态(变更自动重渲染) */
export function useHintsPanelCollapsed(): boolean {
  return useSyncExternalStore(subscribeHintsPanelCollapsed, isHintsPanelCollapsed);
}
