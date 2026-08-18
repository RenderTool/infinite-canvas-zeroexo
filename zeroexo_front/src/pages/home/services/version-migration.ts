/**
 * ZIP 导出版本迁移系统
 *
 * 负责提供 ZIP 导入时的版本校验和迁移能力。
 * 当 CanvasExportFile.version < CURRENT_VERSION 时，
 * 自动链式迁移到当前版本，确保旧格式 ZIP 能正常导入。
 *
 * 用法:
 * ```ts
 * import { CURRENT_VERSION, migrateExportFile, registerZipMigration } from './version-migration.js';
 *
 * const migrated = migrateExportFile(data);
 * ```
 *
 * 未来新增版本时:
 * ```ts
 * registerZipMigration(1, (data) => ({
 *   ...data,
 *   version: 2,
 *   // 转换 projects 中字段... 例如旧 storageKey 前缀统一
 *   projects: data.projects.map(convertToV2),
 * }));
 * ```
 */

import type { CanvasExportFile } from './export-types.js';

/** 当前 ZIP 导出格式版本（随格式升级递增） */
export const CURRENT_ZIP_VERSION = 1;

/** 迁移函数：从某个版本升级到下一版本 */
export type ZipMigrationFn = (data: CanvasExportFile) => CanvasExportFile;

/** 版本 → 迁移函数注册表 */
const migrations = new Map<number, ZipMigrationFn>();

/**
 * 注册 ZIP 版本迁移函数
 * @param fromVersion 源版本号
 * @param fn 迁移函数（返回升级后的完整数据）
 */
export function registerZipMigration(fromVersion: number, fn: ZipMigrationFn): void {
  if (migrations.has(fromVersion)) {
    console.warn(`[version-migration] overwriting migration from v${fromVersion}`);
  }
  migrations.set(fromVersion, fn);
}

/**
 * 获取当前支持的版本号列表（用于调试/展示）
 */
export function getSupportedVersions(): number[] {
  return [CURRENT_ZIP_VERSION, ...migrations.keys()].sort((a, b) => a - b);
}

/**
 * 执行版本迁移：从旧版本链式升级到当前版本
 * @param data 从 ZIP 中解析出的原始数据
 * @returns 迁移后的数据（如果已是最新版则原样返回）
 * @throws Error 如果缺少中间版本的迁移函数
 */
export function migrateExportFile(data: CanvasExportFile): CanvasExportFile {
  let current = { ...data };

  // 无 version 字段视为 v1
  const rawVersion = (data as { version?: number }).version ?? 1;
  if (rawVersion < 1) {
    console.warn(`[version-migration] unknown version ${rawVersion}, treating as v1`);
  }

  while (current.version < CURRENT_ZIP_VERSION) {
    const migrator = migrations.get(current.version);
    if (!migrator) {
      throw new Error(
        `ZIP 文件版本 v${current.version} 无法自动升级到 v${CURRENT_ZIP_VERSION}。` +
        `缺少从 v${current.version} 到 v${current.version + 1} 的迁移函数。` +
        `请使用兼容版本的应用程序重新导出。`,
      );
    }

    try {
      const beforeVersion = current.version;
      current = migrator(current);
      if (current.version <= beforeVersion) {
        throw new Error(
          `迁移函数 v${beforeVersion} 未正确升级版本号（仍为 ${current.version}）`,
        );
      }
      console.log(`[version-migration] v${beforeVersion} → v${current.version} 迁移成功`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `ZIP 文件版本迁移失败（v${current.version} → v${current.version + 1}）: ${msg}`,
      );
    }
  }

  return current;
}
