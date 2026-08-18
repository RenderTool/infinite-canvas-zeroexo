import { message } from 'antd';

declare global {
  interface Window {
    env?: {
      API_BASE_URL?: string;
    };
  }
}

const envApiUrl = window.env?.API_BASE_URL;
const API_BASE = envApiUrl ?? '/api';

let accessToken: string | null = null;
let refreshTokenValue: string | null = null;
let isRefreshing = false;
type PendingTask = (token: string) => void;
const refreshQueue: PendingTask[] = [];

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setRefreshToken(token: string | null): void {
  refreshTokenValue = token;
}

export function getApiBaseUrl(): string {
  return API_BASE;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * 尝试刷新 token
 * 返回新的 accessToken，失败则返回 null
 *
 * 安全说明：
 * - accessToken 保存在内存（模块变量）+ localStorage（供页面刷新后恢复会话，短期有效）
 * - refreshToken 仅存入 sessionStorage（标签页级、关闭即失效），
 *   降低其在 localStorage 中长期明文驻留的泄露面（XSS 窃取后无法离线换取新 token）
 */
async function tryRefreshToken(): Promise<string | null> {
  const rt = refreshTokenValue ?? sessionStorage.getItem('admin-refresh-token');
  if (!rt) return null;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const w = data as { data?: { accessToken: string; refreshToken: string } };
    const body = w.data ?? data;
    if (body.accessToken) {
      accessToken = body.accessToken;
      refreshTokenValue = body.refreshToken ?? rt;
      localStorage.setItem('admin-token', body.accessToken);
      sessionStorage.setItem('admin-refresh-token', refreshTokenValue!);
      return body.accessToken;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 当收到 401 时：排队等待，仅第一个请求触发刷新，其余排队等候
 */
function handleUnauthorized(err: ApiError, retry: () => Promise<any>) {
  if (err.status === 401 && refreshTokenValue) {
    return new Promise<any>((resolve, reject) => {
      refreshQueue.push((token: string) => {
        setAccessToken(token);
        resolve(retry());
      });
      if (!isRefreshing) {
        isRefreshing = true;
        tryRefreshToken().then((newToken) => {
          isRefreshing = false;
          if (newToken) {
            const q = [...refreshQueue];
            refreshQueue.length = 0;
            q.forEach((fn) => fn(newToken));
          } else {
            const q = [...refreshQueue];
            refreshQueue.length = 0;
            q.forEach((_fn) => reject(err));
            // 刷新失败 -> 清除登录态跳转
            accessToken = null;
            refreshTokenValue = null;
            try {
              localStorage.removeItem('admin-token');
              sessionStorage.removeItem('admin-refresh-token');
              localStorage.removeItem('admin-user');
            } catch { /* ignore */ }
            message.error('登录已过期,请重新登录');
            setTimeout(() => { window.location.href = '/admin/login'; }, 600);
          }
        }).catch(() => {
          isRefreshing = false;
          const q = [...refreshQueue];
          refreshQueue.length = 0;
          q.forEach((_fn) => reject(err));
          accessToken = null;
          refreshTokenValue = null;
          try {
            localStorage.removeItem('admin-token');
            sessionStorage.removeItem('admin-refresh-token');
            localStorage.removeItem('admin-user');
          } catch { /* ignore */ }
          message.error('登录已过期,请重新登录');
          setTimeout(() => { window.location.href = '/admin/login'; }, 600);
        });
      }
    });
  }
  return null;
}

/**
 * 统一 API 错误提示 - 按状态码分类,透传后端具体错误信息。
 * - 401: 会被 handleUnauthorized 拦截，仅非刷新请求抵达这里
 * - 403: 显示后端返回的"需要管理员权限"等具体提示
 * - 其他: 优先显示后端 message,缺失时使用 fallback
 * - 非 ApiError(网络错误等): 显示 fallback
 */
export function showApiError(err: unknown, fallback: string): void {
  if (err instanceof ApiError) {
    if (err.status === 401) {
      accessToken = null;
      try {
        localStorage.removeItem('admin-token');
        sessionStorage.removeItem('admin-refresh-token');
        localStorage.removeItem('admin-user');
      } catch {
        // 忽略 localStorage 访问异常
      }
      message.error('登录已过期,请重新登录');
      setTimeout(() => {
        window.location.href = '/admin/login';
      }, 600);
      return;
    }
    if (err.status === 403) {
      message.error(err.message || '权限不足');
      return;
    }
    if (err.status === 502) {
      message.error('服务暂时不可用，请稍后重试');
      return;
    }
    message.error(err.message || fallback);
    return;
  }
  if (err instanceof Error && err.message && !(err instanceof TypeError)) {
    message.error(err.message || fallback);
    return;
  }
  message.error(fallback);
}

async function rawFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const messageVal =
      (body as { message?: string })?.message ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, body, messageVal);
  }
  const wrapped = body as { data?: T };
  return (wrapped?.data ?? (body as T)) as T;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let retries = 0;
  const maxRetries = 1;
  const doFetch = async (): Promise<T> => {
    try {
      return await rawFetch<T>(path, options);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && retries < maxRetries) {
        retries++;
        const handled = handleUnauthorized(err, doFetch);
        if (handled) return handled;
        throw err;
      }
      throw err;
    }
  };
  return doFetch();
}

export function apiGet<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'GET' });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'DELETE' });
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
