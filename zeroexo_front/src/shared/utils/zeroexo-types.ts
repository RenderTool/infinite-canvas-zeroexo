/**
 * .zeroexo 容器基类与路径引用系统
 *
 * 提供 ZeroexoContainer 容器接口、ZeroexoRef 路径引用解析、
 * 以及 AssetRegistry 内存注册表，用于管理 zeroexo 资产的生命周期与引用关系。
 */

// ─── 类型联合 ────────────────────────────────────────────────────────

/** 受支持的 zeroexo 资产类型 */
export type ZeroexoAssetType = 'zeroexo-text' | 'zeroexo-entity' | 'zeroexo-prompt';

// ─── 路径引用 ────────────────────────────────────────────────────────

/**
 * ZeroexoRef 路径引用标识
 * 格式: zeroexo:///path/to/asset?params
 */
export type ZeroexoRef = string;

/** resolveZeroexoRef 的解析结果 */
export interface ZeroexoRefResult {
  /** 资产路径（不含协议和查询参数） */
  assetId: string;
  /** 子路径（可选） */
  subPath?: string;
  /** 查询参数（可选） */
  params?: Record<string, string>;
}

/**
 * 解析 ZeroexoRef 路径引用
 *
 * @param ref - 符合 zeroexo:/// 格式的路径引用
 * @returns 解析成功返回 ZeroexoRefResult，解析失败返回 null
 *
 * @example
 * resolveZeroexoRef('zeroexo:///novels/大奉打更人')
 * // → { assetId: '/novels/大奉打更人' }
 *
 * resolveZeroexoRef('zeroexo:///novels/大奉打更人?unit=3')
 * // → { assetId: '/novels/大奉打更人', params: { unit: '3' } }
 *
 * resolveZeroexoRef('zeroexo:///novels/大奉打更人/characters')
 * // → { assetId: '/novels/大奉打更人', subPath: '/characters' }
 *
 * resolveZeroexoRef('invalid-ref')
 * // → null
 */
export function resolveZeroexoRef(ref: string): ZeroexoRefResult | null {
  try {
    const url = new URL(ref);
    if (url.protocol !== 'zeroexo:') return null;

    const pathname = url.pathname;
    if (!pathname || pathname === '/') return null;

    // 将路径名按 '/' 分割，过滤空字符串
    const segments = pathname.split('/').filter(Boolean);
    // 前两个 segment 构成 assetId（如 /novels/大奉打更人）
    const assetId = '/' + segments.slice(0, 2).join('/');

    // 剩余 segment 构成 subPath（如 /characters）
    const subPathSegments = segments.slice(2);
    const subPath = subPathSegments.length > 0 ? '/' + subPathSegments.join('/') : undefined;

    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    return {
      assetId,
      ...(subPath !== undefined ? { subPath } : {}),
      ...(Object.keys(params).length > 0 ? { params } : {}),
    };
  } catch {
    return null;
  }
}

// ─── ZeroexoContainer 基类接口 ──────────────────────────────────────

/** .zeroexo 容器元数据 */
export interface ZeroexoContainerMetadata {
  name: string;
  description?: string;
  tags: string[];
  thumbnail?: string;
  createdAt: number;
  updatedAt: number;
}

/** .zeroexo 容器基类接口 */
export interface ZeroexoContainer {
  format: `zeroexo-${string}`;
  version: '1.0';
  metadata: ZeroexoContainerMetadata;
  /** 路径引用标识, e.g. /zeroexo/novels/大奉打更人 */
  path: string;
  dependencies: ZeroexoRef[];
  referencedBy: ZeroexoRef[];
  data: Record<string, unknown>;
}

// ─── AssetRegistry 内存注册表 ───────────────────────────────────────

/** 资产注册表条目 */
export interface AssetRegistryEntry {
  path: string;
  assetId: string;
  type: string;
  name: string;
  /** 依赖的 assetId 列表 */
  dependencies: string[];
  /** 被哪些 assetId 引用 */
  referencedBy: string[];
}

/**
 * AssetRegistry 内存注册表
 *
 * 管理 zeroexo 资产的注册、解析与引用追踪。
 * 纯内存实现，不持久化。
 */
export class AssetRegistry {
  private entries: Map<string, AssetRegistryEntry> = new Map();
  private pathIndex: Map<string, string> = new Map(); // path → assetId

  /**
   * 注册一个资产到注册表
   * @throws 如果 assetId 或 path 已存在
   */
  register(asset: {
    path: string;
    assetId: string;
    type: string;
    name: string;
    dependencies?: string[];
  }): void {
    if (this.entries.has(asset.assetId)) {
      throw new Error(`AssetRegistry: assetId "${asset.assetId}" 已存在`);
    }
    if (this.pathIndex.has(asset.path)) {
      throw new Error(`AssetRegistry: path "${asset.path}" 已被占用`);
    }

    const deps = asset.dependencies ?? [];

    // 构建引用关系：为每个依赖项添加反向引用
    const refBy: string[] = [];
    for (const depId of deps) {
      const depEntry = this.entries.get(depId);
      if (depEntry) {
        depEntry.referencedBy.push(asset.assetId);
      }
    }

    const entry: AssetRegistryEntry = {
      path: asset.path,
      assetId: asset.assetId,
      type: asset.type,
      name: asset.name,
      dependencies: deps,
      referencedBy: refBy,
    };

    this.entries.set(asset.assetId, entry);
    this.pathIndex.set(asset.path, asset.assetId);
  }

  /**
   * 从注册表中移除一个资产
   * 同时会清理其他条目中对该资产的引用
   */
  unregister(assetId: string): void {
    const entry = this.entries.get(assetId);
    if (!entry) {
      throw new Error(`AssetRegistry: assetId "${assetId}" 不存在`);
    }

    // 从依赖该资产的条目的 referencedBy 中移除自己
    for (const entry of this.entries.values()) {
      const idx = entry.referencedBy.indexOf(assetId);
      if (idx !== -1) {
        entry.referencedBy.splice(idx, 1);
      }
    }

    this.pathIndex.delete(entry.path);
    this.entries.delete(assetId);
  }

  /**
   * 通过路径解析资产条目
   * @returns 匹配的条目，未找到返回 null
   */
  resolve(path: string): AssetRegistryEntry | null {
    const assetId = this.pathIndex.get(path);
    if (!assetId) return null;
    return this.entries.get(assetId) ?? null;
  }

  /**
   * 获取所有直接依赖指定 assetId 的条目
   */
  getDependents(assetId: string): AssetRegistryEntry[] {
    const result: AssetRegistryEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.dependencies.includes(assetId)) {
        result.push(entry);
      }
    }
    return result;
  }

  /**
   * 移动资产路径，自动更新引用（类似 UE5 重定向器）
   *
   * 将指定 path 的资产移动到新路径，同时更新所有依赖该路径的条目的引用。
   *
   * @throws 如果旧路径不存在或新路径已被占用
   */
  move(path: string, newPath: string): void {
    const assetId = this.pathIndex.get(path);
    if (!assetId) {
      throw new Error(`AssetRegistry: path "${path}" 不存在`);
    }
    if (this.pathIndex.has(newPath)) {
      throw new Error(`AssetRegistry: 新路径 "${newPath}" 已被占用`);
    }

    const entry = this.entries.get(assetId)!;

    // 更新路径索引
    this.pathIndex.delete(path);
    this.pathIndex.set(newPath, assetId);

    // 更新条目自身的路径
    entry.path = newPath;

    // 更新所有依赖旧路径的条目（重定向器行为）
    for (const otherEntry of this.entries.values()) {
      if (otherEntry.assetId === assetId) continue;
      const depIdx = otherEntry.dependencies.indexOf(path);
      if (depIdx !== -1) {
        otherEntry.dependencies[depIdx] = newPath;
      }
    }
  }
}