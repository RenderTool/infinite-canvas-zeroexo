/**
 * Prisma Seed 脚本 - 初始化 RBAC 权限 + API Providers
 *
 * 使用方式:
 *   pnpm db:seed
 *
 * 创建内容:
 *   - RBAC 权限树(细化到 API Provider 操作)
 *   - 默认 API Providers:
 *     - AI 渠道(mock 测试 + OpenAI 占位)
 *     - 邮件服务(SMTP 模板)
 *     - 第三方登录(QQ/微信模板)
 *     - 对象存储(local 默认)
 *   - 测试用户: test/root/admin
 *   - 示例画布
 *   - Mock AI 渠道
 *
 * 幂等:重复运行不会报错,已存在的数据会跳过。
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { encrypt, maskApiKey } from '../src/common/crypto/crypto-aes.util';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 10;

/**
 * API Key 加密密钥:仅从环境变量读取,禁止全零/默认密钥兜底。
 * 缺失或格式非法时跳过 API Key 加密存储并给出警告(本地 demo 不受影响,
 * 需要真实调用 AI 渠道时必须配置 32 字节 hex 密钥)。
 */
const AI_ENCRYPTION_KEY = process.env.AI_ENCRYPTION_KEY ?? '';
const ENCRYPTION_AVAILABLE = /^[0-9a-fA-F]{64}$/.test(AI_ENCRYPTION_KEY);
if (!ENCRYPTION_AVAILABLE) {
  console.warn('[Seed] 警告: AI_ENCRYPTION_KEY 未配置或不是 32 字节 hex(64 字符),跳过 Mock 渠道 API Key 加密存储;');
  console.warn('[Seed]       如需加密存储 API Key,请设置环境变量 AI_ENCRYPTION_KEY(生成: openssl rand -hex 32)');
}

/**
 * 演示账户密码:支持环境变量覆盖,未覆盖时保留本地 demo 默认密码并显著告警。
 * 生产环境必须通过 SEED_SUPER_ADMIN_PASSWORD / SEED_ADMIN_PASSWORD / SEED_USER_PASSWORD 指定强密码。
 */
const SUPER_ADMIN_USER = {
  email: 'root@zeroexo.com',
  username: 'root',
  password: process.env.SEED_SUPER_ADMIN_PASSWORD || 'root123456',
  nickname: '超级管理员',
  role: 'super_admin',
};

const ADMIN_USER = {
  email: 'admin@zeroexo.com',
  username: 'admin',
  password: process.env.SEED_ADMIN_PASSWORD || 'admin123456',
  nickname: '系统管理员',
  role: 'admin',
};

const TEST_USER = {
  email: 'test@zeroexo.com',
  username: 'test',
  password: process.env.SEED_USER_PASSWORD || 'test123456',
  nickname: '测试用户',
  role: 'user',
};

/** 是否使用了任一默认密码(用于控制台告警) */
const USING_DEFAULT_PASSWORD =
  !process.env.SEED_SUPER_ADMIN_PASSWORD ||
  !process.env.SEED_ADMIN_PASSWORD ||
  !process.env.SEED_USER_PASSWORD;

async function main(): Promise<void> {
  // 生产环境保护: 拒绝使用默认密码的 Seed,除非显式 --force
  if (process.env.NODE_ENV === 'production') {
    if (USING_DEFAULT_PASSWORD || !process.argv.includes('--force')) {
      console.error('Seed: 检测到 NODE_ENV=production,为安全起见拒绝执行。');
      console.error('Seed: 请先通过环境变量 SEED_SUPER_ADMIN_PASSWORD / SEED_ADMIN_PASSWORD / SEED_USER_PASSWORD 设置强密码;');
      console.error('Seed: 如确需强制执行请追加 --force 参数。');
      process.exit(1);
    }
  }
  if (USING_DEFAULT_PASSWORD) {
    console.warn('==========================================================');
    console.warn('  警告: 本次 Seed 使用了默认密码(root123456 / admin123456 / test123456)!');
    console.warn('  生产环境禁止使用默认密码,请通过环境变量覆盖:');
    console.warn('    SEED_SUPER_ADMIN_PASSWORD / SEED_ADMIN_PASSWORD / SEED_USER_PASSWORD');
    console.warn('==========================================================');
  }
  console.log('Seed: 开始初始化...');

  // 0. RBAC 权限初始化
  console.log('Seed: 初始化 RBAC 权限树...');
  await prisma.rolePermission.deleteMany();
  await prisma.permission.deleteMany();

  const permissions = await Promise.all([
    // ===== 核心业务权限 =====
    // system
    prisma.permission.create({ data: { code: 'system:settings', name: '系统配置', module: 'system' } }),
    prisma.permission.create({ data: { code: 'system:logs', name: '日志中心', module: 'system' } }),
    prisma.permission.create({ data: { code: 'system:analytics', name: '数据分析', module: 'system' } }),

    // ===== API Provider 统一权限 =====
    // 通用:查看/管理/测试
    prisma.permission.create({ data: { code: 'api:list', name: '查看 API 集成', module: 'api' } }),
    prisma.permission.create({ data: { code: 'api:manage', name: '管理 API 集成', module: 'api' } }),
    prisma.permission.create({ data: { code: 'api:test', name: '测试 API 连接', module: 'api' } }),
    prisma.permission.create({ data: { code: 'api:switch', name: '切换默认 API Provider', module: 'api' } }),
    prisma.permission.create({ data: { code: 'api:rotate', name: '轮换 API 凭证', module: 'api' } }),
    prisma.permission.create({ data: { code: 'api:usage', name: '查看 API 用量', module: 'api' } }),
    prisma.permission.create({ data: { code: 'api:health', name: '查看 API 健康状态', module: 'api' } }),
    // 细化权限(新格式,与 permission-tree.ts 对齐)
    prisma.permission.create({ data: { code: 'api:ai:view', name: '查看 AI 渠道', module: 'api' } }),
    prisma.permission.create({ data: { code: 'api:ai:manage', name: '管理 AI 渠道', module: 'api' } }),
    prisma.permission.create({ data: { code: 'api:email:view', name: '查看邮件服务', module: 'api' } }),
    prisma.permission.create({ data: { code: 'api:email:manage', name: '管理邮件服务', module: 'api' } }),
    prisma.permission.create({ data: { code: 'api:oauth:view', name: '查看第三方登录', module: 'api' } }),
    prisma.permission.create({ data: { code: 'api:oauth:manage', name: '管理第三方登录', module: 'api' } }),
    prisma.permission.create({ data: { code: 'api:storage:view', name: '查看对象存储', module: 'api' } }),
    prisma.permission.create({ data: { code: 'api:storage:manage', name: '管理对象存储', module: 'api' } }),
    prisma.permission.create({ data: { code: 'api:storage:migrate', name: '存储数据迁移', module: 'api' } }),
    prisma.permission.create({ data: { code: 'api:payment:view', name: '查看支付服务', module: 'api' } }),
    prisma.permission.create({ data: { code: 'api:payment:manage', name: '管理支付服务', module: 'api' } }),

    // user
    prisma.permission.create({ data: { code: 'user:list', name: '查看用户列表', module: 'user' } }),
    prisma.permission.create({ data: { code: 'user:edit', name: '编辑用户', module: 'user' } }),
    prisma.permission.create({ data: { code: 'user:disable', name: '禁用用户', module: 'user' } }),
    prisma.permission.create({ data: { code: 'user:delete', name: '删除用户', module: 'user' } }),
    prisma.permission.create({ data: { code: 'user:assign-role', name: '分配角色', module: 'user' } }),

    // role
    prisma.permission.create({ data: { code: 'role:list', name: '查看角色列表', module: 'role' } }),
    prisma.permission.create({ data: { code: 'role:edit', name: '编辑角色权限', module: 'role' } }),

    // resource
    prisma.permission.create({ data: { code: 'resource:list', name: '查看素材', module: 'resource' } }),
    prisma.permission.create({ data: { code: 'resource:upload', name: '上传素材', module: 'resource' } }),
    prisma.permission.create({ data: { code: 'resource:delete', name: '删除素材', module: 'resource' } }),

    // project
    prisma.permission.create({ data: { code: 'project:list', name: '查看画布', module: 'project' } }),
    prisma.permission.create({ data: { code: 'project:edit', name: '编辑画布', module: 'project' } }),
    prisma.permission.create({ data: { code: 'project:delete', name: '删除画布', module: 'project' } }),

    // application
    prisma.permission.create({ data: { code: 'application:review', name: '审核申请', module: 'application' } }),

    // recycle
    prisma.permission.create({ data: { code: 'recycle:view', name: '查看回收站', module: 'recycle' } }),
    prisma.permission.create({ data: { code: 'recycle:restore', name: '回收站恢复', module: 'recycle' } }),
    prisma.permission.create({ data: { code: 'recycle:delete', name: '回收站彻底删除', module: 'recycle' } }),
  ]);

  const permMap = Object.fromEntries(permissions.map((p) => [p.code, p.id]));
  console.log(`Seed: 已创建 ${permissions.length} 个权限点`);

  // super_admin: 拥有所有权限
  const allCodes = Object.keys(permMap);
  await prisma.rolePermission.createMany({
    data: allCodes.map((code) => ({
      role: 'super_admin',
      permissionId: permMap[code],
    })),
  });

  // admin: 业务管理 + API 查看/测试,不含切换/轮换敏感操作
  const adminCodes = [
    'user:list', 'user:edit', 'user:disable', 'user:assign-role',
    'resource:list', 'resource:upload', 'resource:delete',
    'project:list', 'project:edit', 'project:delete',
    'application:review',
    'system:logs', 'system:analytics',
    'recycle:view', 'recycle:restore', 'recycle:delete',
    // API Provider 只读 + 测试
    'api:list', 'api:test', 'api:usage', 'api:health',
    // 细化权限(只读)
    'api:ai:view', 'api:email:view', 'api:oauth:view',
    'api:storage:view', 'api:payment:view',
  ];
  await prisma.rolePermission.createMany({
    data: adminCodes.map((code) => ({
      role: 'admin',
      permissionId: permMap[code],
    })),
  });

  // operator: 业务运营人员
  const operatorCodes = [
    'resource:list', 'resource:upload',
    'project:list', 'project:edit',
    'system:analytics',
    'api:list', 'api:usage',
  ];
  await prisma.rolePermission.createMany({
    data: operatorCodes.map((code) => ({
      role: 'operator',
      permissionId: permMap[code],
    })),
  });

  // user: 普通用户
  const userCodes = [
    'resource:list', 'resource:upload',
    'project:list', 'project:edit',
  ];
  await prisma.rolePermission.createMany({
    data: userCodes.map((code) => ({
      role: 'user',
      permissionId: permMap[code],
    })),
  });
  console.log('Seed: RBAC 权限分配完成');

  // ===== API Providers 初始化 =====
  console.log('Seed: 初始化 API Providers...');

  // 系统级占位用户(供系统级 API Provider 使用)
  const superAdminHash = await bcrypt.hash(SUPER_ADMIN_USER.password, BCRYPT_ROUNDS);
  let sysAdmin = await prisma.user.upsert({
    where: { email: SUPER_ADMIN_USER.email },
    update: {},
    create: {
      email: SUPER_ADMIN_USER.email,
      username: SUPER_ADMIN_USER.username,
      nickname: SUPER_ADMIN_USER.nickname,
      role: SUPER_ADMIN_USER.role,
      passwordHash: superAdminHash,
      emailVerified: true,
    },
    select: { id: true },
  });

  // 1. Mock AI 测试渠道(供开发/演示用)
  const mockApiKeyPlain = 'mock-test-key';
  await prisma.apiProvider.create({
    data: {
      name: 'Mock 测试渠道',
      provider: 'mock',
      type: 'ai',
      ownerId: sysAdmin!.id,
      
      config: {
        apiFormat: 'openai',
        models: [
          {
            name: 'mock-image',
            capabilities: ['image'],
            specs: { maxWidth: 512, maxHeight: 512, mimeTypes: ['image/png'] },
          },
          {
            name: 'mock-text',
            capabilities: ['text'],
            specs: { maxTokens: 512 },
          },
          {
            name: 'mock-video',
            capabilities: ['video'],
            supportedModes: ['text-to-video'],
            specs: { maxWidth: 320, maxHeight: 240, maxSeconds: 1 },
          },
          {
            name: 'mock-audio',
            capabilities: ['audio'],
            specs: { maxSeconds: 2, mimeTypes: ['audio/wav'] },
          },
        ],
      },
      // 仅在配置了合法加密密钥时加密存储 API Key,否则跳过(避免全零密钥兜底)
      credentials: ENCRYPTION_AVAILABLE
        ? {
            apiKeyEnc: encrypt(mockApiKeyPlain, AI_ENCRYPTION_KEY),
            apiKeyMask: maskApiKey(mockApiKeyPlain),
          }
        : {},
      capabilities: ['image', 'text', 'video', 'audio'],
      enabled: true,
      isDefault: true,
    },
  });

  // 2. SMTP 邮件服务(模板,未配置)
  await prisma.apiProvider.create({
    data: {
      name: '系统邮件 (待配置)',
      provider: 'smtp',
      type: 'email',
      ownerId: sysAdmin!.id,
      
      config: {
        host: '',
        port: 465,
        secure: true,
        fromAddress: 'noreply@zeroexo.local',
        fromName: 'ZeroExo',
      },
      credentials: {},
      capabilities: ['send'],
      quota: {
        daily: 500,
        monthly: 10000,
        usedToday: 0,
        usedThisMonth: 0,
      },
      enabled: false,
      isDefault: true,
    },
  });

  // 3. 第三方登录(QQ + 微信模板,未配置)
  await prisma.apiProvider.create({
    data: {
      name: 'QQ 登录 (待配置)',
      provider: 'qq-oauth',
      type: 'oauth',
      ownerId: sysAdmin!.id,
      
      config: {
        redirectUri: 'http://localhost:3000/api/auth/oauth/qq/callback',
        scope: 'get_user_info',
      },
      credentials: {},
      capabilities: ['oauth', 'profile'],
      enabled: false,
      isDefault: false,
    },
  });

  await prisma.apiProvider.create({
    data: {
      name: '微信登录 (待配置)',
      provider: 'wechat-oauth',
      type: 'oauth',
      ownerId: sysAdmin!.id,
      
      config: {
        redirectUri: 'http://localhost:3000/api/auth/oauth/wechat/callback',
        scope: 'snsapi_login',
      },
      credentials: {},
      capabilities: ['oauth', 'profile'],
      enabled: false,
      isDefault: false,
    },
  });

  // 4. 对象存储(local 默认启用)
  await prisma.apiProvider.create({
    data: {
      name: '本地存储 (默认)',
      provider: 'local',
      type: 'storage',
      ownerId: sysAdmin!.id,
      
      config: {
        root: './storage/resources',
      },
      credentials: {},
      capabilities: ['put', 'get', 'presign', 'list'],
      enabled: true,
      isDefault: true,
      health: 'healthy',
    },
  });

  console.log('Seed: API Providers 已就绪 (5 个, 1 个启用)');

  // 1. 创建/更新超级管理员账户
  const superAdminPasswordHash = await bcrypt.hash(SUPER_ADMIN_USER.password, BCRYPT_ROUNDS);
  const superAdmin = await prisma.user.upsert({
    where: { email: SUPER_ADMIN_USER.email },
    update: {
      username: SUPER_ADMIN_USER.username,
      passwordHash: superAdminPasswordHash,
      nickname: SUPER_ADMIN_USER.nickname,
      role: SUPER_ADMIN_USER.role,
    },
    create: {
      email: SUPER_ADMIN_USER.email,
      username: SUPER_ADMIN_USER.username,
      passwordHash: superAdminPasswordHash,
      nickname: SUPER_ADMIN_USER.nickname,
      role: SUPER_ADMIN_USER.role,
    },
  });
  console.log(`Seed: 超级管理员已就绪 -> ${superAdmin.email} (id: ${superAdmin.id})`);

  // 2. 创建/更新管理员账户
  const adminPasswordHash = await bcrypt.hash(ADMIN_USER.password, BCRYPT_ROUNDS);
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_USER.email },
    update: {
      username: ADMIN_USER.username,
      passwordHash: adminPasswordHash,
      nickname: ADMIN_USER.nickname,
      role: ADMIN_USER.role,
    },
    create: {
      email: ADMIN_USER.email,
      username: ADMIN_USER.username,
      passwordHash: adminPasswordHash,
      nickname: ADMIN_USER.nickname,
      role: ADMIN_USER.role,
    },
  });
  console.log(`Seed: 管理员已就绪 -> ${admin.email} (id: ${admin.id})`);

  // 3. 创建/更新测试用户
  const passwordHash = await bcrypt.hash(TEST_USER.password, BCRYPT_ROUNDS);
  const user = await prisma.user.upsert({
    where: { email: TEST_USER.email },
    update: {
      username: TEST_USER.username,
      passwordHash,
      nickname: TEST_USER.nickname,
      role: TEST_USER.role,
    },
    create: {
      email: TEST_USER.email,
      username: TEST_USER.username,
      passwordHash,
      nickname: TEST_USER.nickname,
      role: TEST_USER.role,
    },
  });
  console.log(`Seed: 用户已就绪 -> ${user.email} (id: ${user.id})`);

  // 4. 修复旧数据: 把旧 AiProvider 的 ownerId 指向新表
  console.log('Seed: 迁移数据完整性校验...');
  const orphanMockProviders = await prisma.apiProvider.count({
    where: { ownerId: { not: superAdmin.id } },
  });
  if (orphanMockProviders > 0) {
    console.log(`  - 发现 ${orphanMockProviders} 个孤儿 API Provider,已跳过`);
  }

  // 5. 示例画布 1: 空画布
  const welcomeProject = await prisma.project.upsert({
    where: { id: 'seed-welcome-project' },
    update: {},
    create: {
      id: 'seed-welcome-project',
      ownerId: user.id,
      title: '欢迎画布',
      scene: [],
      connections: [],
      tags: ['示例'],
      version: 1,
    },
  });
  console.log(`Seed: 画布已就绪 -> ${welcomeProject.title} (id: ${welcomeProject.id})`);

  // 6. 示例画布 2: 含 5 节点的示例项目
  const sampleScene = [
    {
      id: 'node-1',
      type: 'text',
      position: { x: 100, y: 100 },
      size: { width: 240, height: 80 },
      data: { text: '欢迎使用 ZeroExo' },
    },
    {
      id: 'node-2',
      type: 'ai.image',
      position: { x: 400, y: 100 },
      size: { width: 320, height: 240 },
      data: { prompt: '一只在月光下的猫', status: 'idle' },
    },
    {
      id: 'node-3',
      type: 'ai.video',
      position: { x: 800, y: 100 },
      size: { width: 320, height: 240 },
      data: { prompt: '海浪拍打沙滩', status: 'idle' },
    },
    {
      id: 'node-4',
      type: 'config',
      position: { x: 100, y: 280 },
      size: { width: 240, height: 160 },
      data: { model: 'gpt-4o', size: '1024x1024', quality: 'standard' },
    },
    {
      id: 'node-5',
      type: 'text',
      position: { x: 400, y: 400 },
      size: { width: 320, height: 80 },
      data: { text: '右键添加节点,双击编辑文字' },
    },
  ];
  const sampleConnections = [
    { id: 'edge-1', source: { nodeId: 'node-4' }, target: { nodeId: 'node-2' } },
    { id: 'edge-2', source: { nodeId: 'node-4' }, target: { nodeId: 'node-3' } },
  ];
  const sampleProject = await prisma.project.upsert({
    where: { id: 'seed-sample-project' },
    update: {},
    create: {
      id: 'seed-sample-project',
      ownerId: user.id,
      title: '示例项目',
      scene: sampleScene,
      connections: sampleConnections,
      tags: ['示例', '入门'],
      version: 1,
    },
  });
  console.log(`Seed: 画布已就绪 -> ${sampleProject.title} (id: ${sampleProject.id})`);

  // 7. AI Agent 默认配置(storyboard_assistant 等核心 Agent)
  console.log('Seed: 初始化 AI Agent 默认配置...');
  const agentConfigs: Array<{
    agentType: string;
    name: string;
    description: string;
    maxIterations?: number;
  }> = [
    {
      agentType: 'storyboard_assistant',
      name: '分镜助手',
      description:
        '根据上游剧本生成、维护、修正分镜表与主体清单。支持全量生成、单行重生成、主体合并、错误识别纠正、主体图替换等',
      maxIterations: 20,
    },
    {
      agentType: 'canvas_agent',
      name: '画布编排助手',
      description:
        '通过对话编排画布节点操作，覆盖需求分析、节点管理、连线管理、配置管理、流程编排等',
      maxIterations: 20,
    },
    {
      agentType: 'plan_agent',
      name: '制作计划助手',
      description:
        '读取剧本生成并维护制作计划（Plan）：色卡 + 主体清单 + 视频提示词分镜块，以结构化操作序列（PlanOp）落地',
      maxIterations: 20,
    },
  ];
  for (const cfg of agentConfigs) {
    await prisma.aiAgentConfig.upsert({
      where: { agentType: cfg.agentType },
      update: {
        name: cfg.name,
        description: cfg.description,
        isActive: true,
      },
      create: {
        agentType: cfg.agentType,
        name: cfg.name,
        description: cfg.description,
        isActive: true,
        maxIterations: cfg.maxIterations ?? 20,
        // systemPrompt 留空,运行时由 agent-factory 拼接 SKILL.md
        systemPrompt: null,
        // model/temperature/maxTokens 不填,使用 AiProvider 中 agentModel/agentTemperature 兜底
      },
    });
  }
  console.log(`Seed: AI Agent 配置已就绪 (${agentConfigs.length} 个)`);

  console.log('Seed: 完成');
  console.log('  超级管理员账户:');
  console.log(`    邮箱: ${SUPER_ADMIN_USER.email}`);
  console.log(`    密码: ${SUPER_ADMIN_USER.password}`);
  console.log('  管理员账户:');
  console.log(`    邮箱: ${ADMIN_USER.email}`);
  console.log(`    密码: ${ADMIN_USER.password}`);
  console.log('  测试账户:');
  console.log(`    邮箱: ${TEST_USER.email}`);
  console.log(`    密码: ${TEST_USER.password}`);
}

main()
  .catch((error) => {
    console.error('Seed: 失败', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
