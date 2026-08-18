/**
 * 素材上传服务(Phase D2.2)
 *
 * 接收 File 对象,优先上传到后端(sharp 多尺寸管道),
 * 完成后端不可用时降级到 localforage 存储。
 *
 * 问题10 扩展: 统一素材保存/上传/插入/编辑复用逻辑
 * - assetInputFromNode: 节点 → CreateAssetInput(直接复用节点已有 storageKey,不重复上传)
 * - nodeDataPatchFromAssetInput: CreateAssetInput → 节点 data patch(供 replace/编辑复用)
 */

import {
  uploadImage,
  uploadMediaFile,
} from '@zeroexo/plugin-persistence';
import type { NodeRecord } from '@zeroexo/core';
import type { Asset, AssetKind } from '../index.js';
import type { CreateAssetInput } from '../asset-store.js';
import { uploadToBackend } from '@/services/backend-upload.js';
import { getToken } from '@/services/api-client.js';

export class UnsupportedFileTypeError extends Error {
  constructor(public fileName: string, public mimeType: string) {
    super(`文件 "${fileName}" 的格式不支持。当前仅支持图片、视频、音频和文本文件。`);
    this.name = 'UnsupportedFileTypeError';
  }
}

export class FileTooLargeError extends Error {
  constructor(public fileName: string, public size: number, public limit: string) {
    super(`文件 "${fileName}" 过大(${(size / 1024 / 1024).toFixed(1)}MB)，超出上传限制(${limit})。`);
    this.name = 'FileTooLargeError';
  }
}

/** 各类文件大小限制 */
const FILE_SIZE_LIMITS: Record<string, number> = {
  image: 50 * 1024 * 1024,   // 50MB
  video: 2 * 1024 * 1024 * 1024,  // 2GB
  audio: 500 * 1024 * 1024,  // 500MB
  text: 10 * 1024 * 1024,    // 10MB
};

/** 已知扩展名 → MIME 类型映射(用于扩展名校验,不信任浏览器 file.type) */
const EXTENSION_MIME_MAP: Record<string, string> = {
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'bmp': 'image/bmp',
  'svg': 'image/svg+xml',
  'mp4': 'video/mp4',
  'webm': 'video/webm',
  'ogg': 'video/ogg',
  'mkv': 'video/mkv',
  'mov': 'video/quicktime',
  'mp3': 'audio/mpeg',
  'wav': 'audio/wav',
  'aac': 'audio/aac',
  'txt': 'text/plain',
  'md': 'text/markdown',
  'html': 'text/html',
  'htm': 'text/html',
  'json': 'application/json',
  'xml': 'text/xml',
  'csv': 'text/csv',
};

/** 根据文件扩展名推断 MIME 类型(当 file.type 为空时使用) */
function inferMimeType(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  return EXTENSION_MIME_MAP[ext] ?? null;
}

const SUPPORTED_MIME_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'],
  video: ['video/mp4', 'video/webm', 'video/ogg', 'video/mkv', 'video/quicktime'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/aac'],
  text: ['text/plain', 'text/markdown', 'text/html', 'application/json'],
} as const;

const ALL_SUPPORTED_MIME_TYPES = [
  ...SUPPORTED_MIME_TYPES.image,
  ...SUPPORTED_MIME_TYPES.video,
  ...SUPPORTED_MIME_TYPES.audio,
  ...SUPPORTED_MIME_TYPES.text,
];

export function getSupportedFileTypes(): string {
  return [...ALL_SUPPORTED_MIME_TYPES, '.md'].join(',');
}

function isSupportedType(mimeType: string): boolean {
  return ALL_SUPPORTED_MIME_TYPES.includes(mimeType as typeof ALL_SUPPORTED_MIME_TYPES[number]);
}

export function detectKind(mimeType: string): AssetKind {
  if (SUPPORTED_MIME_TYPES.image.includes(mimeType as typeof SUPPORTED_MIME_TYPES.image[number])) return 'image';
  if (SUPPORTED_MIME_TYPES.video.includes(mimeType as typeof SUPPORTED_MIME_TYPES.video[number])) return 'video';
  if (SUPPORTED_MIME_TYPES.audio.includes(mimeType as typeof SUPPORTED_MIME_TYPES.audio[number])) return 'audio';
  if (SUPPORTED_MIME_TYPES.text.includes(mimeType as typeof SUPPORTED_MIME_TYPES.text[number])) return 'text';
  throw new UnsupportedFileTypeError('', mimeType);
}

export async function uploadAsset(
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<CreateAssetInput> {
  // 1. 扩展名校验(不信任浏览器 file.type,防止 .ts→video/mp4 等误识别)
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext && !EXTENSION_MIME_MAP[ext]) {
    throw new UnsupportedFileTypeError(file.name, `.${ext}`);
  }

  // 当 file.type 为空时从扩展名推断
  const effectiveMimeType = file.type || inferMimeType(file.name) || 'application/octet-stream';

  if (!isSupportedType(effectiveMimeType)) {
    throw new UnsupportedFileTypeError(file.name, effectiveMimeType);
  }

  const kind = detectKind(effectiveMimeType);
  const title = file.name;

  // 2. 文件大小校验
  const limit = FILE_SIZE_LIMITS[kind];
  if (limit && file.size > limit) {
    throw new FileTooLargeError(file.name, file.size, kind === 'image' ? '50MB' : kind === 'video' ? '2GB' : kind === 'audio' ? '500MB' : '10MB');
  }

  // 优先走后端(带 sharp 多尺寸管道)
  if (getToken()) {
    try {
      const backendResult = await uploadToBackend(file, onProgress);
      const common = {
        title,
        bytes: backendResult.bytes,
        mimeType: backendResult.mimeType,
        coverUrl: backendResult.storageKey,
      };
      if (kind === 'image') {
        return {
          ...common,
          kind: 'image',
          data: {
            kind: 'image',
            dataUrl: URL.createObjectURL(file),
            storageKey: backendResult.storageKey,
            width: backendResult.width,
            height: backendResult.height,
          },
        };
      }
      if (kind === 'video') {
        return {
          ...common,
          kind: 'video',
          data: {
            kind: 'video',
            url: URL.createObjectURL(file),
            storageKey: backendResult.storageKey,
            width: backendResult.width,
            height: backendResult.height,
          },
        };
      }
      if (kind === 'audio') {
        return {
          ...common,
          kind: 'audio',
          data: {
            kind: 'audio',
            url: URL.createObjectURL(file),
            storageKey: backendResult.storageKey,
          },
        };
      }
    } catch {
      // 后端上传失败,降级到本地存储
      console.warn('[uploadAsset] backend upload failed, falling back to localforage');
    }
  }

  // 降级:本地 localforage 存储
  if (kind === 'image') {
    const img = await uploadImage(file);
    return {
      title,
      kind: 'image',
      coverUrl: img.storageKey,
      bytes: img.bytes,
      mimeType: img.mimeType,
      data: {
        kind: 'image',
        dataUrl: img.url,
        storageKey: img.storageKey,
        width: img.width,
        height: img.height,
      },
    };
  }

  if (kind === 'video') {
    const media = await uploadMediaFile(file, 'video');
    return {
      title,
      kind: 'video',
      coverUrl: media.storageKey,
      bytes: media.bytes,
      mimeType: media.mimeType,
      data: {
        kind: 'video',
        url: media.url,
        storageKey: media.storageKey,
        width: media.width,
        height: media.height,
        durationMs: media.durationMs,
      },
    };
  }

  if (kind === 'audio') {
    const media = await uploadMediaFile(file, 'audio');
    return {
      title,
      kind: 'audio',
      coverUrl: media.storageKey,
      bytes: media.bytes,
      mimeType: media.mimeType,
      data: {
        kind: 'audio',
        url: media.url,
        storageKey: media.storageKey,
        durationMs: media.durationMs,
      },
    };
  }

  const content = await file.text();
  return {
    title,
    kind: 'text',
    bytes: file.size,
    mimeType: effectiveMimeType,
    data: {
      kind: 'text',
      content,
    },
  };
}

export async function uploadAssets(files: File[]): Promise<CreateAssetInput[]> {
  const results: CreateAssetInput[] = [];
  for (const file of files) {
    try {
      const input = await uploadAsset(file);
      results.push(input);
    } catch (err) {
      console.error(`[uploadAssets] failed to upload ${file.name}:`, err);
    }
  }
  return results;
}

export function getAssetStorageKey(asset: Asset): string | undefined {
  if (asset.data.kind === 'text') return undefined;
  return asset.data.storageKey;
}

/** 将剧本节点的 episodes 序列化为纯文本(用于存入资产/下载) */
export function serializeScriptContent(node: NodeRecord): string {
  const data = (node.data ?? {}) as Record<string, unknown>;
  const episodes = (data.episodes as Array<{ title?: string; content?: string }> | undefined) ?? [];
  if (episodes.length === 0) {
    // 兼容旧数据:直接使用 content 字段
    return (data.content as string) ?? '';
  }
  return episodes
    .map((ep, idx) => {
      const heading = ep.title?.trim() || `第${idx + 1}集`;
      const body = (ep.content ?? '').trim();
      return `${heading}\n\n${body}`;
    })
    .join('\n\n---\n\n');
}

export function assetInputFromNode(node: NodeRecord): CreateAssetInput | null {
  const data = (node.data ?? {}) as Record<string, unknown>;
  const content = (data.content as string) ?? '';
  const storageKey = data.storageKey as string | undefined;
  const prompt = (data.prompt as string) ?? '';
  const title = prompt.slice(0, 24) || '画布素材';
  const bytes = (data.bytes as number) ?? 0;
  const mimeType = data.mimeType as string | undefined;

  if (node.type === 'text') {
    if (!content.trim()) return null;
    return {
      title,
      kind: 'text',
      coverUrl: undefined,
      bytes: content.length,
      mimeType: 'text/plain',
      data: { kind: 'text', content },
    };
  }

  if (node.type === 'script') {
    const scriptText = serializeScriptContent(node);
    if (!scriptText.trim()) return null;
    const scriptTitle = (node.title ?? '剧本').slice(0, 24);
    return {
      title: scriptTitle,
      kind: 'text',
      coverUrl: undefined,
      bytes: scriptText.length,
      mimeType: 'text/plain',
      data: { kind: 'text', content: scriptText },
    };
  }

  if (node.type === 'image') {
    if (!content) return null;
    const width = (data.naturalWidth as number) ?? (node.size?.width ?? 0);
    const height = (data.naturalHeight as number) ?? (node.size?.height ?? 0);
    return {
      title,
      kind: 'image',
      coverUrl: storageKey || content,
      bytes,
      mimeType: mimeType ?? 'image/png',
      data: {
        kind: 'image',
        dataUrl: storageKey ? '' : content,
        storageKey,
        width,
        height,
      },
    };
  }

  if (node.type === 'video') {
    if (!content) return null;
    const width = (data.naturalWidth as number) ?? (node.size?.width ?? 0);
    const height = (data.naturalHeight as number) ?? (node.size?.height ?? 0);
    const durationMs = data.durationMs as number | undefined;
    return {
      title,
      kind: 'video',
      coverUrl: undefined,
      bytes,
      mimeType: mimeType ?? 'video/mp4',
      data: {
        kind: 'video',
        url: content,
        storageKey,
        width,
        height,
        durationMs,
      },
    };
  }

  if (node.type === 'audio') {
    if (!content) return null;
    const durationMs = data.durationMs as number | undefined;
    return {
      title,
      kind: 'audio',
      coverUrl: undefined,
      bytes,
      mimeType: mimeType ?? 'audio/mpeg',
      data: {
        kind: 'audio',
        url: content,
        storageKey,
        durationMs,
      },
    };
  }

  return null;
}

export function nodeDataPatchFromAssetInput(
  input: CreateAssetInput,
): Record<string, unknown> | null {
  if (input.data.kind === 'image') {
    return {
      content: input.data.dataUrl,
      storageKey: input.data.storageKey,
      naturalWidth: input.data.width,
      naturalHeight: input.data.height,
      mimeType: input.mimeType,
      bytes: input.bytes,
      status: 'success',
    };
  }
  if (input.data.kind === 'video') {
    return {
      content: input.data.url,
      storageKey: input.data.storageKey,
      naturalWidth: input.data.width,
      naturalHeight: input.data.height,
      durationMs: input.data.durationMs,
      mimeType: input.mimeType,
      bytes: input.bytes,
      status: 'success',
    };
  }
  if (input.data.kind === 'audio') {
    return {
      content: input.data.url,
      storageKey: input.data.storageKey,
      durationMs: input.data.durationMs,
      mimeType: input.mimeType,
      bytes: input.bytes,
      status: 'success',
    };
  }
  return null;
}
