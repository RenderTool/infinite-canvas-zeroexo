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
import type { InsertAssetPayload, Asset } from '../asset-picker/index.js';
import { uploadAsset, UnsupportedFileTypeError, FileTooLargeError } from '../asset-picker/services/upload-asset.js';
import type { CreateAssetInput } from '../asset-picker/asset-store.js';
import { PROMPT_DRAG_MIME, type InsertPromptPayload } from '../prompt-library/prompt-store.js';
import { toInsertPayload } from '../asset-picker/components/picker-card.js';
import { TEXT_MAX_LENGTH } from '@/shared/constants/text-limits.js';
import type { Episode } from '@/features/canvas-nodes/storyboard/script-types.js';

/** 拖拽 MIME 类型(与 picker-card.tsx 的 DRAG_MIME 保持一致) */
const ASSET_DRAG_MIME = 'application/x-canvas-asset';

/** 素材库卡片拖拽 MIME(与 asset-card/script-card/prompt-card 的 onDragStart 保持一致) */
const LIB_DRAG_MIME = 'application/x-testlib-item';

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

      // 0. 素材库卡片拖拽(x-testlib-item):资产/提示词/剧本三类型直接导入(与 handleAssetInsert 同逻辑,含超长拦截)
      const libData = e.dataTransfer.getData(LIB_DRAG_MIME);
      if (libData) {
        try {
          const item = JSON.parse(libData) as { type: 'asset' | 'prompt' | 'script'; id: string; name?: string; data: any };
          const node = await buildNodeFromLibraryItem(item, pos, (msg) => onError?.(msg));
          if (node) {
            insertNodeAt(node);
            refs.store?.setSelection({
              selectedNodeIds: new Set([node.id]),
              selectedEdgeIds: new Set(),
            });
          }
        } catch (err) {
          console.error('[drop-handler] failed to parse library item payload:', err);
          onError?.('素材拖入画布失败：数据解析异常');
        }
        return;
      }

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
 * 素材库卡片拖拽建节点（资产/提示词/剧本三类型，与 use-editor-dialogs handleAssetInsert 同逻辑）。
 *
 * 验收轮二十一：素材库卡片拖到画布直接导入；超长文本/空剧本经 onBlocked 回调拦截提示。
 */
export async function buildNodeFromLibraryItem(
  item: { type: 'asset' | 'prompt' | 'script'; id: string; name?: string; data: any },
  pos: { x: number; y: number },
  onBlocked?: (message: string) => void,
): Promise<NodeRecord | null> {
  // 提示词 → text 节点（内容即提示词正文）
  if (item.type === 'prompt') {
    const prompt = item.data as { title?: string; content?: string };
    const content = prompt?.content ?? '';
    if (content.length > TEXT_MAX_LENGTH) {
      onBlocked?.(`提示词内容过长（${content.length.toLocaleString()} 字，上限 ${TEXT_MAX_LENGTH.toLocaleString()} 字），无法直接放入画布。建议精简后重试。`);
      return null;
    }
    return createAssetNode({ kind: 'text', content, title: prompt?.title ?? '提示词' }, pos);
  }

  // 剧本 → script 节点（解析 episodes JSON 还原剧集，随画布 Yjs 同步）
  if (item.type === 'script') {
    const asset = item.data as { title?: string; data?: { content?: string } };
    const raw = asset?.data?.content ?? '';
    let episodes: Episode[] = [];
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : ((parsed?.episodes as unknown[]) ?? []);
      episodes = (list as Array<Partial<Episode>>).map((ep, idx) => ({
        id: ep.id ?? `ep-import-${Date.now()}-${idx}`,
        number: typeof ep.number === 'number' ? ep.number : idx + 1,
        title: ep.title ?? `第${idx + 1}集`,
        content: ep.content ?? '',
      }));
    } catch {
      episodes = [];
    }
    if (episodes.length === 0) {
      onBlocked?.('剧本内容为空或格式无法解析，无法拖入画布');
      return null;
    }
    return {
      id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'script',
      position: pos,
      title: asset?.title ?? '剧本',
      data: {
        title: asset?.title ?? '剧本',
        status: 'ready',
        episodes,
        activeEpisodeId: episodes[0]!.id,
      },
    };
  }

  // 常规资产（图片/视频/音频/文本）
  const asset = item.data as Asset;
  const payload = toInsertPayload(asset);
  // 超长拦截（防超大文本塞进节点拖垮协作同步）
  if (payload.kind === 'text' && payload.content.length > TEXT_MAX_LENGTH) {
    onBlocked?.(`文本内容过长（${payload.content.length.toLocaleString()} 字，上限 ${TEXT_MAX_LENGTH.toLocaleString()} 字），无法直接放入画布。建议通过 Agent 分段整理，或使用「小说导入」分集导入。`);
    return null;
  }
  return createAssetNode(payload, pos);
}

/**
 * 从 CreateAssetInput 构造 InsertAssetPayload(用于外部文件拖入后创建节点)
 * CreateAssetInput 的 data 结构与 InsertAssetPayload 几乎一致,只是字段名不同
 */
function createPayloadFromInput(input: CreateAssetInput): InsertAssetPayload {
  const d = input.data;
  if (d.kind === 'text' || d.kind === 'script') {
    // script 资产不走文件拖入链路,此分支仅为类型穷举兜底(文本化插入)
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
  // image（plan 等无媒体字段的类型不会走到此分支，dataUrl 恒有值）
  return {
    kind: 'image',
    dataUrl: d.dataUrl ?? '',
    storageKey: d.storageKey,
    title: input.title,
    width: d.width,
    height: d.height,
  };
}
