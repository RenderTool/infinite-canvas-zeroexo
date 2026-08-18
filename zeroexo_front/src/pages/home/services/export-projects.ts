/**
 * ZIP 导出
 *
 * 流程:
 * 1. 遍历选中项目,加载 graph + 收集 storageKey
 * 2. 从 image_files / media_files 桶获取 blob
 * 3. 构造 projects.json + files/ 目录
 * 4. fflate.zipSync 打包 → 浏览器下载
 */

import type { GraphModel } from '@zeroexo/core';
import {
  getImageBlob,
  getMediaBlob,
  listProjects,
  collectImageStorageKeys,
  collectMediaStorageKeys,
  loadProjectGraph,
} from '@zeroexo/plugin-persistence';
import type { CanvasProjectMeta } from '@zeroexo/plugin-persistence';
import { createZip } from './zip.js';
import type { CanvasExportAsset, CanvasExportFile, CanvasProjectExportItem } from './export-types.js';

/**
 * 导出选中项目为 ZIP 并触发下载
 * @param projectIds 要导出的项目 id 数组
 * @param fileName 下载文件名(不含扩展名)
 */
export async function exportProjects(
  projectIds: string[],
  fileName = 'zeroexo-canvas',
): Promise<void> {
  if (projectIds.length === 0) return;

  // 获取项目元数据(按传入顺序)
  const allProjects = await listProjects();
  const projectMap = new Map(allProjects.map((p) => [p.id, p]));
  const projects = projectIds
    .map((id) => projectMap.get(id))
    .filter((p): p is CanvasProjectMeta => p !== undefined);

  if (projects.length === 0) return;

  const zipFiles: { name: string; data: BlobPart }[] = [];
  const exportItems = await Promise.all(
    projects.map(async (project) => {
      const graph = await loadProjectGraph(project.id);
      const files = await collectProjectFiles(project.id, graph, zipFiles);
      const item: CanvasProjectExportItem = { meta: project, graph, files };
      return item;
    }),
  );

  const data: CanvasExportFile = {
    app: 'zeroexo-canvas',
    version: 1,
    exportedAt: new Date().toISOString(),
    projects: exportItems,
  };

  zipFiles.unshift({
    name: 'projects.json',
    data: JSON.stringify(data, null, 2),
  });

  const zip = await createZip(zipFiles);
  triggerDownload(zip, `${safeFileName(fileName)}.zip`);
}

/**
 * 收集单个项目的所有素材文件
 * @param projectId 项目 id(用于 ZIP 内路径隔离)
 * @param graph 图数据(从中提取 storageKey)
 * @param zipFiles 累积写入的 ZIP 文件列表
 * @returns 素材文件清单
 */
async function collectProjectFiles(
  projectId: string,
  graph: GraphModel | null,
  zipFiles: { name: string; data: BlobPart }[],
): Promise<CanvasExportAsset[]> {
  if (!graph) return [];

  // 合并 image + media storageKeys(collectMediaStorageKeys 会匹配所有带 ':' 的 key)
  const keys = new Set<string>();
  collectImageStorageKeys(graph, keys);
  collectMediaStorageKeys(graph, keys);

  const files: CanvasExportAsset[] = [];
  await Promise.all(
    [...keys].map(async (storageKey) => {
      const blob = storageKey.startsWith('image:')
        ? await getImageBlob(storageKey)
        : await getMediaBlob(storageKey);
      if (!blob) return;
      const path = `files/${projectId}/${safeFileName(storageKey)}.${fileExtension(blob.type, storageKey)}`;
      files.push({
        storageKey,
        path,
        mimeType: blob.type || 'application/octet-stream',
        bytes: blob.size,
      });
      zipFiles.push({ name: path, data: blob });
    }),
  );
  return files;
}

/** 触发浏览器下载 */
function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延迟 revoke,确保下载已启动
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 文件名安全化(移除非法字符) */
function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_');
}

/** 根据 mimeType 推断文件扩展名 */
function fileExtension(mimeType: string, storageKey: string): string {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('jpeg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('audio')) return 'm4a';
  return storageKey.startsWith('image:') ? 'png' : 'bin';
}
