/**
 * folders-api - 文件夹后端 API 客户端
 *
 * 与后端 /api/folders 端点对接,提供文件夹树 CRUD 操作。
 * 系统预设文件夹(scene/character/prop/prompt/other)不可删除/重命名。
 */

import { apiFetch } from '@/services/api-client.js';

export type SystemFolderKey = 'scene' | 'character' | 'prop' | 'prompt' | 'other';

export interface AssetFolder {
  id: string;
  ownerId: string;
  name: string;
  parentId: string | null;
  system: boolean;
  systemKey: SystemFolderKey | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** 列出当前用户所有文件夹(平铺,前端构建树形) */
export async function listFolders(): Promise<AssetFolder[]> {
  return apiFetch<AssetFolder[]>('/folders');
}

/** 获取系统预设根目录(懒加载自动创建) */
export async function getSystemFolders(): Promise<AssetFolder[]> {
  return apiFetch<AssetFolder[]>('/folders/system');
}

/** 新建文件夹 */
export async function createFolder(input: {
  name: string;
  parentId?: string | null;
}): Promise<AssetFolder> {
  return apiFetch<AssetFolder>('/folders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** 更新文件夹(重命名/移动/排序) */
export async function updateFolder(
  id: string,
  patch: { name?: string; parentId?: string | null; sortOrder?: number },
): Promise<AssetFolder> {
  return apiFetch<AssetFolder>(`/folders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** 删除文件夹 */
export async function deleteFolder(id: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/folders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** 从平铺列表构建树形结构 */
export interface FolderNode extends AssetFolder {
  children: FolderNode[];
  depth: number;
}

export function buildFolderTree(folders: AssetFolder[]): FolderNode[] {
  const map = new Map<string, FolderNode>();
  folders.forEach((f) => {
    map.set(f.id, { ...f, children: [], depth: 0 });
  });
  const roots: FolderNode[] = [];
  map.forEach((node) => {
    if (node.parentId && map.has(node.parentId)) {
      const parent = map.get(node.parentId)!;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });
  // 深度计算 + 按 sortOrder 排序
  const assignDepth = (node: FolderNode, depth: number): void => {
    node.depth = depth;
    node.children.sort((a, b) => {
      if (a.system !== b.system) return a.system ? -1 : 1;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach((c) => assignDepth(c, depth + 1));
  };
  roots.sort((a, b) => {
    if (a.system !== b.system) return a.system ? -1 : 1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name);
  });
  roots.forEach((r) => assignDepth(r, 0));
  return roots;
}

/** 平铺树形结构为带深度信息的列表(用于下拉/选择) */
export function flattenFolderTree(
  nodes: FolderNode[],
  includeRoot = false,
  prefix = '',
): Array<FolderNode & { displayName: string }> {
  const result: Array<FolderNode & { displayName: string }> = [];
  const visit = (n: FolderNode, p: string): void => {
    const display = p ? `${p} / ${n.name}` : n.name;
    result.push({ ...n, displayName: display });
    n.children.forEach((c) => visit(c, display));
  };
  if (includeRoot) {
    // 根目录选项(虚拟)
    result.push({
      id: '__root__',
      ownerId: '',
      name: '根目录',
      parentId: null,
      system: false,
      systemKey: null,
      sortOrder: -1,
      createdAt: '',
      updatedAt: '',
      children: [],
      depth: -1,
      displayName: '根目录',
    });
  }
  nodes.forEach((n) => visit(n, prefix));
  return result;
}