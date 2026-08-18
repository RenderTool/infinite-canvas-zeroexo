/**
 * seed-system-user.js - 创建系统级公共用户
 *
 * 用法: node prisma/seed-system-user.js
 * 需要在 zeroexo_backend 目录下执行
 *
 * 系统用户 ID: 00000000-0000-0000-0000-000000000000
 * 所有 scope=public 的资源归此用户所有，避免与管理员个人资源耦合。
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

async function main() {
  console.log('正在创建系统级公共用户...\n');

  const existing = await prisma.user.findUnique({ where: { id: SYSTEM_USER_ID } });
  if (existing) {
    console.log('  [已存在] 系统用户已存在，跳过创建');
  } else {
    await prisma.user.create({
      data: {
        id: SYSTEM_USER_ID,
        email: 'system@zeroexo.app',
        username: 'system',
        passwordHash: '__SYSTEM_ACCOUNT__',
        nickname: '系统公共账户',
        role: 'system',
        emailVerified: true,
        storageQuota: BigInt('9223372036854775807'), // 无限制
      },
    });
    console.log('  [创建] 系统用户 (00000000-0000-0000-0000-000000000000)');
  }

  // 查询并更新现有公共资源（storageKey 以 resources/public/ 开头的）
  const publicResources = await prisma.resource.findMany({
    where: {
      storageKey: { startsWith: 'resources/public/' },
      ownerId: { not: SYSTEM_USER_ID },
    },
  });

  if (publicResources.length > 0) {
    console.log(`\n发现 ${publicResources.length} 个公共资源 ownerId 需要更新...`);
    const updated = await prisma.resource.updateMany({
      where: {
        storageKey: { startsWith: 'resources/public/' },
        ownerId: { not: SYSTEM_USER_ID },
      },
      data: { ownerId: SYSTEM_USER_ID },
    });
    console.log(`  [更新] ${updated.count} 个资源的 ownerId 已改为系统用户`);
  } else {
    console.log('\n没有需要更新的公共资源');
  }

  console.log('\n系统用户初始化完成！');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('初始化失败:', e);
  process.exit(1);
});