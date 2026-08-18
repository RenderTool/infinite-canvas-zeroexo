/**
 * api-client - 后端 HTTP 客户端(Phase D5)
 *
 * 封装 fetch 调用,自动注入 JWT Authorization header。
 * 401 时自动刷新 token 并重试。
 *
 * 后端地址: 通过 Vite 环境变量 VITE_API_BASE_URL 配置(默认 /api,由 Vite proxy 转发到 localhost:3000)
 * 后端独立工程位于 d:\AICode\canvas\zeroexo-server\
 */

declare global {
  interface Window {
    env?: {
      API_BASE_URL?: string;
    };
  }
}

const envApiUrl = window.env?.API_BASE_URL;
const viteApiUrl = import.meta.env.VITE_API_BASE_URL;

/** 后端 API 基础地址(优先级: window.env > VITE_API_BASE_URL > 默认值 /api) */
const API_BASE = envApiUrl ?? viteApiUrl ?? '/api';

export function getApiBaseUrl(): string {
  return API_BASE;
}

/** Access Token(由 auth-store 注入,仅存模块级内存,不落任何持久化存储,防 XSS 窃取) */
let accessToken: string | null = null;

/** Refresh Token 刷新回调(由 auth-store 注册) */
let refreshFn: (() => Promise<string | null>) | null = null;

/** 注册 access token 设值器(供 auth-store 调用) */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** 获取当前 access token(供 SSE 等需要直接访问 token 的场景) */
export function getToken(): string | null {
  return accessToken;
}

/** 注册 refresh 函数(供 auth-store 调用) */
export function setRefreshFn(fn: (() => Promise<string | null>) | null): void {
  refreshFn = fn;
}

/** 是否正在刷新 token(防止递归刷新) */
let isRefreshing = false;

/** API 错误 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
    /** 后端业务错误码(如 AUTH_INVALID_CREDENTIALS),无则 undefined */
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 原始 fetch 封装(不自动刷新) */
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
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message =
      (body as { message?: string })?.message ?? `HTTP ${res.status}`;
    const code = (body as { code?: string })?.code;
    throw new ApiError(res.status, body, message, code);
  }
  // 后端 TransformInterceptor 统一返回 { data: T }
  const wrapped = body as { data?: T };
  return (wrapped?.data ?? (body as T)) as T;
}

/**
 * 带 401 自动刷新的 fetch 封装
 * 401 时调用 refreshFn 刷新 token,然后重试一次
 *
 * 防递归刷新:isRefreshing 标志防止 /auth/refresh 端点自身返回 401 时
 * 无限递归调用 refreshFn,导致调用栈溢出或浏览器卡死。
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  try {
    return await rawFetch<T>(path, options);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && refreshFn && !isRefreshing) {
      isRefreshing = true;
      try {
        const newToken = await refreshFn();
        if (newToken) {
          return rawFetch<T>(path, options);
        }
      } finally {
        isRefreshing = false;
      }
    }
    throw err;
  }
}

/** GET 请求 */
export function apiGet<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'GET' });
}

/** POST 请求 */
export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** PATCH 请求 */
export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** DELETE 请求 */
export function apiDelete<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'DELETE' });
}

/** PUT 请求 */
export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/**
 * multipart/form-data 上传（自动注入 JWT，不设置 JSON Content-Type）
 * @param path API 路径（如 /creation/import-history/raw）
 * @param file 二进制文件
 * @param fields 额外的表单字段（字符串）
 */
export function apiUploadFile<T>(
  path: string,
  file: Blob,
  fileName: string,
  fields?: Record<string, string>,
): Promise<T> {
  const form = new FormData();
  form.append('file', file, fileName);
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      form.append(k, v);
    }
  }
  return apiFetch<T>(path, {
    method: 'POST',
    body: form,
  });
}

/**
 * 将绝对 URL 规范化为相对路径(如果 URL 指向本地后端)。
 * 这样上传请求会走 Vite 代理,避免 CORS 预检失败。
 *
 * 场景:后端 presign 返回 uploadUrl = "http://localhost:3000/api/storage/put?..."
 *       直接 PUT 到该 URL 会触发跨域。转换成 "/api/storage/put?..." 后
 *       走 Vite dev/preview 代理转发到后端,同源无 CORS 问题。
 */
function normalizeUploadUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const backendHosts = ['localhost:3000', '127.0.0.1:3000'];
    const isBackend = backendHosts.some(
      (h) => parsed.host === h || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1',
    );
    if (isBackend) {
      return parsed.pathname + parsed.search;
    }
    return url;
  } catch {
    return url;
  }
}

/** PUT 请求(用于 MinIO 预签名直传二进制文件,支持上传进度回调) */
export function apiPutBinary(
  uploadUrl: string,
  file: File | Blob,
  contentType: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const normalizedUrl = normalizeUploadUrl(uploadUrl);
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', normalizedUrl);
    xhr.setRequestHeader('Content-Type', contentType);

    // 上传进度回调(lengthComputable 为 false 时无法计算百分比)
    if (onProgress) {
      xhr.upload.onprogress = (e: ProgressEvent): void => {
        if (e.lengthComputable) {
          onProgress(e.loaded, e.total);
        }
      };
    }

    xhr.onload = (): void => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new ApiError(xhr.status, null, `Upload failed: HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = (): void => {
      reject(new ApiError(0, null, 'Upload network error'));
    };
    xhr.send(file);
  });
}
