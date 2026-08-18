/**
 * 项目元数据存储(Phase D1.2)
 *
 * 管理画布项目列表的元数据(id/title/createdAt/updatedAt 等),
 * 独立于 PersistencePlugin 的 graph 数据存储。
 *
 * 存储分层:
 * - localforage name: 'zeroexo'
 * - storeName: 'app_meta'
 * - key: 'projects'
 *
 * graph 数据本身由 PersistencePlugin 按 `graph:{projectId}` 存储,
 * 本模块只管理"项目列表"元数据,不触碰 graph 内容。
 */

import localforage from 'localforage';
import { nanoid } from 'nanoid';

// ===== 类型定义 =====

/** 项目元数据(不含 scene/connections 等大对象,轻量) */
export interface CanvasProjectMeta {
  /** 项目 id(nanoid,本地唯一;云端同步时映射为 UUID) */
  id: string;
  /** 项目标题 */
  title: string;
  /** 创建时间(ISO 字符串) */
  createdAt: string;
  /** 最后更新时间(ISO 字符串) */
  updatedAt: string;
  /** 缩略图(dataURL 或 storageKey,null 表示无缩略图) */
  thumbnailUrl: string | null;
  /** 标签数组(用于搜索与分类) */
  tags: string[];
  /** 节点数量(用于卡片显示,-1 表示未知) */
  nodeCount: number;
  /** 云同步版本号(本地为 0,每次同步递增) */
  version: number;
  /** 云端项目 id(null 表示未同步) */
  cloudId: string | null;
  /** 上次云端同步时间(null 表示从未同步) */
  lastSyncedAt: string | null;
}

/** 新建项目时的输入(可选字段由 store 填充默认值) */
export interface CreateProjectInput {
  title?: string;
  tags?: string[];
  thumbnailUrl?: string | null;
}

/** 更新项目时的输入(部分字段) */
export type UpdateProjectInput = Partial<Pick<CanvasProjectMeta, 'title' | 'tags' | 'thumbnailUrl' | 'nodeCount' | 'cloudId' | 'version' | 'lastSyncedAt'>>;

// ===== 存储配置 =====

const OLD_CONFIG = {
  name: 'zeroexo',
  storeName: 'app_state',
  projectsKey: 'zeroexo:projects',
};

const NEW_CONFIG = {
  name: 'zeroexo',
  storeName: 'app_meta',
  projectsKey: 'projects',
};

// ===== localforage 实例(app_meta 桶) =====

const appStateStore = localforage.createInstance({
  name: NEW_CONFIG.name,
  storeName: NEW_CONFIG.storeName,
});

/** 存储项目列表的 key */
const PROJECTS_KEY = NEW_CONFIG.projectsKey;

// ===== 内部辅助 =====

/** 从旧存储读取项目元数据 */
async function readFromOldStorage(): Promise<CanvasProjectMeta[] | null> {
  try {
    const oldStore = localforage.createInstance({
      name: OLD_CONFIG.name,
      storeName: OLD_CONFIG.storeName,
    });
    return oldStore.getItem<CanvasProjectMeta[]>(OLD_CONFIG.projectsKey);
  } catch {
    return null;
  }
}

/** 读取全部项目元数据(按 updatedAt 降序,自动从旧存储迁移) */
async function readAll(): Promise<CanvasProjectMeta[]> {
  // 先尝试从新存储读取
  const list = await appStateStore.getItem<CanvasProjectMeta[]>(PROJECTS_KEY);
  if (list) {
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  // 新存储没有数据,尝试从旧存储迁移
  const oldList = await readFromOldStorage();
  if (oldList) {
    const sorted = [...oldList].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    await appStateStore.setItem(PROJECTS_KEY, sorted);
    console.info('[project-store] migrated projects from old storage');
    return sorted;
  }

  return [];
}

/** 写入全部项目元数据 */
async function writeAll(list: CanvasProjectMeta[]): Promise<void> {
  await appStateStore.setItem(PROJECTS_KEY, list);
}

/** 生成当前 ISO 时间字符串 */
function now(): string {
  return new Date().toISOString();
}

// ===== 公开 API =====

/**
 * 列出所有项目(按 updatedAt 降序)
 */
export async function listProjects(): Promise<CanvasProjectMeta[]> {
  return readAll();
}

/**
 * 获取单个项目元数据
 */
export async function getProject(id: string): Promise<CanvasProjectMeta | null> {
  const list = await readAll();
  return list.find((p) => p.id === id) ?? null;
}

/**
 * 生成自动递增的画布名称
 * @param list 现有项目列表
 * @returns 新的画布名称(未命名画布1,未命名画布2...)
 */
function generateAutoTitle(list: CanvasProjectMeta[]): string {
  const prefix = '未命名画布';
  const regex = /^未命名画布(\d+)$/;
  let maxNum = 0;
  for (const p of list) {
    const match = p.title.match(regex);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  }
  return `${prefix}${maxNum + 1}`;
}

/**
 * 复制项目(含封面 + graph 数据)
 * @param sourceId 源项目 id
 * @param newTitle 新项目标题(可选,默认在原标题后加"副本")
 * @returns 新创建的项目元数据,源项目不存在返回 null
 */
export async function copyProject(sourceId: string, newTitle?: string): Promise<CanvasProjectMeta | null> {
  const { loadProjectGraph, saveProjectGraph } = await import('./graph-store.js');
  const list = await readAll();
  const source = list.find((p) => p.id === sourceId);
  if (!source) return null;
  const title = newTitle?.trim() || `${source.title} 副本`;
  const project: CanvasProjectMeta = {
    id: nanoid(),
    title,
    createdAt: now(),
    updatedAt: now(),
    thumbnailUrl: source.thumbnailUrl,
    tags: [...source.tags],
    nodeCount: source.nodeCount,
    version: 0,
    cloudId: null,
    lastSyncedAt: null,
  };
  // 拷贝 graph 数据
  try {
    const graph = await loadProjectGraph(sourceId);
    if (graph) {
      await saveProjectGraph(project.id, graph);
    }
  } catch (err) {
    console.warn('[project-store] copy graph data failed:', err);
  }
  list.push(project);
  await writeAll(list);
  return project;
}

/**
 * 新建项目
 * @param input 可选标题/标签/缩略图
 * @returns 新创建的项目元数据(含生成的 id 与时间戳)
 */
export async function createProject(input: CreateProjectInput = {}): Promise<CanvasProjectMeta> {
  const list = await readAll();
  const title = input.title?.trim() || generateAutoTitle(list);
  const project: CanvasProjectMeta = {
    id: nanoid(),
    title,
    createdAt: now(),
    updatedAt: now(),
    thumbnailUrl: input.thumbnailUrl ?? null,
    tags: input.tags ?? [],
    nodeCount: 0,
    version: 0,
    cloudId: null,
    lastSyncedAt: null,
  };
  list.push(project);
  await writeAll(list);
  return project;
}

/**
 * 更新项目元数据(部分字段)
 * 自动更新 updatedAt
 */
export async function updateProject(id: string, patch: UpdateProjectInput): Promise<CanvasProjectMeta | null> {
  const list = await readAll();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const current = list[idx];
  if (!current) return null;
  const updated: CanvasProjectMeta = {
    id: current.id,
    title: patch.title ?? current.title,
    createdAt: current.createdAt,
    updatedAt: now(),
    thumbnailUrl: patch.thumbnailUrl ?? current.thumbnailUrl,
    tags: patch.tags ?? current.tags,
    nodeCount: patch.nodeCount ?? current.nodeCount,
    version: patch.version ?? current.version,
    cloudId: patch.cloudId ?? current.cloudId,
    lastSyncedAt: patch.lastSyncedAt ?? current.lastSyncedAt,
  };
  list[idx] = updated;
  await writeAll(list);
  return updated;
}

/**
 * 重命名项目(便捷方法,等价于 updateProject(id, { title }))
 */
export async function renameProject(id: string, title: string): Promise<CanvasProjectMeta | null> {
  return updateProject(id, { title: title.trim() || '未命名画布' });
}

/**
 * 删除项目(仅删除元数据,不清理 graph 与图片)
 * graph 数据与图片清理由调用方负责(需 PersistencePlugin + image-storage 协同)
 * @returns 被删除的项目,若 id 不存在返回 null
 */
export async function deleteProject(id: string): Promise<CanvasProjectMeta | null> {
  const list = await readAll();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const removed = list.splice(idx, 1);
  await writeAll(list);
  return removed[0] ?? null;
}

/**
 * 批量删除项目
 * @param ids 要删除的项目 id 数组
 * @returns 被删除的项目数组
 */
export async function deleteProjects(ids: string[]): Promise<CanvasProjectMeta[]> {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const list = await readAll();
  const deleted: CanvasProjectMeta[] = [];
  const remaining: CanvasProjectMeta[] = [];
  for (const p of list) {
    if (idSet.has(p.id)) deleted.push(p);
    else remaining.push(p);
  }
  await writeAll(remaining);
  return deleted;
}

/**
 * 批量导入项目元数据(用于 ZIP 导入)
 * 重新生成 id 避免与本地冲突,标题加后缀
 * @param metas 要导入的元数据数组
 * @returns 导入后的新项目数组(含新 id)
 */
export async function importProjects(metas: CanvasProjectMeta[]): Promise<CanvasProjectMeta[]> {
  if (metas.length === 0) return [];
  const list = await readAll();
  const imported: CanvasProjectMeta[] = metas.map((m) => ({
    ...m,
    id: nanoid(), // 重新生成 id 避免冲突
    title: `${m.title}(导入)`,
    createdAt: now(),
    updatedAt: now(),
    version: 0,
    lastSyncedAt: null,
  }));
  list.push(...imported);
  await writeAll(list);
  return imported;
}

/**
 * 清空所有项目元数据(不清理 graph 与图片)
 * 危险操作,仅供"清空全部"或测试使用
 */
export async function clearAllProjects(): Promise<void> {
  await appStateStore.removeItem(PROJECTS_KEY);
}

/**
 * 标记项目已同步(更新 version + lastSyncedAt,Phase D5.2 云同步专用)
 * 不更新 updatedAt(避免触发本地排序变化与误标脏)。
 * @param id 项目 id
 * @param version 云端返回的最新版本号
 * @param lastSyncedAt 同步完成时间(ISO),不传则用当前时间
 * @returns 更新后的项目元数据,若 id 不存在返回 null
 */
export async function markProjectSynced(
  id: string,
  version: number,
  lastSyncedAt?: string,
): Promise<CanvasProjectMeta | null> {
  const list = await readAll();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const current = list[idx];
  if (!current) return null;
  list[idx] = {
    ...current,
    version,
    lastSyncedAt: lastSyncedAt ?? now(),
  };
  await writeAll(list);
  return list[idx] ?? null;
}

/**
 * 写入或更新项目元数据(全量覆盖,Phase D5.2 从云端拉取后写入本地)
 * 若 id 已存在则覆盖,不存在则追加。
 * @param meta 完整的项目元数据
 */
export async function upsertProject(meta: CanvasProjectMeta): Promise<CanvasProjectMeta> {
  const list = await readAll();
  const idx = list.findIndex((p) => p.id === meta.id);
  if (idx >= 0) {
    list[idx] = meta;
  } else {
    list.push(meta);
  }
  await writeAll(list);
  return meta;
}
