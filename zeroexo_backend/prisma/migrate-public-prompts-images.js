/**
 * migrate-public-prompts-images.js - 迁移公共提示词图片到 resources/public/ 路径
 *
 * 背景:
 *   之前导入的公共提示词图片存储在 resources/front/assets/{adminId}/... 私有路径，
 *   需要迁移到 resources/public/{hashPrefix}/{hash}.ext 公共路径，符合存储规范。
 *
 * 执行:
 *   node prisma/migrate-public-prompts-images.js
 *
 * 效果:
 *   1. 遍历所有 PublicPrompt 记录，对每个图片计算 SHA-256 hash
 *   2. 将文件复制到 resources/public/{hashPrefix}/{hash}.ext
 *   3. 更新 PublicPrompt.images[].storageKey 到新路径
 *   4. 在 Resource 表创建记录（CAS 去重），增加引用计数
 *   5. 保留 thumb/preview 图片变体也一起迁移
 *
 * 安全性:
 *   - 幂等:重复运行不会出错，跳过已迁移完成的图片
 *   - 事务:每个提示词更新在事务中
 */

const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const prisma = new PrismaClient();

/** 系统公共用户 ID */
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/** 存储根目录（本地模式）*/
const STORAGE_ROOT = process.env.STORAGE_ROOT || 'storage';

/**
 * 计算文件 SHA-256 hash
 */
function computeSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * 从 storageKey 提取扩展名
 */
function getExtension(filename) {
  const idx = filename.lastIndexOf('.');
  if (idx < 0 || idx === filename.length - 1) return '';
  return filename.slice(idx + 1).toLowerCase();
}

/**
 * 从 storageKey 派生 thumb/preview variant key
 */
function variantKey(key, size) {
  const parsed = path.parse(key);
  return `${parsed.dir}${parsed.dir ? '/' : ''}${parsed.name}__${size}${parsed.ext}`;
}

/**
 * 确保目录存在
 */
function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function main() {
  console.log('=== 开始迁移公共提示词图片 ===\n');

  const prompts = await prisma.publicPrompt.findMany();
  console.log(`共找到 ${prompts.length} 条公共提示词`);

  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const prompt of prompts) {
    const title = prompt.title.length > 40 ? prompt.title.slice(0, 40) + '...' : prompt.title;

    if (!Array.isArray(prompt.images) || prompt.images.length === 0) {
      console.log(`[跳过] ${title} (无图片)`);
      totalSkipped++;
      continue;
    }

    // 检查是否已经迁移完了（所有图片已经是 resources/public/ 开头）
    const allMigrated = prompt.images.every(img =>
      img.storageKey.startsWith('resources/public/')
    );
    if (allMigrated) {
      console.log(`[跳过] ${title} (已迁移)`);
      totalSkipped++;
      continue;
    }

    console.log(`[处理] ${title}`);

    try {
      await prisma.$transaction(async tx => {
        for (let i = 0; i < prompt.images.length; i++) {
          const img = prompt.images[i];
          const oldKey = img.storageKey;

          if (oldKey.startsWith('resources/public/')) {
            console.log(`  [跳过] 图片 ${i + 1} 已在公共路径: ${oldKey}`);
            continue;
          }

          // 读取原文件
          const oldPath = path.join(STORAGE_ROOT, oldKey);
          if (!fs.existsSync(oldPath)) {
            console.warn(`  [警告] 文件不存在: ${oldPath}`);
            continue;
          }

          const buffer = fs.readFileSync(oldPath);
          const hash = computeSha256(buffer);
          const ext = getExtension(oldKey);
          const hashPrefix = hash.slice(0, 2);
          const newKey = `resources/public/${hashPrefix}/${hash}${ext ? '.' + ext : ''}`;

          // 检查 Resource 是否已存在
          const existingResource = await tx.resource.findUnique({
            where: { hash },
          });

          // 获取 MIME type
          const mimeMap = {
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            webp: 'image/webp',
            gif: 'image/gif',
          };
          const mimeType = mimeMap[ext] || 'image/jpeg';

          if (existingResource) {
            if (existingResource.storageKey.startsWith('resources/public/')) {
              // 已迁移到公共路径，无需操作
              console.log(`  [去重] 图片 ${i + 1}: hash ${hash.slice(0, 8)} 已存在，复用 ${newKey}`);
            } else {
              // 旧 Resource 指向私有路径，需要更新为公共路径
              console.log(`  [更新] 图片 ${i + 1}: Resource ${hash.slice(0, 8)} 从私有路径更新为公共路径`);
              await tx.resource.update({
                where: { id: existingResource.id },
                data: {
                  storageKey: newKey,
                  ownerId: SYSTEM_USER_ID,
                },
              });

              // 复制文件到新路径
              const newPath = path.join(STORAGE_ROOT, newKey);
              ensureDir(newPath);
              fs.copyFileSync(oldPath, newPath);
              console.log(`  [迁移] 图片 ${i + 1}: ${oldKey} → ${newKey}`);

              // 迁移变体（thumb / preview）
              for (const size of ['thumb', 'preview']) {
                const oldVariantKey = variantKey(oldKey, size);
                const oldVariantPath = path.join(STORAGE_ROOT, oldVariantKey);
                if (fs.existsSync(oldVariantPath)) {
                  const newVariantKey = variantKey(newKey, size);
                  const newVariantPath = path.join(STORAGE_ROOT, newVariantKey);
                  ensureDir(newVariantPath);
                  fs.copyFileSync(oldVariantPath, newVariantPath);
                  console.log(`  [迁移] 变体 ${size}: ${oldVariantKey} → ${newVariantKey}`);
                }
              }
            }
          } else {
            // 全新的 Resource
            const newPath = path.join(STORAGE_ROOT, newKey);
            ensureDir(newPath);
            fs.copyFileSync(oldPath, newPath);

            await tx.resource.create({
              data: {
                hash,
                storageKey: newKey,
                ownerId: SYSTEM_USER_ID,
                size: BigInt(buffer.length),
                mimeType,
                refCount: 0,
              },
            });

            console.log(`  [迁移] 图片 ${i + 1}: ${oldKey} → ${newKey}`);

            // 迁移变体（thumb / preview）
            for (const size of ['thumb', 'preview']) {
              const oldVariantKey = variantKey(oldKey, size);
              const oldVariantPath = path.join(STORAGE_ROOT, oldVariantKey);
              if (fs.existsSync(oldVariantPath)) {
                const newVariantKey = variantKey(newKey, size);
                const newVariantPath = path.join(STORAGE_ROOT, newVariantKey);
                ensureDir(newVariantPath);
                fs.copyFileSync(oldVariantPath, newVariantPath);
                console.log(`  [迁移] 变体 ${size}: ${oldVariantKey} → ${newVariantKey}`);
              }
            }
          }

          // 更新 images 中的 storageKey
          prompt.images[i].storageKey = newKey;
          totalMigrated++;

          // 确保 Resource refCount +1（PublicPrompt 引用此资源）
          await tx.resource.updateMany({
            where: { storageKey: newKey },
            data: { refCount: { increment: 1 }, deletedAt: null },
          });
        }

        // 更新 PublicPrompt.images
        await tx.publicPrompt.update({
          where: { id: prompt.id },
          data: { images: prompt.images },
        });
      });

      console.log(`  [完成] 迁移成功\n`);
    } catch (err) {
      console.error(`  [错误] 迁移失败:`, err);
      totalErrors++;
    }
  }

  console.log('\n=== 迁移完成 ===');
  console.log(`  已迁移图片: ${totalMigrated}`);
  console.log(`  跳过条数: ${totalSkipped}`);
  console.log(`  错误条数: ${totalErrors}`);

  if (totalErrors === 0) {
    console.log('\n✓ 全部迁移成功');
  } else {
    console.log(`\n! 有 ${totalErrors} 个错误，请检查日志后重试`);
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
