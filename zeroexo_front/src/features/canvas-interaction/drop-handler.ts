/**
 * drop-handler - 画布拖拽落点处理(Phase D2.4 + D3.3)
 *
 * 处理三种拖拽来源:
 * 1. AssetPicker 素材拖拽:读取 'application/x-canvas-asset' MIME 数据,
 *    解析 InsertAssetPayload,在落点位置创建对应节点。
 * 2. 提示词拖拽(D3.3):读取 'application/x-canvas-prompt' MIME 数据,
 *    解析 InsertPromptPayload,在落点位置创建文本节点。
 * 3. 外部文件拖拽(从文件系统拖入):上传文件到 persistence 存储,
 *    创建节点,可选加入素材库。
 *
 * 坐标转换:clientX/clientY → 画布世界坐标
 *   worldX = (clientX - rect.left - viewport.x) / viewport.k
 *   worldY = (clientY - rect.top - viewport.y) / viewport.k
 */

import { useCallback } from 'react';
import { AddNodeCommand } from '@zeroexo/core';
import type { NodeRecord } from '@zeroexo/core';
import type { EditorRefs } from '@/pages/editor/editor-canvas/use-editor-state.js';
import { createAssetNode } from '@zeroexo/plugin-nodes';
import type { InsertAssetPayload } from '../asset-picker/index.js';
import { uploadAsset, UnsupportedFileTypeError, FileTooLargeError } from '../asset-picker/services/upload-asset.js';
import type { CreateAssetInput } from '../asset-picker/asset-store.js';
import { PROMPT_DRAG_MIME, type InsertPromptPayload } from '../prompt-library/prompt-store.js';

/** 拖拽 MIME 类型(与 picker-card.tsx 的 DRAG_MIME 保持一致) */
const ASSET_DRAG_MIME = 'application/x-canvas-asset';

export interface UseDropHandlerOptions {
  refs: EditorRefs;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /**
   * 外部文件上传后回调(可选)。
   * 若提供,外部文件拖入画布时会先上传 → 加入素材库 → 创建节点。
   * 若不提供,外部文件仅上传 + 创建节点,不加入素材库。
   */
  onFileUploaded?: (input: CreateAssetInput) => Promise<void>;

  /**
   * 批量文件处理函数(由 useUploadQueue 提供)。
   * 若提供,拖入多个文件时通过上传队列处理(显示进度覆盖层 + 自动网格排布)。
   * 单个文件仍直接处理以保持即时响应。
   */
  processFiles?: (files: File[]) => void;

  /** 处理错误时的回调(用于显示用户可见的错误提示,如 message.error) */
  onError?: (message: string) => void;
}

export interface DropHandlers {
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
}

/**
 * 画布拖拽落点 hook
 *
 * 用法:
 * ```tsx
 * const { onDrop, onDragOver } = useDropHandler({ refs, containerRef });
 * <CanvasView onCanvasDrop={onDrop} onCanvasDragOver={onDragOver} ... />
 * ```
 */
export function useDropHandler({
  refs,
  containerRef,
  onFileUploaded,
  processFiles,
  onError,
}: UseDropHandlerOptions): DropHandlers {
  /** 屏幕坐标 → 画布世界坐标 */
  const screenToWorld = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const vp = refs.store?.getViewport();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!vp || !rect) return null;
      return {
        x: (clientX - rect.left - vp.x) / vp.k,
        y: (clientY - rect.top - vp.y) / vp.k,
      };
    },
    [refs, containerRef],
  );

  /** 在指定位置创建节点 */
  const insertNodeAt = useCallback(
    (node: NodeRecord): void => {
      refs.commandQueue?.execute(new AddNodeCommand(node));
    },
    [refs],
  );

  // ===== onDragOver:阻止默认行为(允许 drop) =====
  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // ===== onDrop:核心落点处理 =====
  const onDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
      e.preventDefault();
      e.stopPropagation();

      const pos = screenToWorld(e.clientX, e.clientY);
      if (!pos) return;

      // 1. 优先读取 AssetPicker 拖拽的素材数据
      const assetData = e.dataTransfer.getData(ASSET_DRAG_MIME);
      if (assetData) {
        try {
          const payload = JSON.parse(assetData) as InsertAssetPayload;
          const node = await createAssetNode(payload, pos);
          if (node) {
            insertNodeAt(node);
          }
          return;
        } catch (err) {
          console.error('[drop-handler] failed to parse asset payload:', err);
          // 解析失败,继续尝试其他来源
        }
      }

      // 2. 提示词拖拽(D3.3):读取 'application/x-canvas-prompt' MIME,创建文本节点
      const promptData = e.dataTransfer.getData(PROMPT_DRAG_MIME);
      if (promptData) {
        try {
          const payload = JSON.parse(promptData) as InsertPromptPayload;
          // 复用 createAssetNode 的 text 分支(结构一致:kind='text' + content + title)
          const node = await createAssetNode(
            { kind: 'text', content: payload.content, title: payload.title },
            pos,
          );
          if (node) {
            insertNodeAt(node);
          }
          return;
        } catch (err) {
          console.error('[drop-handler] failed to parse prompt payload:', err);
        }
      }

      // 3. 兜底:处理外部文件拖入(从文件系统拖入)
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const fileArr = Array.from(files);

        // 多个文件时使用上传队列(显示进度 + 自动网格排布)
        if (fileArr.length > 1 && processFiles) {
          processFiles(fileArr);
          return;
        }

        // 单个文件:直接处理(保持即时响应)
        for (const file of fileArr) {
          try {
            const input = await uploadAsset(file);
            // 从 CreateAssetInput 构造 InsertAssetPayload
            const payload = createPayloadFromInput(input);
            const node = await createAssetNode(payload, pos);
            if (node) {
              insertNodeAt(node);
            }
            // 可选:加入素材库
            if (onFileUploaded) {
              await onFileUploaded(input);
            }
          } catch (err) {
            const msg = err instanceof UnsupportedFileTypeError
              ? err.message
              : err instanceof FileTooLargeError
                ? err.message
                : `文件 "${file.name}" 处理失败: ${(err as Error)?.message ?? '未知错误'}`;
            console.error(`[drop-handler] failed to upload file ${file.name}:`, err);
            onError?.(msg);
          }
        }
      }
    },
    [screenToWorld, insertNodeAt, onFileUploaded, processFiles, onError],
  );

  return { onDrop, onDragOver };
}

/**
 * 从 CreateAssetInput 构造 InsertAssetPayload(用于外部文件拖入后创建节点)
 * CreateAssetInput 的 data 结构与 InsertAssetPayload 几乎一致,只是字段名不同
 */
function createPayloadFromInput(input: CreateAssetInput): InsertAssetPayload {
  const d = input.data;
  if (d.kind === 'text') {
    return { kind: 'text', content: d.content, title: input.title };
  }
  if (d.kind === 'video') {
    return {
      kind: 'video',
      url: d.url,
      storageKey: d.storageKey,
      title: input.title,
      width: d.width,
      height: d.height,
      durationMs: d.durationMs,
    };
  }
  if (d.kind === 'audio') {
    return {
      kind: 'audio',
      url: d.url,
      storageKey: d.storageKey,
      title: input.title,
      durationMs: d.durationMs,
    };
  }
  // image
  return {
    kind: 'image',
    dataUrl: d.dataUrl,
    storageKey: d.storageKey,
    title: input.title,
    width: d.width,
    height: d.height,
  };
}
