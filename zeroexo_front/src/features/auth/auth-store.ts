/**
 * auth-store - 认证状态管理(Phase D5.3 + P0.3/P0.4 重构)
 *
 * 管理 user / accessToken / isAuthenticated。
 * Access Token 存内存(防 XSS),Refresh Token 存 sessionStorage(会话级:页面刷新可恢复,关闭浏览器即失效)。
 *
 * P0.3 改进:
 * - loading 状态基于模块级 authInitialized,initialize() 完成后才设为 false
 * - 路由守卫可据此判断是否可渲染
 *
 * P0.4 改进:
 * - 登出时清空所有本地数据(画布/素材/提示词/图片/媒体/同步状态/AI 配置)
 * - 防止下一账号看到上一账号的残留数据
 *
 * 设计:
 * - 登录/注册成功 → 保存 tokens + user → 注册到 api-client
 * - api-client 401 时调用 refreshFn → 刷新 tokens → 重试
 * - 登出 → 清空所有 tokens + user + 本地数据
 * - 刷新失败 → 自动登出
 */

import { useCallback, useEffect, useState } from 'react';
import localforage from 'localforage';
import { apiPost, setAccessToken, setRefreshFn } from '@/services/api-client.js';
import { fullSync } from '@/services/sync/sync-service.js';
import { clearAllSyncState } from '@/services/sync/sync-store.js';
import { startBcSync, stopBcSync, broadcastLogout, BROADCAST_LOGOUT_EVENT } from '@/services/sync/broadcast-channel-service.js';
import { useAiConfigStore } from '../ai-config/use-ai-config-store.js';

/** 用户信息 */
export interface User {
  id: string;
  email: string;
  username: string;
  nickname?: string;
  avatarUrl?: string;
  role: string;
}

/** 认证响应 */
interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

/** sessionStorage 读取(会话级:页面刷新可恢复,关闭浏览器即失效) */
function readSession<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** sessionStorage 写入 */
function writeSession(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch { /* sessionStorage 不可用时静默忽略 */ }
}

/** sessionStorage 移除 */
function removeSession(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch { /* sessionStorage 不可用时静默忽略 */ }
}

const REFRESH_TOKEN_KEY = 'zeroexo:refreshToken';
const USER_KEY = 'zeroexo:user';

/** 仅持久化非敏感用户字段(id/username/role),不落完整用户对象(含 email 等) */
type PersistedUser = Pick<User, 'id' | 'username' | 'role'>;

function toPersistedUser(user: User): PersistedUser {
  return { id: user.id, username: user.username, role: user.role };
}

/** 单例状态(跨 hook 共享,不使用 Context 避免组件树侵入) */
let currentUser: User | null = null;
let currentAccessToken: string | null = null;
let currentRefreshToken: string | null = null;
/** 鉴权初始化是否完成(模块加载时异步 initialize,完成后设为 true) */
let authInitialized = false;
const listeners = new Set<() => void>();

/** 通知所有监听者状态变更 */
function notify(): void {
  for (const fn of listeners) fn();
}

/** 清空所有本地数据(登出时调用,P0.4) */
async function clearAllLocalData(): Promise<void> {
  // 1. 清空同步状态(脏数据 + pendingQueue + lastSyncedAt)
  await clearAllSyncState();

  // 2. 清空 localforage 的 4 个存储桶
  const buckets = ['app_state', 'canvas', 'image_files', 'media_files'];
  await Promise.all(
    buckets.map(async (storeName) => {
      try {
        const inst = localforage.createInstance({ name: 'zeroexo', storeName });
        await inst.clear();
      } catch (err) {
        console.error(`[auth] clear bucket ${storeName} failed:`, err);
      }
    }),
  );

  // 3. 清空 localStorage 的 zustand persist 数据(AI 配置默认模型选择)
  try {
    localStorage.removeItem('zeroexo:ai_config_store');
  } catch {
    // 忽略 localStorage 不可用的场景
  }

  // 4. Bug6: 重置 AI channels(从内存中清除含 apiKey 的渠道数据)
  useAiConfigStore.getState().resetChannels();
}

/** 刷新 token(供 api-client 401 时调用) */
async function doRefresh(): Promise<string | null> {
  if (!currentRefreshToken) return null;
  try {
    const res = await apiPost<AuthResponse>('/auth/refresh', {
      refreshToken: currentRefreshToken,
    });
    currentAccessToken = res.accessToken;
    currentRefreshToken = res.refreshToken;
    setAccessToken(currentAccessToken);
    writeSession(REFRESH_TOKEN_KEY, currentRefreshToken);
    notify();
    return currentAccessToken;
  } catch {
    // 刷新失败,登出(不清空本地数据,因为可能只是网络问题)
    await logout({ clearLocalData: false });
    return null;
  }
}

/**
 * 登出(清空所有状态)
 * @param options.clearLocalData 是否清空本地数据(默认 true,登出时清空;token 刷新失败时设为 false)
 */
export async function logout(options: { clearLocalData?: boolean } = {}): Promise<void> {
  const { clearLocalData = true } = options;
  // 先广播登出事件通知其他标签页，再清理本地状态
  broadcastLogout();
  currentUser = null;
  currentAccessToken = null;
  currentRefreshToken = null;
  setAccessToken(null);
  removeSession(REFRESH_TOKEN_KEY);
  removeSession(USER_KEY);
  if (clearLocalData) {
    await clearAllLocalData();
  }
  stopBcSync();
  notify();
  // 登出后跳转到登录页(使用 hash 路由,不整页刷新)
  if (typeof window !== 'undefined') {
    window.location.hash = '#/auth';
  }
}

/** 初始化:从 sessionStorage 恢复 refresh token + 非敏感用户字段 */
async function initialize(): Promise<void> {
  currentRefreshToken = readSession<string>(REFRESH_TOKEN_KEY);
  const savedUser = readSession<PersistedUser>(USER_KEY);
  if (currentRefreshToken && savedUser) {
    // 仅恢复非敏感字段(email 等完整字段只存在于内存,以登录/刷新响应为准)
    currentUser = { id: savedUser.id, email: '', username: savedUser.username, role: savedUser.role };
    // 尝试刷新 access token
    const token = await doRefresh();
    if (token) {
      // 刷新成功后保留恢复的非敏感字段
      currentUser = { id: savedUser.id, email: '', username: savedUser.username, role: savedUser.role };
      // Bug6: 登录态恢复后,从后端拉取 AI channels
      void useAiConfigStore.getState().loadChannels();
      // 登录态恢复后触发全量同步(异步,不阻塞 UI)
      void fullSync();
      // 启动 BroadcastChannel 实时同步
      startBcSync();
    } else {
      currentUser = null;
    }
  }
  authInitialized = true;
  notify();
}

// 注册 refresh 函数到 api-client(模块加载时执行一次)
setRefreshFn(doRefresh);

// 启动时初始化(异步,不阻塞渲染)
void initialize();

// 监听其他标签页的登出广播:收到登出事件时自动登出当前页面
// 使用 passive:true 避免影响页面性能
if (typeof window !== 'undefined') {
  window.addEventListener(BROADCAST_LOGOUT_EVENT, () => {
    void logout({ clearLocalData: false });
  }, { passive: true });
}

/**
 * useAuth - 认证状态 hook
 *
 * 返回 { user, isAuthenticated, loading, login, register, logout }
 *
 * loading: 鉴权初始化是否完成(首次加载时为 true,initialize 完成后为 false)
 * 路由守卫可基于 loading 判断是否可渲染主内容
 */
export function useAuth(): {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string, code?: string) => Promise<void>;
  logout: () => Promise<void>;
} {
  const [, forceUpdate] = useState(0);

  // 订阅状态变更
  useEffect(() => {
    const listener = (): void => forceUpdate((n) => n + 1);
    listeners.add(listener);
    return (): void => {
      listeners.delete(listener);
    };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const res = await apiPost<AuthResponse>('/auth/login', { email, password });
    currentUser = res.user;
    currentAccessToken = res.accessToken;
    currentRefreshToken = res.refreshToken;
    setAccessToken(currentAccessToken);
    writeSession(REFRESH_TOKEN_KEY, currentRefreshToken);
    writeSession(USER_KEY, toPersistedUser(res.user));
    notify();
    // 登录成功后触发首次全量同步(异步,不阻塞 UI)
    void fullSync();
    // Bug6: 登录后从后端拉取 AI channels(异步,不阻塞 UI)
    void useAiConfigStore.getState().loadChannels();
    // 启动 BroadcastChannel 实时同步
    startBcSync();
  }, []);

  const register = useCallback(
    async (email: string, username: string, password: string, code?: string): Promise<void> => {
      const res = await apiPost<AuthResponse>('/auth/register', {
        email,
        username,
        password,
        code,
      });
      currentUser = res.user;
      currentAccessToken = res.accessToken;
      currentRefreshToken = res.refreshToken;
      setAccessToken(currentAccessToken);
      writeSession(REFRESH_TOKEN_KEY, currentRefreshToken);
      writeSession(USER_KEY, toPersistedUser(res.user));
      notify();
      // 注册成功后触发首次全量同步(异步,不阻塞 UI)
      void fullSync();
      // Bug6: 注册后从后端拉取 AI channels(异步,不阻塞 UI)
      void useAiConfigStore.getState().loadChannels();
      // 启动 BroadcastChannel 实时同步
      startBcSync();
    },
    [],
  );

  return {
    user: currentUser,
    isAuthenticated: !!currentAccessToken && !!currentUser,
    loading: !authInitialized,
    login,
    register,
    logout: () => logout(),
  };
}
