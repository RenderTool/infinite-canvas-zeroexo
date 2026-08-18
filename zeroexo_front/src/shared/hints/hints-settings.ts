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
