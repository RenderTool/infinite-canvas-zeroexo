/**
 * 统一后端上传服务 —— 所有上传接口统一走后端 sharp 多尺寸管道
 *
 * 流程:
 *   POST /api/resources/presign → { uploadUrl, storageKey }
 *   PUT uploadUrl(后端自动生成 __thumb / __preview 变体)
 *   POST /api/resources → 创建资产元记录
 *
 * 前端 GET 时通过 ?size=thumb|preview|full 请求对应尺寸。
 *
 * 后端 key 格式: resources/{userId}/{nanoid}.{ext}
 * 本地 key 格式: image:{nanoid}
 * 两者共存,后端优先,本地降级。
 */
import { apiPutBinary, getApiBaseUrl } from './api-client.js';
import { apiFetch } from './api-client.js';
import { netDebug } from '../features/dev-performance/net-debug.js';

/** 调试埋点门控:仅 DEV 构建生效,生产包不残留埋点代码 */
const DEV_DEBUG = import.meta.env.DEV;

export type ImageSizeParam = 'thumb' | 'preview' | 'full';

/** presign 响应 */
interface PresignResult {
  uploadUrl: string | null;
  storageKey: string;
}

/** 判断 storageKey 是否为后端格式(resources/ 开头,统一前缀) */
export function isBackendKey(storageKey?: string): boolean {
  return !!storageKey && storageKey.startsWith('resources/');
}

/** 构建后端图片 GET URL(带 ?size= 参数)。
 * 私有资源(resources/front/ 前缀)依赖 JWT 鉴权,但 URL 中不拼接 token;
 * <img>/<video> 等媒体标签请使用 useAuthImageUrl / AuthorizedImage(fetch + Authorization header + blob URL)。
 */
export function backendImageUrl(storageKey: string, size: ImageSizeParam = 'full'): string {
  const encoded = encodeURIComponent(storageKey);
  return `${getApiBaseUrl()}/storage/get?key=${encoded}&size=${size}`;
}

/**
 * 获取图片/媒体的后端 URL(按尺寸)
 * 如果是后端 key,返回 backendImageUrl;
 * 如果是本地 key,返回空(由调用方降级到 localforage)
 */
export function getBackendUrl(
  storageKey: string | undefined,
  size: ImageSizeParam = 'full',
): string | null {
  if (!storageKey || !isBackendKey(storageKey)) return null;
  return backendImageUrl(storageKey, size);
}

/** 超过此大小的文件跳过 SHA-256 哈希(避免全量加载到内存导致 OOM) */
const MAX_HASH_SIZE = 100 * 1024 * 1024; // 100MB

/** 计算 Blob 的 SHA-256 哈希(十六进制字符串),用于 CAS 去重 */
async function computeSha256(blob: Blob): Promise<string | null> {
  // 大文件跳过哈希,避免全量加载到内存;CAS 去重只对小于 100MB 的文件生效
  if (blob.size > MAX_HASH_SIZE) return null;
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 统一上传:优先走后端(CAS 去重),失败时降级到传入的 fallback
 */
export async function uploadToBackend(
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ storageKey: string; width: number; height: number; bytes: number; mimeType: string }> {
  // 1. 计算内容哈希(CAS 去重,>100MB 跳过哈希避免 OOM)
  const contentHash = await computeSha256(file);
  const presignBody: Record<string, unknown> = {
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
  };
  if (contentHash) presignBody.contentHash = contentHash;

  // 2. 获取预签名 URL(携带 contentHash 走 CAS 路径)
  const presignStart = performance.now();
  const presign = await apiFetch<PresignResult>('/resources/presign', {
    method: 'POST',
    body: JSON.stringify(presignBody),
  });
  if (DEV_DEBUG) netDebug.recordPresign(performance.now() - presignStart);

  // 3. 上传文件(uploadUrl 为 null 表示 CAS 去重命中,跳过上传)
  if (presign.uploadUrl) {
    if (DEV_DEBUG) netDebug.recordCas(false);
    await apiPutBinary(presign.uploadUrl, file, file.type || 'application/octet-stream', onProgress);
  } else {
    if (DEV_DEBUG) netDebug.recordCas(true);
  }

  // 4. 读取尺寸元信息(从 file blob 中提取)
  let width = 0;
  let height = 0;
  if (file.type.startsWith('image/')) {
    try {
      const meta = await readImageMetaFromFile(file);
      width = meta.width;
      height = meta.height;
    } catch {
      // 静默失败
    }
  }

  return {
    storageKey: presign.storageKey,
    width,
    height,
    bytes: file.size,
    mimeType: file.type || 'application/octet-stream',
  };
}

/** 从 File 对象读图片宽高 */
function readImageMetaFromFile(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}
