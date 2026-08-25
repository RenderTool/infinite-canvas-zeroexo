/**
 * 通用视频执行器 - DSL v2
 *
 * 按模板的协议描述执行视频生成：
 *   1. 组装请求体（flat 平铺 / content 数组两种风格）
 *   2. 组装认证头（Bearer / 自定义 header / Kling JWT）
 *   3. 提交任务（模板 endpoint）
 *   4. 异步任务 → 轮询；同步响应 → 直接解析
 *   5. 提取结果 URL → 下载 buffer
 *
 * 模板未声明 DSL 字段时，行为退化为 OpenAI 兼容默认：
 *   POST {baseUrl}/videos/generations，同步解析 data[0].url / data[0].b64_json
 */
import {
  AdapterContext,
  GenerateRequest,
  GenerateResult,
} from './adapter.interface';
import { applyParamMapping } from './adapter.factory';
import { buildAuthHeaders } from './kling-signer';
import { resolvePath } from './resolve-path';
import { createAbortController, isUserCancelled } from './abort-utils';
import { sniffImageMime } from './image-utils';

// ===== SSRF 防护 =====

export function assertSafeHttpUrl(url: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} 不是合法的 URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} 只允许 http/https 协议: ${url}`);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)
  ) {
    throw new Error(`${label} 禁止访问内网地址: ${hostname}`);
  }
}

// ===== 素材 base64 转换 =====

/** 从 URL 中提取 storageKey（本地存储 URL 形如 ...?key=xxx） */
function extractStorageKey(url: string): string | null {
  const match = url.match(/[/?&]key=([^&]+)/);
  if (match) return decodeURIComponent(match[1]);
  return null;
}

/** 将图片 URL 解析为 Buffer（data-url 直解 / 本地存储读取 / 远程拉取） */
async function resolveImageBuffer(imageUrl: string, ctx: AdapterContext): Promise<Buffer> {
  if (imageUrl.startsWith('data:')) {
    const match = imageUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
    if (!match) throw new Error('无效的 base64 图片格式');
    return Buffer.from(match[1], 'base64');
  }
  let buffer: Buffer;
  const storageKey = extractStorageKey(imageUrl);
  if (storageKey) {
    if (!ctx.readFile) throw new Error('缺少读取本地文件的能力');
    const fileBuffer = await ctx.readFile(storageKey);
    if (!fileBuffer) throw new Error(`参考图文件不存在: ${storageKey}`);
    buffer = fileBuffer;
  } else {
    assertSafeHttpUrl(imageUrl, '参考图 URL');
    buffer = await fetchBinary(imageUrl, ctx);
  }
  return buffer;
}

// ===== HTTP 工具 =====

/** POST JSON 并解析响应（处理取消/超时） */
async function postJson(url: string, body: unknown, ctx: AdapterContext, headers: Record<string, string>): Promise<any> {
  const { controller, cleanup } = createAbortController(ctx.timeoutMs, ctx.signal);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(
        isUserCancelled(err, ctx.signal)
          ? '用户取消'
          : `请求超时(超过 ${ctx.timeoutMs / 1000} 秒),请稍后重试`,
      );
    }
    throw err;
  } finally {
    cleanup();
  }
}

/** GET JSON（轮询专用：单独超时，不占用 ctx.timeoutMs） */
async function getJson(url: string, timeoutMs: number, ctx: AdapterContext, headers: Record<string, string>): Promise<any> {
  const { controller, cleanup } = createAbortController(timeoutMs, ctx.signal);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...headers },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`请求超时(超过 ${timeoutMs / 1000} 秒),请稍后重试`);
    }
    throw err;
  } finally {
    cleanup();
  }
}

/** 拉取远程资源为 Buffer */
async function fetchBinary(url: string, ctx: AdapterContext): Promise<Buffer> {
  const { controller, cleanup } = createAbortController(ctx.timeoutMs, ctx.signal);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`拉取资源失败 HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(
        isUserCancelled(err, ctx.signal)
          ? '用户取消'
          : `请求超时(超过 ${ctx.timeoutMs / 1000} 秒),请稍后重试`,
      );
    }
    throw err;
  } finally {
    cleanup();
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ===== 请求体组装 =====

/** content 风格：构建 content 数组（对齐 Seedance 官方结构） */
async function buildContentBody(
  req: GenerateRequest,
  ctx: AdapterContext,
  template: NonNullable<GenerateRequest['template']>,
): Promise<Record<string, any>> {
  const request = template.request ?? {};
  const roles = request.contentRoles ?? {};
  const refFormat = request.referenceFormat ?? 'url';

  const content: any[] = [{ type: 'text', text: req.prompt }];

  // 首尾帧模式判定：mode 值命中 firstLastModes（缺省仅 image-to-video-first-last-frame）
  // _uiMode 为适配器内联翻译后保留的原始前端 mode（见 VolcengineAdapter.generateVideo）
  const uiMode = (req.params._uiMode as string) ?? (req.params.mode as string) ?? 'image-to-video-first-last-frame';
  const firstLastModes = roles.firstLastModes ?? ['image-to-video-first-last-frame'];
  const isFirstLast = firstLastModes.includes(uiMode);

  // 参考图
  const refImages = req.params.referenceImages as string[] | undefined;
  if (refImages?.length) {
    for (let idx = 0; idx < refImages.length; idx++) {
      const img = refImages[idx];
      let url = img;
      if (refFormat === 'base64') {
        const buf = await resolveImageBuffer(img, ctx);
        url = `data:${sniffImageMime(buf)};base64,${buf.toString('base64')}`;
      }
      const role = isFirstLast
        ? (idx === 0 ? (roles.firstFrame ?? 'first_frame') : (roles.lastFrame ?? 'last_frame'))
        : (roles.image ?? 'reference_image');
      content.push({ type: 'image_url', image_url: { url }, role });
    }
  }
  // 参考视频
  const refVideos = req.params.referenceVideos as string[] | undefined;
  if (refVideos?.length) {
    for (const vid of refVideos) {
      content.push({ type: 'video_url', video_url: { url: vid }, role: roles.video ?? 'reference_video' });
    }
  }
  // 参考音频
  const refAudio = req.params.referenceAudio as string[] | undefined;
  if (refAudio?.length) {
    for (const aud of refAudio) {
      content.push({ type: 'audio_url', audio_url: { url: aud }, role: roles.audio ?? 'reference_audio' });
    }
  }

  // 其余参数走 paramMapping 平铺（剔除素材与 UI 参数）
  const intermediateParams: Record<string, any> = { ...req.params };
  for (const k of ['referenceImages', 'referenceVideos', 'referenceAudio',
    'maxReferenceImages', 'maxReferenceVideos', 'maxReferenceAudios',
    'referenceImagesEnabled', 'referenceVideosEnabled', 'referenceAudiosEnabled',
    '_uiMode']) {
    delete intermediateParams[k];
  }
  const mapped = applyParamMapping(intermediateParams, template);

  return { content, ...mapped };
}

/** flat 风格：参数平铺 + 素材数组字段 */
async function buildFlatBody(
  req: GenerateRequest,
  ctx: AdapterContext,
  template: NonNullable<GenerateRequest['template']>,
): Promise<Record<string, any>> {
  const request = template.request ?? {};
  const refFormat = request.referenceFormat ?? 'url';
  const intermediateParams: Record<string, any> = { ...req.params };
  for (const k of ['referenceImages', 'referenceVideos', 'referenceAudio',
    'maxReferenceImages', 'maxReferenceVideos', 'maxReferenceAudios',
    'referenceImagesEnabled', 'referenceVideosEnabled', 'referenceAudiosEnabled',
    '_uiMode']) {
    delete intermediateParams[k];
  }
  const mapped = applyParamMapping(intermediateParams, template);

  // 素材数组字段（paramMapping 映射后写入）
  const refImages = req.params.referenceImages as string[] | undefined;
  if (refImages?.length) {
    const apiField = template.paramMapping?.referenceImages ?? 'image';
    if (refFormat === 'base64') {
      const list: string[] = [];
      for (const img of refImages) {
        const buf = await resolveImageBuffer(img, ctx);
        list.push(`data:${sniffImageMime(buf)};base64,${buf.toString('base64')}`);
      }
      mapped[apiField] = list;
    } else {
      mapped[apiField] = refImages;
    }
  }
  const refVideos = req.params.referenceVideos as string[] | undefined;
  if (refVideos?.length) {
    mapped[template.paramMapping?.referenceVideos ?? 'video'] = refVideos;
  }
  const refAudio = req.params.referenceAudio as string[] | undefined;
  if (refAudio?.length) {
    mapped[template.paramMapping?.referenceAudio ?? 'audio'] = refAudio;
  }
  return mapped;
}

// ===== URL 构建 =====

/** 提交 URL：模板 endpoint 或 OpenAI 兼容默认 */
function buildSubmitUrl(ctx: AdapterContext, template: NonNullable<GenerateRequest['template']>): string {
  const baseUrl = ctx.baseUrl.replace(/\/$/, '');
  const endpoint = template.endpoint;
  if (!endpoint) return `${baseUrl}/videos/generations`;
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    assertSafeHttpUrl(endpoint, '模板 endpoint');
    return endpoint;
  }
  const url = `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  assertSafeHttpUrl(url, '模板 endpoint');
  return url;
}

/** 轮询 URL：pollUrlTemplate 中 {id} 替换为任务 ID */
function buildPollUrl(ctx: AdapterContext, pollUrlTemplate: string, taskId: string): string {
  const url = pollUrlTemplate.replace(/\{id\}/g, encodeURIComponent(taskId));
  const full = url.startsWith('http://') || url.startsWith('https://')
    ? url
    : `${ctx.baseUrl.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}`;
  assertSafeHttpUrl(full, '模板 pollUrlTemplate');
  return full;
}

// ===== 主入口 =====

/**
 * 按模板 DSL 执行视频生成
 * @returns 视频 buffer 结果
 */
export async function executeVideoByTemplate(
  req: GenerateRequest,
  ctx: AdapterContext,
  template?: GenerateRequest['template'],
): Promise<GenerateResult> {
  // 模板优先级：显式入参 > req.template（调用点常只传 req）
  const tpl = template ?? req.template ?? {};
  const authHeaders = buildAuthHeaders(tpl.auth, ctx.apiKey, ctx.secretKey);
  const submitUrl = buildSubmitUrl(ctx, tpl);

  // ─── 1. 组装请求体 ───
  const bodyStyle = tpl.request?.bodyStyle ?? 'flat';
  const body: Record<string, any> = {
    model: req.model,
    ...(bodyStyle === 'content'
      ? await buildContentBody(req, ctx, tpl)
      : await buildFlatBody(req, ctx, tpl)),
  };

  // ─── 2. 提交任务 ───
  const submitResult = await postJson(submitUrl, body, ctx, authHeaders);

  // ─── 3. 异步任务 → 轮询 ───
  const task = tpl.task;
  if (task) {
    const taskId = resolvePath(submitResult, task.submitIdPath);
    if (!taskId) {
      throw new Error(`视频任务创建失败：未在响应中找到任务 ID（路径: ${task.submitIdPath}，响应: ${JSON.stringify(submitResult).slice(0, 300)}）`);
    }

    const pollUrl = buildPollUrl(ctx, task.pollUrlTemplate, String(taskId));
    const pollStart = Date.now();
    const maxPollMs = task.maxPollMs ?? 10 * 60 * 1000;
    const pollIntervalMs = task.pollIntervalMs ?? 5000;

    while (Date.now() - pollStart < maxPollMs) {
      if (ctx.signal?.aborted) throw new Error('用户取消');
      const taskResult = await getJson(pollUrl, 30_000, ctx, authHeaders);
      const status = resolvePath(taskResult, task.statusPath) as string | undefined;
      const statusStr = status != null ? String(status) : '';

      if (task.successValues.includes(statusStr)) {
        const resultValue = resolvePath(taskResult, task.resultPath);
        if (!resultValue) {
          throw new Error(`视频生成成功但未找到结果（路径: ${task.resultPath}，响应: ${JSON.stringify(taskResult).slice(0, 300)}）`);
        }
        const result = await downloadResult(resultValue, ctx);
        // 尾帧提取：模板配置 lastFramePath(如 content.last_frame_url)时下载尾帧并随结果返回,
        // 前端勾选「返回尾帧」后可多出一个尾帧图片节点(连续视频工作流: 尾帧 → 下一段首帧)。
        // 容错：尾帧缺失/下载失败只降级(不带尾帧),不阻塞主视频结果
        const lastFramePath = task.lastFramePath ?? 'content.last_frame_url';
        const lastFrameValue = resolvePath(taskResult, lastFramePath);
        const lastFrameUrl =
          typeof lastFrameValue === 'string'
            ? lastFrameValue
            : (lastFrameValue && typeof lastFrameValue === 'object'
                ? (lastFrameValue as { url?: unknown }).url ?? ''
                : '');
        if (lastFrameUrl) {
          try {
            assertSafeHttpUrl(String(lastFrameUrl), '尾帧结果 URL');
            const lastFrameBuffer = await fetchBinary(String(lastFrameUrl), ctx);
            result.lastFrame = {
              buffer: lastFrameBuffer,
              mimeType: 'image/png',
              ext: 'png',
            };
          } catch (err) {
            console.warn(`尾帧下载失败(降级,不影响主视频): ${String(err)}`);
          }
        }
        return result;
      }

      if (task.failureValues.includes(statusStr)) {
        const errInfo = JSON.stringify(taskResult).slice(0, 300);
        throw new Error(`视频生成失败（状态: ${statusStr}）: ${errInfo}`);
      }

      await delay(pollIntervalMs);
    }
    throw new Error(`视频生成超时（超过 ${Math.round(maxPollMs / 60000)} 分钟）`);
  }

  // ─── 4. 同步响应 → 直接解析 ───
  const sync = tpl.sync;
  if (sync?.resultPath) {
    const resultValue = resolvePath(submitResult, sync.resultPath);
    if (resultValue) return await downloadResult(resultValue, ctx);
  }
  // OpenAI 兼容兜底：data[0].url / data[0].b64_json
  const data = submitResult?.data as any[] | undefined;
  const item = Array.isArray(data) ? data[0] : undefined;
  if (item?.url) return await downloadResult(item.url, ctx);
  if (item?.b64_json) {
    const buffer = Buffer.from(item.b64_json, 'base64');
    return { kind: 'video', buffer, mimeType: 'video/mp4', ext: 'mp4' };
  }
  throw new Error(`视频生成失败：响应中未找到结果（响应: ${JSON.stringify(submitResult).slice(0, 300)}）`);
}

/** 结果可能是 URL（下载）或对象（含 url 字段） */
async function downloadResult(resultValue: any, ctx: AdapterContext): Promise<GenerateResult> {
  let url: string;
  if (typeof resultValue === 'string') {
    url = resultValue;
  } else if (resultValue && typeof resultValue === 'object') {
    url = resultValue.url ?? resultValue.video_url ?? '';
  } else {
    url = '';
  }
  if (!url) {
    throw new Error(`视频生成结果缺少 URL: ${JSON.stringify(resultValue).slice(0, 200)}`);
  }
  assertSafeHttpUrl(url, '视频结果 URL');
  const buffer = await fetchBinary(url, ctx);
  return { kind: 'video', buffer, mimeType: 'video/mp4', ext: 'mp4' };
}
