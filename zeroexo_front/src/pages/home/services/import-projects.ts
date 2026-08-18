/**
 * ZIP 导入
 *
 * 流程:
 * 1. 读取 ZIP → 解析 projects.json
 * 2. 为每个项目生成新 ID,为每个素材生成新 storageKey
 * 3. 写入素材到 image_files / media_files 桶
 * 4. 重映射 graph 中的 storageKey
 * 5. 写入 graph 到 canvas 桶
 * 6. 写入项目元数据到 app_state 桶
 */

import { nanoid } from 'nanoid';
import type { GraphModel } from '@zeroexo/core';
import {
  setImageBlob,
  setMediaBlob,
  importProjects,
  saveProjectGraph,
  resolveImageUrl,
  resolveMediaUrl,
} from '@zeroexo/plugin-persistence';
import type { CanvasProjectMeta } from '@zeroexo/plugin-persistence';
import { readZip } from './zip.js';
import type { CanvasExportFile } from './export-types.js';
import { CURRENT_ZIP_VERSION, migrateExportFile } from './version-migration.js';

/**
 * 从 ZIP 文件导入项目
 * @param file 用户选择的 ZIP 文件
 * @returns 导入后的新项目数组(含新 ID)
 * @throws Error ZIP 格式版本不兼容时抛错
 */
export async function importProjectsFromZip(file: Blob): Promise<CanvasProjectMeta[]> {
  // 1. 解压 ZIP
  const zip = await readZip(file);
  const projectFile = zip.get('projects.json');
  if (!projectFile) throw new Error('ZIP 文件中缺少 projects.json');
  const raw = JSON.parse(await projectFile.text()) as CanvasExportFile;

  // 2. 版本校验与自动迁移
  if (raw.version > CURRENT_ZIP_VERSION) {
    throw new Error(
      `ZIP 文件版本(v${raw.version})高于当前支持的最高版本(v${CURRENT_ZIP_VERSION})。` +
      `请更新应用程序后再导入此文件。`,
    );
  }
  const data = migrateExportFile(raw);
  if (data.version !== CURRENT_ZIP_VERSION) {
    throw new Error(
      `ZIP 文件版本迁移失败: 期望 v${CURRENT_ZIP_VERSION}，得到 v${data.version}`,
    );
  }

  if (!data.projects || data.projects.length === 0) return [];

  // 3. 逐项目处理:重写素材 + 重映射 storageKey + 写 graph
  const metasToImport: CanvasProjectMeta[] = [];
  const graphDataToSave: { projectId: string; graph: GraphModel }[] = [];

  for (const item of data.projects) {
    // 构建旧 storageKey → 新 storageKey 映射
    const keyMap = new Map<string, string>();
    for (const asset of item.files) {
      const newKey = remapStorageKey(asset.storageKey);
      keyMap.set(asset.storageKey, newKey);

      // 从 ZIP 读取 blob,用新 storageKey 写入对应桶
      const blob = zip.get(asset.path);
      if (!blob) continue;
      const typedBlob = blob.type ? blob : blob.slice(0, blob.size, asset.mimeType);
      if (newKey.startsWith('image:')) {
        await setImageBlob(newKey, typedBlob);
      } else {
        await setMediaBlob(newKey, typedBlob);
      }
    }

    // 重映射 graph 中的 storageKey 并刷新 content 字段
    const remappedGraph = item.graph
      ? await remapGraphStorageKeys(item.graph, keyMap)
      : null;

    // 暂存元数据和 graph(等会统一写入)
    // 清除 cloudId 和 version,确保导入后作为新项目处理,能正常云同步
    const cleanMeta: CanvasProjectMeta = {
      ...item.meta,
      cloudId: null,
      version: 0,
      lastSyncedAt: null,
    };
    metasToImport.push(cleanMeta);
    if (remappedGraph) {
      // 用临时 ID 占位,后面 importProjects 返回新 ID 后再写入 graph
      graphDataToSave.push({ projectId: cleanMeta.id, graph: remappedGraph });
    }
  }

  // 4. 写入项目元数据(importProjects 会重新生成 ID + 加后缀)
  const importedProjects = await importProjects(metasToImport);

  // 5. 按 旧ID → 新ID 映射,写入 graph 数据
  const idMap = new Map(
    metasToImport.map((old, i) => [old.id, importedProjects[i]?.id]),
  );
  for (const { projectId: oldId, graph } of graphDataToSave) {
    const newId = idMap.get(oldId);
    if (!newId) continue;
    await saveProjectGraph(newId, graph);
  }

  return importedProjects;
}

/**
 * 重映射 storageKey(保留前缀,生成新 ID 部分)
 * image:abc123 → image:<newNanoid>
 * video:xyz789 → video:<newNanoid>
 */
function remapStorageKey(oldKey: string): string {
  const prefix = oldKey.split(':')[0];
  return `${prefix}:${nanoid()}`;
}

/**
 * 递归替换 graph 中所有 storageKey 值并刷新 content 字段
 * 遍历 nodes/edges/metadata 及其嵌套对象
 */
async function remapGraphStorageKeys(graph: GraphModel, keyMap: Map<string, string>): Promise<GraphModel> {
  const remappedNodes = await Promise.all(
    graph.nodes.map(async (node) => remapNode(node, keyMap)),
  );
  return {
    nodes: remappedNodes,
    edges: graph.edges.map((edge) => remapObject(edge, keyMap) as typeof edge),
    viewport: graph.viewport,
    metadata: remapObject(graph.metadata, keyMap) as typeof graph.metadata,
  };
}

/**
 * 重映射单个节点的 storageKey 并刷新 content 字段
 */
async function remapNode(node: GraphModel['nodes'][number], keyMap: Map<string, string>): Promise<GraphModel['nodes'][number]> {
  const remapped = remapObject(node, keyMap) as GraphModel['nodes'][number];
  const data = remapped.data as Record<string, unknown> | undefined;
  if (data?.storageKey && typeof data.storageKey === 'string') {
    const newStorageKey = data.storageKey;
    let content: string | undefined;
    if (newStorageKey.startsWith('image:')) {
      content = await resolveImageUrl(newStorageKey);
    } else if (newStorageKey.startsWith('video:') || newStorageKey.startsWith('audio:')) {
      content = await resolveMediaUrl(newStorageKey);
    }
    if (content) {
      data.content = content;
    }
  }
  return remapped;
}

/**
 * 深度遍历对象,替换所有 storageKey 字段值
 * 仅替换字符串类型且在 keyMap 中的 storageKey
 */
function remapObject<T>(obj: T, keyMap: Map<string, string>): T {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => remapObject(item, keyMap)) as T;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (
      key === 'storageKey' &&
      typeof value === 'string' &&
      keyMap.has(value)
    ) {
      result[key] = keyMap.get(value);
    } else if (value && typeof value === 'object') {
      result[key] = remapObject(value, keyMap);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}
