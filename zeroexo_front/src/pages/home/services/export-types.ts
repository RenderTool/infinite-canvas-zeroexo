/**
 * 导出/导入共享类型
 *
 * ZIP 结构:
 * - projects.json: CanvasExportFile 序列化
 * - files/{storageKey}.{ext}: 二进制素材文件
 *
 * 每个项目含 meta(元数据)+ graph(图数据)+ files(素材清单)
 */

import type { CanvasProjectMeta } from '@zeroexo/plugin-persistence';
import type { GraphModel } from '@zeroexo/core';

/** 导出文件根结构 */
export interface CanvasExportFile {
  app: 'zeroexo-canvas';
  version: 1;
  exportedAt: string;
  projects: CanvasProjectExportItem[];
}

/** 单个项目的导出项 */
export interface CanvasProjectExportItem {
  meta: CanvasProjectMeta;
  graph: GraphModel | null;
  files: CanvasExportAsset[];
}

/** 素材文件清单项(storageKey → ZIP 内路径映射) */
export interface CanvasExportAsset {
  storageKey: string;
  path: string;
  mimeType: string;
  bytes: number;
}
