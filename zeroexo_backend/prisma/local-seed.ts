/**
 * 本地种子脚本 - 导入 SMTP + AI 渠道的真实凭证
 *
 * 配置从 local-seed-config.json 读取,该文件已 gitignored。
 * 防止真实凭证意外提交到代码仓库。
 *
 * 使用方式:
 *   1. 编辑 prisma/local-seed-config.json 填入真实凭证
 *   2. pnpm local:seed
 *
 * 幂等:重复运行不会报错,会跳过已存在的数据或覆盖更新。
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { encrypt, maskApiKey } from '../src/common/crypto/crypto-aes.util';

const prisma = new PrismaClient();

/**
 * API Key 加密密钥:仅从环境变量读取,禁止全零/默认密钥兜底。
 * 缺失或格式非法时跳过需要加密存储真实凭证的导入并给出警告,
 * 防止真实凭证以明文/弱加密形式落入数据库。
 */
const AI_ENCRYPTION_KEY = process.env.AI_ENCRYPTION_KEY ?? '';
const ENCRYPTION_AVAILABLE = /^[0-9a-fA-F]{64}$/.test(AI_ENCRYPTION_KEY);
if (!ENCRYPTION_AVAILABLE) {
  console.warn('[LocalSeed] 警告: AI_ENCRYPTION_KEY 未配置或不是 32 字节 hex(64 字符),跳过需要加密存储真实凭证的导入;');
  console.warn('[LocalSeed]       请设置环境变量 AI_ENCRYPTION_KEY(生成: openssl rand -hex 32)后重跑。');
}

interface AiModelEntry {
  name: string;
  capabilities: string[];
  specs?: Record<string, any>;
  supportedModes?: string[];
}

interface AiChannelConfig {
  provider: string;
  apiFormat: string;
  apiKey: string;
  baseUrl: string;
  models: AiModelEntry[];
}

interface LocalSeedConfig {
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    fromAddress: string;
    fromName: string;
  };
  ai?: {
    llm?: AiChannelConfig;
    image?: AiChannelConfig;
    video?: AiChannelConfig;
    audio?: AiChannelConfig;
  };
}

function loadConfig(): LocalSeedConfig | null {
  const configPath = path.join(__dirname, 'local-seed-config.json');
  if (!fs.existsSync(configPath)) {
    console.log('local-seed-config.json 不存在,跳过本地种子。创建模板文件即可启用。');
    return null;
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config: LocalSeedConfig = JSON.parse(raw);
    return config;
  } catch (err) {
    console.error('解析 local-seed-config.json 失败:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function seedSmtp(config: NonNullable<LocalSeedConfig['smtp']>) {
  if (!config.host || !config.user || !config.pass) {
    console.log('SMTP 配置不完整(host/user/pass),跳过。');
    return;
  }

  const sysAdmin = await prisma.user.findFirst({
    where: { role: 'super_admin' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!sysAdmin) {
    console.log('未找到 super_admin 用户,跳过 SMTP 导入。请先运行 pnpm db:seed。');
    return;
  }

  const existing = await prisma.apiProvider.findFirst({
    where: { provider: 'smtp', type: 'email', ownerId: sysAdmin.id },
  });

  const data = {
    name: `SMTP (${config.host})`,
    provider: 'smtp',
    type: 'email' as const,
    ownerId: sysAdmin.id,
    
    config: {
      host: config.host,
      port: config.port,
      secure: config.secure,
      fromAddress: config.fromAddress || `noreply@${config.host.replace(/^smtp\./, '')}`,
      fromName: config.fromName || 'ZeroExo',
    },
    credentials: {
      user: config.user,
      pass: encrypt(config.pass, AI_ENCRYPTION_KEY),
    },
    capabilities: ['send', 'verify'],
    quota: {
      daily: 500,
      monthly: 10000,
      dailyUsed: 0,
      monthlyUsed: 0,
    },
    enabled: true,
    isDefault: true,
    health: 'unknown' as const,
  };

  if (existing) {
    await prisma.apiProvider.update({ where: { id: existing.id }, data });
    console.log(`SMTP 已更新: ${config.host} (user=${config.user}, pass已加密)`);
  } else {
    await prisma.apiProvider.create({ data });
    console.log(`SMTP 已创建: ${config.host} (user=${config.user}, pass已加密)`);
  }
}

/** AI 类型标记与能力映射(参考 waoowaoo 项目) */
const AI_TYPE_META: Record<string, { label: string; capabilities: string[]; description: string }> = {
  llm:   { label: '语言模型',   capabilities: ['text'],            description: 'LLM / 对话 / 文本生成' },
  image: { label: '图像模型',   capabilities: ['image'],           description: '文生图 / 图生图' },
  video: { label: '视频模型',   capabilities: ['video'],           description: '文生视频 / 图生视频' },
  audio: { label: '音频模型',   capabilities: ['audio'],           description: '语音合成 / 音乐生成' },
};

async function seedAiChannel(
  sysAdminId: string,
  channelType: string,
  channelConfig: AiChannelConfig,
) {
  if (!channelConfig.apiKey) {
    console.log(`  AI ${AI_TYPE_META[channelType]?.label || channelType} 的 API Key 为空,跳过。`);
    return;
  }

  const meta = AI_TYPE_META[channelType] || { label: channelType, capabilities: ['text'], description: '' };
  const providerName = channelConfig.provider || 'openai';
  const channelLabel = `${providerName === 'openai' ? 'OpenAI' : providerName} (${meta.label})`;

  // 用 provider+type+channelType 三元组判断是否已存在
  const existing = await prisma.apiProvider.findFirst({
    where: { provider: `${providerName}-${channelType}`, type: 'ai', ownerId: sysAdminId },
  });

  const data = {
    name: channelLabel,
    provider: `${providerName}-${channelType}`,
    type: 'ai' as const,
    ownerId: sysAdminId,
    
    config: JSON.parse(JSON.stringify({
      apiFormat: channelConfig.apiFormat || 'openai',
      baseUrl: channelConfig.baseUrl || '',
      models: channelConfig.models || [],
    })),
    credentials: JSON.parse(JSON.stringify({
      apiKeyEnc: encrypt(channelConfig.apiKey, AI_ENCRYPTION_KEY),
      apiKeyMask: maskApiKey(channelConfig.apiKey),
    })),
    capabilities: meta.capabilities,
    enabled: true,
    isDefault: channelType === 'llm', // LLM 设为默认
    health: 'unknown' as const,
  };

  if (existing) {
    await prisma.apiProvider.update({ where: { id: existing.id }, data });
    console.log(`  AI 渠道已更新: ${channelLabel} (apiKey=${maskApiKey(channelConfig.apiKey)})`);
  } else {
    await prisma.apiProvider.create({ data });
    console.log(`  AI 渠道已创建: ${channelLabel} (apiKey=${maskApiKey(channelConfig.apiKey)})`);
  }
}

async function seedAi(sysAdminId: string, config: NonNullable<LocalSeedConfig['ai']>) {
  if (!ENCRYPTION_AVAILABLE) {
    console.log('  AI_ENCRYPTION_KEY 不可用,跳过 AI 渠道导入(真实 API Key 需要加密存储)。');
    return;
  }

  const channels: [string, AiChannelConfig | undefined][] = [
    ['llm', config.llm],
    ['image', config.image],
    ['video', config.video],
    ['audio', config.audio],
  ];

  let hasAny = false;
  for (const [channelType, channelConfig] of channels) {
    if (channelConfig && channelConfig.apiKey) {
      hasAny = true;
      await seedAiChannel(sysAdminId, channelType, channelConfig);
    }
  }

  if (!hasAny) {
    console.log('  AI 配置为空,跳过。如需导入请编辑 local-seed-config.json 填入 apiKey。');
  }
}

async function main(): Promise<void> {
  console.log('本地种子: 开始...');

  const config = loadConfig();
  if (!config) {
    console.log('无可用配置,退出。');
    return;
  }

  if (config.smtp) {
    await seedSmtp(config.smtp);
  } else {
    console.log('未配置 SMTP,跳过。');
  }

  if (config.ai) {
    // 先找 super_admin 用户 ID,seedAiChannel 需要它
    const sysAdmin = await prisma.user.findFirst({
      where: { role: 'super_admin' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (sysAdmin) {
      await seedAi(sysAdmin.id, config.ai);
    } else {
      console.log('未找到 super_admin 用户,跳过 AI 导入。请先运行 pnpm db:seed。');
    }
  } else {
    console.log('未配置 AI,跳过。');
  }

  console.log('本地种子: 完成。');
}

main()
  .catch((err) => {
    console.error('本地种子失败:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
