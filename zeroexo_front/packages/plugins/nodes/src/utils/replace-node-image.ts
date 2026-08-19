/**
 * 统一的节点图片替换工具 - 所有替换路径(节点内替换、工具栏替换、AI生成)
 * 都调用此函数,确保行为一致:上传 → 更新data → 调整节点尺寸为图片比例。
 *
 * 上传策略:
 *   优先  → 后端 sharp 多尺寸管道(POST /api/resources/presign + PUT)
 *   降级  → 本地 localforage 存储(uploadImage)
 *
 * 通过 CommandQueue 提交命令,支持撤销/重做。
 */

import type { CommandQueue, NodeRecord } from '@zeroexo/core';
import { UpdateNodeDataCommand, ResizeNodeCommand } from '@zeroexo/core';
import { uploadImage } from '@zeroexo/plugin-persistence';
import { getToken } from '@/services/api-client.js';

// ===== 后端上传(纯 fetch,无第三方依赖) =====

/** 获取 API 基础地址 */
function getApiBase(): string {
  if (typeof window !== 'undefined') {
    return (window as unknown as Record<string, unknown>).env
      ? ((window as unknown as Record<string, unknown>).env as Record<string, string>).API_BASE_URL ?? '/api'
      : '/api';
  }
  return '/api';
}

/** 从 File 对象读取图片宽高 */
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
      reject(new Error('无法加载图片'));
    };
    img.src = url;
  });
}

/** 计算 Blob 的 SHA-256 哈希(十六进制字符串),用于 CAS 去重 */
async function computeSha256(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 后端上传(sharp 多尺寸管道 + CAS 去重)
 * 返回的 storageKey 以 'resources/' 开头(CAS 路径),可在 hydrate 中通过 ?size= 参数请求不同尺寸
 */
async function uploadToBackend(
  file: File,
): Promise<{ storageKey: string; width: number; height: number; bytes: number; mimeType: string }> {
  const base = getApiBase();
  const token = getToken();

  // 1. 计算内容哈希(CAS 去重)
  const contentHash = await computeSha256(file);

  // 2. presign(携带 contentHash 走 CAS 路径)
  const presignRes = await fetch(`${base}/resources/presign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      contentHash,
    }),
  });
  if (!presignRes.ok) {
    throw new Error(`presign 失败: HTTP ${presignRes.status}`);
  }
  const presignBody = await presignRes.json();
  const presign = (presignBody?.data ?? presignBody) as { uploadUrl: string; storageKey: string };

  // 3. 上传文件(uploadUrl 为 null 表示 CAS 去重命中,跳过上传)
  if (presign.uploadUrl) {
    const putRes = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!putRes.ok) {
      throw new Error(`PUT 上传失败: HTTP ${putRes.status}`);
    }
  }

  // 4. 读取图片尺寸
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

// ===== 节点图片替换 =====

/**
 * 替换节点图片 - 统一API。
 *
 * @param commandQueue 命令队列
 * @param node 目标节点(需含 id, position, size)
 * @param file 图片文件
 * @param options 可选: onStatusChange 回调
 */
export async function replaceNodeImage(
  commandQueue: CommandQueue | undefined,
  node: NodeRecord,
  file: File,
  options?: {
    onStatusChange?: (status: string) => void;
  },
): Promise<void> {
  if (!file.type.startsWith('image/')) return;
  if (!commandQueue) {
    console.warn('replaceNodeImage: commandQueue is undefined, cannot execute commands');
    return;
  }

  options?.onStatusChange?.('loading');

  try {
    // 预读取图片尺寸(在上传前完成,确保无论哪条上传路径成功都有有效尺寸)
    // 修复: uploadToBackend 的 readImageMetaFromFile 静默失败时 width=0,height=0
    // → ratio=NaN → ResizeNodeCommand 设 height=NaN → 节点渲染异常(1:1方块或不可见)
    let fileWidth = 0;
    let fileHeight = 0;
    try {
      const fileMeta = await readImageMetaFromFile(file);
      fileWidth = fileMeta.width;
      fileHeight = fileMeta.height;
    } catch {
      // 静默失败,后续使用默认 16:9 比例
    }

    // 优先走后端 sharp 多尺寸管道,失败时降级到本地 localforage
    let storageKey: string;
    let url: string;
    let width: number;
    let height: number;
    let bytes: number;
    let mimeType: string;

    const token = getToken();
    if (token) {
      try {
        const backendResult = await uploadToBackend(file);
        storageKey = backendResult.storageKey;
        url = '';   // 后端 key 不需要 blob URL, hydrate 会通过 ?size= 参数加载
        // 优先使用上传返回的尺寸,失败时用预读值兜底
        width = backendResult.width > 0 ? backendResult.width : fileWidth;
        height = backendResult.height > 0 ? backendResult.height : fileHeight;
        bytes = backendResult.bytes;
        mimeType = backendResult.mimeType;
      } catch (err) {
        console.warn('[replaceNodeImage] backend upload failed, falling back to localforage', err);
        const img = await uploadImage(file);
        storageKey = img.storageKey;
        url = img.url;
        width = img.width > 0 ? img.width : fileWidth;
        height = img.height > 0 ? img.height : fileHeight;
        bytes = img.bytes;
        mimeType = img.mimeType;
      }
    } else {
      const img = await uploadImage(file);
      storageKey = img.storageKey;
      url = img.url;
      width = img.width > 0 ? img.width : fileWidth;
      height = img.height > 0 ? img.height : fileHeight;
      bytes = img.bytes;
      mimeType = img.mimeType;
    }

    // 1. 更新节点 data(content, storageKey, naturalWidth/Height 等)
    commandQueue.execute(
      new UpdateNodeDataCommand(node.id, {
        content: url,
        storageKey,
        status: 'success',
        naturalWidth: width,
        naturalHeight: height,
        mimeType,
        bytes,
        errorDetails: undefined,
        errorType: undefined,
      } as Record<string, unknown>),
    );

    // 2. 调整节点尺寸为图片比例:使用基准宽度 620px(与 DEFAULT_SIZES['image'] 一致)
    // 确保拖拽/空节点上传时图片按基准尺寸缩放,而非当前节点尺寸
    const BASE_WIDTH = 620;
    const currentWidth = node.size?.width ?? BASE_WIDTH;
    const useBaseWidth = Math.abs(currentWidth - 80) <= 5 || currentWidth < 200 || !node.size;
    const refWidth = useBaseWidth ? BASE_WIDTH : currentWidth;
    // 安全兜底: 宽高均无效时默认 16:9 比例,避免 NaN 导致节点渲染异常
    const ratio = (width > 0 && height > 0) ? height / width : 9 / 16;
    const newHeight = Math.round(refWidth * ratio);
    const oldRect = {
      x: node.position.x,
      y: node.position.y,
      width: node.size?.width ?? 340,
      height: node.size?.height ?? 240,
    };
    commandQueue.execute(
      new ResizeNodeCommand(node.id, oldRect, {
        ...oldRect,
        // 修复: newRect.width 必须使用 refWidth(620 基准或当前宽度),
        // 不能沿用 oldRect.width —— 空节点(size=undefined)时 oldRect 回退 340,
        // 而 newHeight 按 refWidth=620 计算,宽高基准不一致 → 节点变成 1:1 方块
        width: refWidth,
        height: newHeight,
      }),
    );

    options?.onStatusChange?.('success');
  } catch (err) {
    commandQueue.execute(
      new UpdateNodeDataCommand(node.id, {
        status: 'error',
        errorDetails: err instanceof Error ? err.message : String(err),
      } as Record<string, unknown>),
    );
    options?.onStatusChange?.('error');
  }
}
