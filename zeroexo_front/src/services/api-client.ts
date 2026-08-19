/**
 * api-client - 后端 HTTP 客户端(Phase D5)
 *
 * 封装 fetch 调用,自动注入 JWT Authorization header。
 * 401 时自动刷新 token 并重试。
 *
 * 后端地址: 通过 Vite 环境变量 VITE_API_BASE_URL 配置(默认 /api,由 Vite proxy 转发到 localhost:3000)
 * 后端独立工程位于 d:\AICode\canvas\zeroexo-server\
 */

import { netDebug } from '../features/dev-performance/net-debug';

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
    /** 429 限流时服务端建议的等待秒数(Retry-After / body.retryAfter),无则 undefined */
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * 从 429 响应中解析服务端建议的重试等待秒数。
 * 优先级:body.retryAfter(后端标准化 429 响应) > Retry-After 响应头 > undefined
 */
function parseRetryAfter(res: Response, body: unknown): number | undefined {
  const fromBody = (body as { retryAfter?: number })?.retryAfter;
  if (typeof fromBody === 'number' && Number.isFinite(fromBody) && fromBody >= 0) {
    return Math.ceil(fromBody);
  }
  const header = res.headers.get('Retry-After');
  if (header) {
    const sec = Number(header);
    if (Number.isFinite(sec) && sec >= 0) return Math.ceil(sec);
    // HTTP-date 格式的 Retry-After 暂不支持,忽略
  }
  return undefined;
}

/**
 * 调试埋点门控:仅 DEV 构建生效。
 * 生产构建时 import.meta.env.DEV 静态替换为 false,
 * 所有埋点代码块连同 net-debug 模块整体被 Rollup 死代码剔除,
 * 生产包不残留任何调试埋点(防内部架构信息泄露)。
 */
const DEV_DEBUG = import.meta.env.DEV;

/** DEV 专用:HTTP 请求埋点(生产构建中此调用块被剔除) */
function dbgRequest(opts: Parameters<typeof netDebug.recordRequest>[0]): void {
  if (DEV_DEBUG) netDebug.recordRequest(opts);
}

/**
 * 解析 RFC 9239 / GitHub 惯例的限流响应头(后端 ApiThrottlerGuard 已输出):
 * - X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset(ISO 时刻)
 * 返回供 netDebug 记录的配额快照;头缺失时返回 undefined。
 */
function parseRateLimitHeaders(
  res: Response,
  path: string,
): { key: string; limit: number; remaining: number; resetAt: number } | undefined {
  // 仅 DEV 埋点需要;生产构建跳过解析,零开销
  if (!DEV_DEBUG) return undefined;
  const limit = Number(res.headers.get('X-RateLimit-Limit'));
  const remaining = Number(res.headers.get('X-RateLimit-Remaining'));
  if (!Number.isFinite(limit)) return undefined;
  const resetHeader = res.headers.get('X-RateLimit-Reset');
  let resetAt = 0;
  if (resetHeader) {
    const epochSec = Number(resetHeader);
    // 后端返回 ISO 字符串;兼容纯数字(epoch 秒)
    resetAt = Number.isFinite(epochSec) ? epochSec : Math.floor(new Date(resetHeader).getTime() / 1000);
    if (!Number.isFinite(resetAt)) resetAt = 0;
  }
  // 端点分类 key:取 path 前两段(如 /resources/presign → resources)
  const segs = path.split('/').filter(Boolean);
  const key = segs[0] ?? 'default';
  return { key, limit, remaining: Number.isFinite(remaining) ? remaining : 0, resetAt };
}

/** 429 自动退避重试的最大次数(防重试风暴) */
const MAX_429_RETRIES = 3;
/** 单次退避等待上限(ms):后端窗口 60s,但退避过久会阻塞交互,30s 封顶 */
const MAX_BACKOFF_MS = 30_000;

/** 计算 429 退避等待 ms:服务端建议(retryAfter/Reset 头) > 指数退避 + 随机抖动 */
function backoffMs(attempt: number, retryAfterSec: number | undefined, resetAtSec: number): number {
  let wait: number;
  if (retryAfterSec !== undefined && retryAfterSec > 0) {
    wait = retryAfterSec * 1000;
  } else if (resetAtSec > 0) {
    wait = Math.max(500, resetAtSec * 1000 - Date.now());
  } else {
    wait = 1000 * 2 ** attempt; // 1s/2s/4s
  }
  // 随机抖动 ±20%,避免多并发请求同时苏醒造成重试风暴
  const jitter = wait * (Math.random() * 0.4 - 0.2);
  return Math.min(MAX_BACKOFF_MS, Math.max(200, wait + jitter));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
  const startedAt = performance.now();
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  // 限流头埋点(所有响应都尝试解析,供 NET 面板展示实时配额)
  const rateLimit = parseRateLimitHeaders(res, path);
  if (!res.ok) {
    // 401 未登录(无 token 或 token 失效且无法刷新):给出明确、可识别的提示
    let message =
      (body as { message?: string })?.message ?? `HTTP ${res.status}`;
    let code = (body as { code?: string })?.code;
    if (res.status === 401) {
      code = code ?? 'AUTH_UNAUTHORIZED';
      if (!accessToken) {
        message = message === `HTTP ${res.status}` ? '请先登录后再操作' : message;
      }
    }
    // 429 限流:附带服务端建议的重试等待秒数,供调用方按 Retry-After 自节流
    const retryAfter =
      res.status === 429 ? parseRetryAfter(res, body) : undefined;
    if (res.status === 429 && DEV_DEBUG) {
      dbgRequest({
        path,
        status: res.status,
        durationMs: performance.now() - startedAt,
        rateLimit,
        is429: true,
        retryAfter,
        tier: (body as { tier?: string })?.tier,
      });
    }
    throw new ApiError(res.status, body, message, code, retryAfter);
  }
  if (DEV_DEBUG) {
    dbgRequest({
      path,
      status: res.status,
      durationMs: performance.now() - startedAt,
      rateLimit,
    });
  }
  // 后端 TransformInterceptor 统一返回 { data: T }
  const wrapped = body as { data?: T };
  return (wrapped?.data ?? (body as T)) as T;
}

/**
 * 带 401 自动刷新 + 429 指数退避重试的 fetch 封装
 *
 * - 401 时调用 refreshFn 刷新 token,然后重试一次
 * - 429 时按服务端建议(Retry-After / X-RateLimit-Reset)或指数退避 + 随机抖动重试,
 *   最多 MAX_429_RETRIES 次(社区最佳实践:GitHub/Google 均推荐该模式,防重试风暴)
 *
 * 防递归刷新:isRefreshing 标志防止 /auth/refresh 端点自身返回 401 时
 * 无限递归调用 refreshFn,导致调用栈溢出或浏览器卡死。
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await rawFetch<T>(path, options);
    } catch (err) {
      // 429 自适应退避重试(服务端未处理请求,重试安全;生产环境保留——RFC 标准实践)
      if (err instanceof ApiError && err.status === 429 && attempt < MAX_429_RETRIES) {
        const resetAt = (() => {
          if (!DEV_DEBUG) return 0;
          // 从已记录的限流快照中取 reset 时刻(避免重复解析 header)
          const snap = netDebug.snapshot().rateLimits;
          const seg = path.split('/').filter(Boolean)[0] ?? 'default';
          return snap.find((r) => r.key === seg)?.resetAt ?? 0;
        })();
        const wait = backoffMs(attempt, err.retryAfter, resetAt);
        attempt += 1;
        await sleep(wait);
        continue;
      }
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

/** PUT 请求(用于 MinIO 预签名直传二进制文件,支持上传进度回调与 429 退避重试) */
export function apiPutBinary(
  uploadUrl: string,
  file: File | Blob,
  contentType: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const normalizedUrl = normalizeUploadUrl(uploadUrl);
  const bytes = file.size;

  const attemptOnce = (): Promise<{ ok: boolean; retryAfter?: number }> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', normalizedUrl);
      xhr.setRequestHeader('Content-Type', contentType);
      // 后端 /api/storage/put 受 JwtAuthGuard 保护,必须携带 token(否则 401)
      if (accessToken) {
        xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
      }

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
          resolve({ ok: true });
        } else if (xhr.status === 429) {
          // 解析服务端退避建议(Retry-After 头)
          const ra = Number(xhr.getResponseHeader('Retry-After'));
          resolve({ ok: false, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : undefined });
        } else {
          reject(new ApiError(xhr.status, null, `Upload failed: HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = (): void => {
        reject(new ApiError(0, null, 'Upload network error'));
      };
      xhr.send(file);
    });

  return (async (): Promise<void> => {
    const startedAt = performance.now();
    let attempt = 0;
    for (;;) {
      const r = await attemptOnce();
      if (r.ok) {
        if (DEV_DEBUG) netDebug.recordUpload(bytes, performance.now() - startedAt);
        return;
      }
      // 429:指数退避 + 抖动重试(PUT 未写入,重试安全)
      if (attempt < MAX_429_RETRIES) {
        const wait = backoffMs(attempt, r.retryAfter, 0);
        attempt += 1;
        await sleep(wait);
        continue;
      }
      throw new ApiError(429, null, 'Upload rate limited after retries', 'RATE_LIMITED');
    }
  })();
}
