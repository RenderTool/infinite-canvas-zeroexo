/**
 * 孤儿资源清理脚本 - 清理 storage/assets/ 下未被引用的遗留文件
 *
 * 背景:
 *   sync-service 旧版本未传 contentHash,后端走"向后兼容"路径生成随机 nanoid 文件名,
 *   CAS 去重完全失效。同一张图片同步 N 次存储 N 份,导致 storage/assets/ 累积 10GB+ 冗余。
 *   修复后(sync-service 传 contentHash)新上传走 CAS 路径(storage/resources/),
 *   但旧遗留文件需要此脚本清理。
 *
 * 引用来源(判断文件是否"被引用"):
 *   1. Asset.storageKey - 素材库中的素材引用
 *   2. Project.scene JSON 中的 data.storageKey - 画布节点引用
 *   3. Resource.storageKey - CAS 资源池引用(已在 resources/ 下,不在清理范围)
 *
 * 清理逻辑:
 *   - 扫描 storage/assets/ 下所有文件
 *   - 文件相对路径(相对于 storage/)若不在引用集合中 → 视为孤儿 → 删除
 *   - 清理空目录
 *   - 支持 --dry-run 预览(只统计不删除)
 *
 * 使用方式:
 *   预览模式(不删除,只统计): npx ts-node prisma/cleanup-orphan-assets.ts --dry-run
 *   执行模式(实际删除):       npx ts-node prisma/cleanup-orphan-assets.ts
 *
 * 安全机制:
 *   - 默认 dry-run,需显式去掉 --dry-run 才执行删除
 *   - 跳过最近 1 小时内修改的文件(避免清理正在同步的文件)
 *   - 只清理 storage/assets/ 目录,不触碰 storage/resources/(CAS 路径)
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const prisma = new PrismaClient();

const STORAGE_ROOT = path.resolve(process.cwd(), 'storage');
const ASSETS_DIR = path.join(STORAGE_ROOT, 'assets');
/** 跳过最近 1 小时内修改的文件(避免清理正在同步的文件) */
const RECENT_FILE_THRESHOLD_MS = 60 * 60 * 1000;

async function main(): Promise<void> {
  const dryRun = !process.argv.includes('--confirm');
  console.log('===== 孤儿资源清理脚本 =====');
  console.log(`模式: ${dryRun ? '预览(不删除,需 --confirm 执行删除)' : '执行删除'}`);
  console.log(`存储根目录: ${STORAGE_ROOT}`);
  console.log(`清理目录: ${ASSETS_DIR}`);
  console.log('');

  // ===== Step 1: 收集所有被引用的 storageKey =====
  console.log('[1/3] 从数据库收集被引用的 storageKey...');

  // 1a. Asset.storageKey
  const assets = await prisma.asset.findMany({ select: { storageKey: true } });
  const assetKeys = new Set(assets.map((a) => a.storageKey));
  console.log(`  Asset.storageKey: ${assetKeys.size} 个唯一 key`);

  // 1b. Project.scene JSON → 提取 data.storageKey
  const projects = await prisma.project.findMany({ select: { scene: true } });
  const projectKeys = new Set<string>();
  for (const p of projects) {
    const scene = p.scene as unknown;
    if (!Array.isArray(scene)) continue;
    for (const node of scene) {
      if (!node || typeof node !== 'object' || !('data' in node)) continue;
      const data = (node as { data?: { storageKey?: string } }).data;
      if (data?.storageKey && typeof data.storageKey === 'string') {
        projectKeys.add(data.storageKey);
      }
    }
  }
  console.log(`  Project.scene storageKey: ${projectKeys.size} 个唯一 key`);

  // 1c. Resource.storageKey(CAS 资源池,已在 resources/ 下,仅作参考)
  const resources = await prisma.resource.findMany({ select: { storageKey: true } });
  const resourceKeys = new Set(resources.map((r) => r.storageKey));
  console.log(`  Resource.storageKey(CAS): ${resourceKeys.size} 个唯一 key`);

  // 合并引用集合
  const referencedKeys = new Set<string>([...assetKeys, ...projectKeys]);
  console.log(`  合计被引用(去重): ${referencedKeys.size} 个唯一 key`);

  // ===== Step 2: 扫描 storage/assets/ 目录 =====
  console.log('\n[2/3] 扫描 storage/assets/ 目录...');
  try {
    await fs.access(ASSETS_DIR);
  } catch {
    console.log(`  目录不存在: ${ASSETS_DIR},无需清理`);
    return;
  }
  const files = await listFilesRecursive(ASSETS_DIR);
  console.log(`  发现 ${files.length} 个文件`);

  // ===== Step 3: 识别并清理孤儿文件 =====
  console.log('\n[3/3] 识别并清理孤儿文件...');

  let referencedCount = 0;
  let orphanCount = 0;
  let recentSkippedCount = 0;
  let referencedSize = 0;
  let orphanSize = 0;
  let recentSkippedSize = 0;
  const now = Date.now();

  for (const file of files) {
    const stat = await fs.stat(file);
    // 跳过最近修改的文件(可能正在同步)
    if (now - stat.mtimeMs < RECENT_FILE_THRESHOLD_MS) {
      recentSkippedCount++;
      recentSkippedSize += stat.size;
      continue;
    }

    // 计算相对路径(相对于 storage/),与 DB 中的 storageKey 格式一致
    const relativeKey = path.relative(STORAGE_ROOT, file).replace(/\\/g, '/');

    if (referencedKeys.has(relativeKey)) {
      referencedCount++;
      referencedSize += stat.size;
    } else {
      orphanCount++;
      orphanSize += stat.size;
      if (!dryRun) {
        try {
          await fs.unlink(file);
        } catch (err) {
          console.warn(`  删除失败: ${relativeKey} - ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  // 清理空目录
  if (!dryRun && orphanCount > 0) {
    await cleanupEmptyDirs(ASSETS_DIR);
  }

  // ===== 汇总 =====
  console.log('\n===== 清理汇总 =====');
  console.log(`被引用文件: ${referencedCount} 个 (${formatSize(referencedSize)})`);
  console.log(`孤儿文件:   ${orphanCount} 个 (${formatSize(orphanSize)})`);
  console.log(`跳过(近期修改): ${recentSkippedCount} 个 (${formatSize(recentSkippedSize)})`);
  console.log('');
  if (dryRun) {
    console.log(`[预览模式] 预计可回收 ${formatSize(orphanSize)} 空间`);
    console.log('如需执行删除,请运行: npx ts-node prisma/cleanup-orphan-assets.ts --confirm');
  } else {
    console.log(`[执行完成] 已删除 ${orphanCount} 个孤儿文件,回收 ${formatSize(orphanSize)} 空间`);
    console.log('已清理空目录');
  }
}

/** 递归列出目录下所有文件 */
async function listFilesRecursive(dir: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await listFilesRecursive(full)));
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result;
}

/** 递归清理空目录 */
async function cleanupEmptyDirs(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const full = path.join(dir, entry.name);
      await cleanupEmptyDirs(full);
      const subEntries = await fs.readdir(full);
      if (subEntries.length === 0) {
        await fs.rmdir(full);
      }
    }
  }
}

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

main()
  .catch((err) => {
    console.error('清理脚本执行失败:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
