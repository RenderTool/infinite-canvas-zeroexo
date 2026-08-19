/**
 * 媒体替换模型(Plan#11 C1/C2,原 Plan#7 T1-T3)
 *
 * video/audio 替换的统一命令化入口:
 * - 纯函数: stripFileExtension / computeVideoReplaceSize / buildReplacePatches
 * - 命令入口: replaceNodeVideo / replaceNodeAudio —— 上传 + 尺寸 + data patch 全部走命令队列,
 *   视图只消费命令(支持撤销/重做),与 replaceNodeImage 同一套契约语义。
 *
 * 设计原则(用户拍板): 节点尺寸契约自维护 —— video 保宽调高基准读扩展契约
 * (defaultSize.width / minSize),禁止视图/入口散落 420/620/348 等硬编码。
 */

import type { CommandQueue, NodeRecord, NodeTypeExtension } from '@zeroexo/core';
import { UpdateNodeDataCommand, ResizeNodeCommand, FALLBACK_NODE_SIZE } from '@zeroexo/core';
import { uploadMediaFile } from '@zeroexo/plugin-persistence';
import { VIDEO_DEFAULT_SIZE, MEDIA_MIN_SIZE } from './node-contracts.js';

/** 去文件扩展名(标题展示用) */
export function stripFileExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

/**
 * video 替换后的节点尺寸: 保宽调高。
 * 基准宽度读扩展契约(defaultSize.width);节点接近 minSize 或未设置尺寸时回基准宽,
 * 避免小节点替换后仍保持小尺寸(与 replaceNodeImage 语义一致)。
 */
export function computeVideoReplaceSize(
  node: NodeRecord,
  media: { width?: number; height?: number },
  ext?: NodeTypeExtension,
): { width: number; height: number } {
  // 基准宽: 扩展契约 defaultSize.width,无 ext 时用 video 契约常量(与 replaceNodeImage 兜底语义一致)
  const baseWidth = ext?.defaultSize?.width ?? VIDEO_DEFAULT_SIZE.width;
  const minW = ext?.minSize?.width ?? MEDIA_MIN_SIZE.width;
  const currentWidth = node.size?.width ?? baseWidth;
  const useBaseWidth = !node.size || currentWidth <= minW + 5 || currentWidth < FALLBACK_NODE_SIZE.width;
  const refWidth = useBaseWidth ? baseWidth : currentWidth;
  // 素材宽高无效时兜底 16:9,避免 NaN 导致节点渲染异常
  const ratio = (media.width && media.height && media.width > 0 && media.height > 0)
    ? media.height / media.width
    : 9 / 16;
  return { width: refWidth, height: Math.round(refWidth * ratio) };
}

/** 媒体替换的 data patch(成功后清 error/缩略图状态) */
export function buildReplacePatches(
  kind: 'video' | 'audio',
  media: {
    url: string;
    storageKey: string;
    width?: number;
    height?: number;
    durationMs?: number;
    mimeType?: string;
    bytes?: number;
  },
): Record<string, unknown> {
  if (kind === 'video') {
    return {
      content: media.url,
      storageKey: media.storageKey,
      naturalWidth: media.width,
      naturalHeight: media.height,
      durationMs: media.durationMs,
      mimeType: media.mimeType,
      bytes: media.bytes,
      status: 'success',
      errorDetails: undefined,
      errorType: undefined,
      thumbnailUrl: undefined,
    };
  }
  return {
    content: media.url,
    storageKey: media.storageKey,
    durationMs: media.durationMs,
    mimeType: media.mimeType,
    bytes: media.bytes,
    status: 'success',
    errorDetails: undefined,
    errorType: undefined,
  };
}

/** 替换失败的统一错误落盘 */
function executeReplaceError(commandQueue: CommandQueue, nodeId: string, err: unknown): void {
  commandQueue.execute(
    new UpdateNodeDataCommand(nodeId, {
      status: 'error',
      errorDetails: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>),
  );
}

/**
 * 替换节点视频 - 统一命令化 API(撤销/重做)。
 * 尺寸走 computeVideoReplaceSize(保宽调高读扩展契约)。
 */
export async function replaceNodeVideo(
  commandQueue: CommandQueue | undefined,
  node: NodeRecord,
  file: File,
  options?: {
    /** 节点类型扩展(读尺寸契约;不传时用 video 扩展契约常量兜底) */
    ext?: NodeTypeExtension;
    onStatusChange?: (status: string) => void;
  },
): Promise<void> {
  if (!file.type.startsWith('video/')) return;
  if (!commandQueue) {
    console.warn('replaceNodeVideo: commandQueue is undefined, cannot execute commands');
    return;
  }
  options?.onStatusChange?.('loading');
  try {
    const media = await uploadMediaFile(file, 'video');
    commandQueue.execute(new UpdateNodeDataCommand(node.id, buildReplacePatches('video', media)));

    const size = computeVideoReplaceSize(node, media, options?.ext);
    const oldRect = {
      x: node.position.x,
      y: node.position.y,
      width: node.size?.width ?? options?.ext?.defaultSize?.width ?? VIDEO_DEFAULT_SIZE.width,
      height: node.size?.height ?? options?.ext?.defaultSize?.height ?? VIDEO_DEFAULT_SIZE.height,
    };
    commandQueue.execute(
      new ResizeNodeCommand(node.id, oldRect, {
        ...oldRect,
        width: size.width,
        height: size.height,
      }),
    );
    options?.onStatusChange?.('success');
  } catch (err) {
    executeReplaceError(commandQueue, node.id, err);
    options?.onStatusChange?.('error');
  }
}

/**
 * 替换节点音频 - 统一命令化 API(撤销/重做)。
 * 音频气泡尺寸固定(扩展契约 360×96,resizable:false),只更新 data 不调尺寸。
 */
export async function replaceNodeAudio(
  commandQueue: CommandQueue | undefined,
  node: NodeRecord,
  file: File,
  options?: { onStatusChange?: (status: string) => void },
): Promise<void> {
  if (!file.type.startsWith('audio/')) return;
  if (!commandQueue) {
    console.warn('replaceNodeAudio: commandQueue is undefined, cannot execute commands');
    return;
  }
  options?.onStatusChange?.('loading');
  try {
    const media = await uploadMediaFile(file, 'audio');
    commandQueue.execute(new UpdateNodeDataCommand(node.id, buildReplacePatches('audio', media)));
    options?.onStatusChange?.('success');
  } catch (err) {
    executeReplaceError(commandQueue, node.id, err);
    options?.onStatusChange?.('error');
  }
}
