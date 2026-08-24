/**
 * sync-utils - 同步工具函数模块(从 sync-service.ts 提取)
 *
 * Phase3(Yjs 单主干)后收敛为:防抖常量、待删除追踪、本地未推送检查、
 * 标签页失活检测。旧冲突检测/合批重试/脏标记(FastArray DirtyMask)/
 * 协作抑制闸已随 HTTP 写路径整体退役。
 */

import { listAssets } from '@/features/asset-picker/asset-store.js';
import { listPrompts } from '@/features/prompt-library/prompt-store.js';
import { setTabInactive } from './sync-store.js';

// ===== 调试函数 =====

const isDev = import.meta.env.DEV;

function debugLog(...args: unknown[]): void {
  if (isDev) console.log('[sync]', ...args);
}

function debugError(...args: unknown[]): void {
  if (isDev) console.error('[sync]', ...args);
}

// ===== 防抖常量 =====

/** 全量同步防抖间隔(ms) */
const FULL_SYNC_DEBOUNCE_MS = 1000;

// ===== 待删除项目追踪 =====

const PENDING_DELETE_KEY = 'zeroexo:pending-delete-cloud-ids';
const pendingDeleteCloudIds = new Set<string>();

function persistPendingDelete(): void {
  try {
    localStorage.setItem(PENDING_DELETE_KEY, JSON.stringify(Array.from(pendingDeleteCloudIds)));
  } catch { /* noop */ }
}

function loadPendingDelete(): void {
  try {
    const raw = localStorage.getItem(PENDING_DELETE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) arr.forEach((id: string) => pendingDeleteCloudIds.add(id));
    }
  } catch { /* noop */ }
}
loadPendingDelete();

function markPendingDelete(cloudId: string): void {
  pendingDeleteCloudIds.add(cloudId);
  persistPendingDelete();
}

function clearPendingDelete(cloudId: string): void {
  pendingDeleteCloudIds.delete(cloudId);
  persistPendingDelete();
}

// ===== 推送队列(已随 HTTP 写路径退役) =====

// ===== 检查本地是否有未推送修改 =====

async function hasLocalChanges(): Promise<boolean> {
  // 1. 检查是否有未同步的本地资产(无 cloudId)
  const localAssets = await listAssets();
  for (const a of localAssets) {
    if (!a.cloudId) return true;
  }

  // 2. 检查是否有未同步的本地提示词(无 cloudId)
  const localPrompts = await listPrompts();
  for (const p of localPrompts) {
    if (!p.cloudId) return true;
  }

  return false;
}

// ===== 标签页失活检测(离屏时暂停同步) =====

if (typeof document !== 'undefined') {
  let prevVisibility = document.visibilityState;
  document.addEventListener('visibilitychange', () => {
    const hidden = document.visibilityState === 'hidden';
    if (hidden === (prevVisibility === 'hidden')) return; // 无变化
    prevVisibility = document.visibilityState;

    setTabInactive(hidden);
  });
}

// ===== 导出 =====

export {
  FULL_SYNC_DEBOUNCE_MS,
  hasLocalChanges,
  markPendingDelete,
  clearPendingDelete,
  pendingDeleteCloudIds,
  debugLog,
  debugError,
};
