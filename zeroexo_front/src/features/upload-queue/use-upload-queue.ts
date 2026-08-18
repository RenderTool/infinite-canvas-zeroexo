/**
 * useUploadQueue - 批量上传队列处理 hook（统一使用插件版）
 *
 * 职责:
 * - 接收文件列表，通过 upload-queue-store 显示覆盖层
 * - 将文件提交到 @zeroexo/plugin-upload-queue 的 UploadQueue 处理
 * - 监听插件队列事件更新 store（进度追踪）
 * - 完成后使用 arrangeNodes 排布并插入画布
 *
 * 由 drop-handler.ts 和 editor-page.tsx 调用。
 */
import { useCallback } from 'react';
import { AddNodeCommand } from '@zeroexo/core';
import type { NodeRecord, CommandQueue } from '@zeroexo/core';
import { createAssetNode } from '@zeroexo/plugin-nodes';
import { arrangeNodes } from '@zeroexo/plugin-layout';
import type { LayoutNode } from '@zeroexo/plugin-layout';
import { UploadQueue } from '@zeroexo/plugin-upload-queue';
import { uploadAsset } from '../asset-picker/services/upload-asset.js';
import type { CreateAssetInput } from '../asset-picker/asset-store.js';
import { useUploadQueueStore } from './upload-queue-store.js';

/** 网格起始偏移(px) */
const GRID_OFFSET_X = 100;
const GRID_OFFSET_Y = 100;

/**
 * 批量上传文件处理 hook
 * @param commandQueue 编辑器命令队列
 * @param uploadQueue  上传队列实例（必传）
 */
export function useUploadQueue(
  commandQueue: CommandQueue | null,
  uploadQueue: UploadQueue,
) {
  const store = useUploadQueueStore;

  const processFiles = useCallback(
    async (files: File[], onNodeCreated?: (node: NodeRecord) => void): Promise<void> => {
      if (!commandQueue || files.length === 0) return;

      // 1. 显示覆盖层 + 构建 file → storeId 映射
      store.getState().addFiles(files);
      store.getState().startProcessing();

      const storeItems = store.getState().items;
      const fileToStoreId = new Map<File, string>();
      for (const item of storeItems) {
        fileToStoreId.set(item.file, item.id);
      }

      const uploadedNodes: NodeRecord[] = [];

      // 2. 使用 UploadQueue 处理并发上传和重试
      // 通过 File 对象引用匹配插件 task → store item（插件 taskId 与 store itemId 不同）
      const unsub = uploadQueue.on((event) => {
        const task = uploadQueue.getTask(event.taskId);
        if (!task) return;
        // 用 File 对象的引用来查 storeId
        const storeId = fileToStoreId.get(task.input as File);
        if (!storeId) return;

        const s = store.getState();
        if (event.type === 'task-completed') {
          s.completeOne(storeId);
        } else if (event.type === 'task-failed') {
          s.failOne(storeId, event.error);
        } else if (event.type === 'task-retrying') {
          s.updateItem(storeId, { status: 'uploading' });
        }
      });

      try {
        uploadQueue.addTasks(files, async (file: File) => {
          const storeId = fileToStoreId.get(file);
          if (storeId) store.getState().updateItem(storeId, { status: 'uploading' });

          const input = await uploadAsset(file);
          const payload = createPayloadFromInput(input);
          const node = await createAssetNode(payload, { x: 0, y: 0 });
          return { input, node };
        });

        await uploadQueue.waitForCompletion();

        // 收集结果
        const allTasks = uploadQueue.getTasks();
        for (const task of allTasks) {
          if (task.status === 'done' && task.result) {
            const result = task.result as { node?: NodeRecord };
            if (result.node) {
              uploadedNodes.push(result.node);
              onNodeCreated?.(result.node);
            }
          }
        }
      } finally {
        unsub();
      }

      // 3. 使用 arrangeNodes 计算网格位置
      if (uploadedNodes.length > 0) {
        const layoutNodes: LayoutNode[] = uploadedNodes.map((n) => ({
          id: n.id,
          x: n.position?.x ?? 0,
          y: n.position?.y ?? 0,
          width: n.size?.width ?? 200,
          height: n.size?.height ?? 100,
        }));

        const positionMap = arrangeNodes(layoutNodes, 'grid');

        for (const node of uploadedNodes) {
          const pos = positionMap.get(node.id);
          if (pos) {
            node.position.x = pos.x + GRID_OFFSET_X;
            node.position.y = pos.y + GRID_OFFSET_Y;
          }
        }
      }

      // 4. 分批插入画布（避免卡主线程）
      const BATCH_SIZE = 30;
      for (let i = 0; i < uploadedNodes.length; i += BATCH_SIZE) {
        const batchNodes = uploadedNodes.slice(i, i + BATCH_SIZE);
        for (const node of batchNodes) {
          commandQueue.execute(new AddNodeCommand(node));
        }
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    },
    [commandQueue, uploadQueue, store],
  );

  return { processFiles };
}

/**
 * useAssetUploadQueue - 素材库上传队列处理 hook
 *
 * 与 useUploadQueue 的区别:不创建画布节点，仅上传并返回 CreateAssetInput[]。
 * 用于 AssetPicker 的批量上传，显示 upload-queue 覆盖层。
 *
 * @param uploadQueue  上传队列实例（必传）
 */
export function useAssetUploadQueue(
  uploadQueue: UploadQueue,
) {
  const store = useUploadQueueStore;

  const uploadFiles = useCallback(
    async (files: File[]): Promise<CreateAssetInput[]> => {
      if (files.length === 0) return [];

      // 1. 显示覆盖层 + 构建 file → storeId 映射
      store.getState().addFiles(files);
      store.getState().startProcessing();

      const storeItems = store.getState().items;
      const fileToStoreId = new Map<File, string>();
      for (const item of storeItems) {
        fileToStoreId.set(item.file, item.id);
      }

      const results: CreateAssetInput[] = [];

      // 2. 使用 UploadQueue 处理并发上传和重试
      const unsub = uploadQueue.on((event) => {
        const task = uploadQueue.getTask(event.taskId);
        if (!task) return;
        const storeId = fileToStoreId.get(task.input as File);
        if (!storeId) return;

        const s = store.getState();
        if (event.type === 'task-completed') {
          s.completeOne(storeId);
        } else if (event.type === 'task-failed') {
          s.failOne(storeId, event.error);
        } else if (event.type === 'task-retrying') {
          s.updateItem(storeId, { status: 'uploading' });
        }
      });

      try {
        uploadQueue.addTasks(files, async (file: File) => {
          const storeId = fileToStoreId.get(file);
          if (storeId) store.getState().updateItem(storeId, { status: 'uploading' });

          const input = await uploadAsset(file);
          return input;
        });

        await uploadQueue.waitForCompletion();

        // 收集结果
        const allTasks = uploadQueue.getTasks();
        for (const task of allTasks) {
          if (task.status === 'done' && task.result) {
            results.push(task.result as CreateAssetInput);
          }
        }
      } finally {
        unsub();
      }

      return results;
    },
    [uploadQueue, store],
  );

  return { uploadFiles };
}

/**
 * 从 CreateAssetInput 构造 InsertAssetPayload
 */
function createPayloadFromInput(input: CreateAssetInput) {
  const d = input.data;
  if (d.kind === 'text') {
    return { kind: 'text' as const, content: d.content as string, title: input.title };
  }
  if (d.kind === 'video') {
    return {
      kind: 'video' as const,
      url: d.url as string,
      storageKey: d.storageKey as string | undefined,
      title: input.title,
      width: d.width as number | undefined,
      height: d.height as number | undefined,
      durationMs: d.durationMs as number | undefined,
    };
  }
  if (d.kind === 'audio') {
    return {
      kind: 'audio' as const,
      url: d.url as string,
      storageKey: d.storageKey as string | undefined,
      title: input.title,
      durationMs: d.durationMs as number | undefined,
    };
  }
  return {
    kind: 'image' as const,
    dataUrl: d.dataUrl as string,
    storageKey: d.storageKey as string | undefined,
    title: input.title,
    width: d.width as number | undefined,
    height: d.height as number | undefined,
  };
}
