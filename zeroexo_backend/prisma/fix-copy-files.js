/**
 * fix-copy-files.js - 将公共提示词图片从旧私有路径复制到新的公共路径
 *
 * 背景: migrate-public-prompts-images.js 第一次运行时更新了 PublicPrompt.images
 * 中的 storageKey 指向 resources/public/...，但没有实际复制文件。
 * 本脚本从 Resource 表中读取旧路径，复制文件到新的公共路径。
 *
 * 执行:
 *   node prisma/fix-copy-files.js
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const STORAGE_ROOT = process.env.STORAGE_ROOT || 'storage';

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function variantKey(key, size) {
  const parsed = path.parse(key);
  return `${parsed.dir}${parsed.dir ? '/' : ''}${parsed.name}__${size}${parsed.ext}`;
}

async function main() {
  console.log('=== 查找需要复制文件的公共提示词图片 ===\n');

  const prompts = await prisma.publicPrompt.findMany();
  let totalNeeded = 0;
  let totalCopied = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const prompt of prompts) {
    if (!Array.isArray(prompt.images) || prompt.images.length === 0) continue;

    for (let i = 0; i < prompt.images.length; i++) {
      const img = prompt.images[i];
      const newKey = img.storageKey;

      // 只处理 resources/public/ 路径
      if (!newKey.startsWith('resources/public/')) continue;

      // 检查新路径文件是否已存在
      const newPath = path.join(STORAGE_ROOT, newKey);
      if (fs.existsSync(newPath)) {
        totalSkipped++;
        continue;
      }

      totalNeeded++;

      // 在 Resource 表中查找此 hash 对应的旧记录
      const hash = path.basename(newKey, path.extname(newKey));
      const resource = await prisma.resource.findUnique({ where: { hash } });

      if (!resource) {
        console.warn(`  [警告] hash 不在 Resource 表中: ${hash}`);
        totalErrors++;
        continue;
      }

      const oldKey = resource.storageKey;
      const oldPath = path.join(STORAGE_ROOT, oldKey);

      if (!fs.existsSync(oldPath)) {
        console.warn(`  [警告] 旧文件不存在: ${oldPath}`);
        totalErrors++;
        continue;
      }

      // 复制文件
      ensureDir(newPath);
      fs.copyFileSync(oldPath, newPath);
      console.log(`  [复制] ${oldKey} → ${newKey}`);

      // 复制变体
      for (const size of ['thumb', 'preview']) {
        const oldVarKey = variantKey(oldKey, size);
        const oldVarPath = path.join(STORAGE_ROOT, oldVarKey);
        if (fs.existsSync(oldVarPath)) {
          const newVarKey = variantKey(newKey, size);
          const newVarPath = path.join(STORAGE_ROOT, newVarKey);
          ensureDir(newVarPath);
          fs.copyFileSync(oldVarPath, newVarPath);
          console.log(`  [变体] ${size}: ${oldVarKey} → ${newVarKey}`);
        }
      }

      // 更新 Resource 记录指向新路径
      await prisma.resource.update({
        where: { id: resource.id },
        data: {
          storageKey: newKey,
          ownerId: '00000000-0000-0000-0000-000000000000',
        },
      });
      console.log(`  [更新] Resource 记录: ${oldKey} → ${newKey}`);

      totalCopied++;
    }
  }

  console.log(`\n=== 完成 ===`);
  console.log(`  需要复制的文件: ${totalNeeded}`);
  console.log(`  已复制: ${totalCopied}`);
  console.log(`  跳过(已存在): ${totalSkipped}`);
  console.log(`  错误: ${totalErrors}`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});