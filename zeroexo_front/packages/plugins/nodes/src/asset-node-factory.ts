/**
 * asset-node-factory - 素材 → 节点工厂(Phase D2.5)
 *
 * 将素材 payload 映射为画布节点(NodeRecord),供 drop-handler 和
 * AssetPicker 点击插入使用。
 *
 * 映射规则:
 * | payload.kind | 节点类型 | data 内容 |
 * |--------------|----------|-----------|
 * | image        | image    | { content: blobUrl, storageKey, status: 'success' } |
 * | video        | video    | { content: blobUrl, storageKey, status: 'success' } |
 * | audio        | audio    | { content: blobUrl, storageKey, status: 'success' } |
 * | text         | text     | { content, status: 'idle' } |
 *
 * 关键: 所有媒体节点必须有 storageKey,确保:
 * 1. 刷新后 blob URL 可通过 storageKey 重建
 * 2. useProgressiveImage/useProgressiveVideo 能加载缩略图
 * 3. 云同步能正确上传资源
 *
 * 若资产已有 storageKey(后端 resources/ 或本地 image:/video:),直接使用;
 * 若无(如 data URL 或裸 blob URL),先存入 localforage 生成 storageKey + 缩略图。
 */

import type { NodeRecord } from '@zeroexo/core';
import { uploadImage, uploadMediaFile } from '@zeroexo/plugin-persistence';
import {
  TEXT_DEFAULT_SIZE,
  IMAGE_DEFAULT_SIZE,
  VIDEO_DEFAULT_SIZE,
  AUDIO_DEFAULT_SIZE,
  MEDIA_MIN_SIZE,
} from './utils/node-contracts.js';

// ===== 类型定义 =====

/**
 * 素材节点 payload(与 canvas 的 InsertAssetPayload 结构兼容)
 *
 * 注意: 本类型定义在 nodes 包内,不依赖 app 层的 asset-picker,
 * 通过 TypeScript 结构类型保证兼容性(app 传入 InsertAssetPayload 时自动匹配)。
 */
export type AssetNodePayload =
  | { kind: 'text'; content: string; title: string }
  | { kind: 'image'; dataUrl: string; title: string; storageKey?: string; width?: number; height?: number }
  | { kind: 'video'; url: string; title: string; storageKey?: string; width?: number; height?: number; durationMs?: number }
  | { kind: 'audio'; url: string; title: string; storageKey?: string; durationMs?: number };

// ===== 节点默认尺寸(与 createXxxExtension 的 defaultSize 同源: node-contracts.ts 单一事实源) =====
// 禁止在此处自行声明尺寸 —— 改契约只改 node-contracts.ts,所有入口自动跟随

// ===== 主入口 =====

/**
 * 根据素材 payload 创建画布节点
 *
 * 异步: 若资产无 storageKey,需先将内容存入 localforage(生成缩略图)。
 *
 * @param payload 素材数据(kind/title/url 或 content/storageKey 等)
 * @param position 节点在世界坐标的位置(drop 落点或点击插入位置)
 * @returns NodeRecord(可直接传给 AddNodeCommand),若 kind 未知返回 null
 */
export async function createAssetNode(
  payload: AssetNodePayload,
  position: { x: number; y: number },
): Promise<NodeRecord | null> {
  const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  switch (payload.kind) {
    case 'image': {
      let storageKey = payload.storageKey;
      let contentUrl = payload.dataUrl;
      let naturalWidth = payload.width;
      let naturalHeight = payload.height;

      // 无 storageKey(data URL 或裸 blob URL)→ 存入 localforage,生成 storageKey + 缩略图
      if (!storageKey && payload.dataUrl) {
        try {
          const stored = await uploadImage(payload.dataUrl);
          storageKey = stored.storageKey;
          contentUrl = stored.url;
          if (!naturalWidth) naturalWidth = stored.width;
          if (!naturalHeight) naturalHeight = stored.height;
        } catch (err) {
          console.warn('[createAssetNode] image uploadImage failed, using raw dataUrl:', err);
        }
      }

      const size = computeNodeSize(naturalWidth, naturalHeight, IMAGE_DEFAULT_SIZE);
      return {
        id,
        type: 'image',
        position: centerPosition(position, size),
        size,
        title: payload.title,
        data: {
          prompt: payload.title,
          content: contentUrl,
          storageKey,
          status: 'success',
          naturalWidth,
          naturalHeight,
          title: payload.title,
        },
      };
    }

    case 'video': {
      let storageKey = payload.storageKey;
      let contentUrl = payload.url;
      let naturalWidth = payload.width;
      let naturalHeight = payload.height;

      // 无 storageKey(裸 blob URL)→ 存入 localforage,生成 storageKey
      if (!storageKey && payload.url) {
        try {
          const stored = await uploadMediaFile(await (await fetch(payload.url)).blob(), 'video');
          storageKey = stored.storageKey;
          contentUrl = stored.url;
          if (!naturalWidth) naturalWidth = stored.width;
          if (!naturalHeight) naturalHeight = stored.height;
        } catch (err) {
          console.warn('[createAssetNode] video uploadMediaFile failed, using raw url:', err);
        }
      }

      const size = computeNodeSize(naturalWidth, naturalHeight, VIDEO_DEFAULT_SIZE);
      return {
        id,
        type: 'video',
        position: centerPosition(position, size),
        size,
        title: payload.title,
        data: {
          prompt: payload.title,
          content: contentUrl,
          storageKey,
          status: 'success',
          naturalWidth,
          naturalHeight,
          durationMs: payload.durationMs,
          title: payload.title,
        },
      };
    }

    case 'audio': {
      let storageKey = payload.storageKey;
      let contentUrl = payload.url;

      // 无 storageKey(裸 blob URL)→ 存入 localforage
      if (!storageKey && payload.url) {
        try {
          const stored = await uploadMediaFile(await (await fetch(payload.url)).blob(), 'audio');
          storageKey = stored.storageKey;
          contentUrl = stored.url;
        } catch (err) {
          console.warn('[createAssetNode] audio uploadMediaFile failed, using raw url:', err);
        }
      }

      // 音频气泡固定尺寸(读 audio 扩展契约 360×96,非 16:9)
      const size = AUDIO_DEFAULT_SIZE;
      return {
        id,
        type: 'audio',
        position: centerPosition(position, size),
        size,
        title: payload.title,
        data: {
          prompt: payload.title,
          content: contentUrl,
          storageKey,
          status: 'success',
          durationMs: payload.durationMs,
          title: payload.title,
        },
      };
    }

    case 'text': {
      const size = TEXT_DEFAULT_SIZE;
      return {
        id,
        type: 'text',
        position: centerPosition(position, size),
        size,
        title: payload.title,
        data: {
          content: payload.content,
          prompt: '',
          status: 'idle',
          title: payload.title,
        },
      };
    }

    default:
      return null;
  }
}

// ===== 内部辅助 =====

/**
 * 根据素材原始尺寸计算节点尺寸。
 * 规则: 以 fallback(defaultSize) 的宽度为基准,图片/视频保持原始宽高比按宽度缩放。
 * 宽度固定为基准宽度,高度按比例计算。
 * 若素材为 1:1 → 620 × 620(宽度 620,高度按比例)
 * 若素材为 16:9 → 620 × 349(宽度 620,高度按比例)
 * 若素材为 4:3 → 620 × 465(宽度 620,高度按比例)
 * 无原始尺寸时回退到 fallback(类型契约 defaultSize)。
 */
function computeNodeSize(
  naturalWidth?: number,
  naturalHeight?: number,
  fallback: { width: number; height: number } = IMAGE_DEFAULT_SIZE,
): { width: number; height: number } {
  if (!naturalWidth || !naturalHeight || naturalWidth <= 0 || naturalHeight <= 0) {
    return fallback;
  }

  // 以 fallback 宽度为基准,保持宽高比按宽度缩放
  const baseW = fallback.width;
  const ratio = naturalWidth / naturalHeight;

  return {
    width: baseW,
    height: Math.max(MEDIA_MIN_SIZE.height, Math.round(baseW / ratio)),
  };
}

/** 节点位置直接使用拖拽点作为左上角(用户直观期望) */
function centerPosition(
  pos: { x: number; y: number },
  _size: { width: number; height: number },
): { x: number; y: number } {
  return { x: pos.x, y: pos.y };
}
