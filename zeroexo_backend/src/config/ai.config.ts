import { registerAs } from '@nestjs/config';

/**
 * AI 对接配置 - P3
 * - encryptionKey: API Key 加密密钥(AES-256-GCM,32 字节 hex)
 * - requestTimeoutMs: 生成请求超时(默认 60s)
 * - 服务端默认凭据(未配置用户级 provider 时兜底,适合 demo)
 * - maxPendingTasksPerUser: 每用户 pending+running 任务并发上限(成本保护,默认 3)
 * - cancelCooldownMs: 用户取消任务后再次提交的冷却时长(毫秒,默认 15000)
 *
 * 安全要求: 禁止全零密钥兜底。若显式配置但格式非法则启动即失败(避免误配置);
 * 留空时由 crypto 工具在真正执行加密/解密时抛异常(仅当需要加密的场景)。
 * 校验需放在工厂函数内部执行(此时 .env 已由 ConfigModule 加载)。
 */
export default registerAs('ai', () => {
  const encryptionKey = process.env.AI_ENCRYPTION_KEY ?? '';
  if (encryptionKey && !/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    throw new Error('AI_ENCRYPTION_KEY 必须是 32 字节 hex(64 字符)，请检查环境变量配置');
  }
  return {
    encryptionKey,
    requestTimeoutMs: Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 600000),
    // 每用户 pending+running 任务并发上限(成本保护,防止队列积压)
    maxPendingTasksPerUser: Number(process.env.AI_MAX_PENDING_TASKS_PER_USER ?? 3),
    // 取消任务后再次提交的冷却时长(毫秒,防止"提交-取消"循环滥用)
    cancelCooldownMs: Number(process.env.AI_CANCEL_COOLDOWN_MS ?? 15000),
    // 剧本导入分批拆分:单 chunk 字符阈值(超过则分批拆分,避免长文本超上下文截断)
    scriptChunkSize: Number(process.env.AI_SCRIPT_CHUNK_SIZE ?? 40000),
    // 服务端默认凭据(可选,demo 兜底)
    openaiApiKey: process.env.AI_OPENAI_API_KEY ?? '',
    openaiBaseUrl: process.env.AI_OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    geminiApiKey: process.env.AI_GEMINI_API_KEY ?? '',
    geminiBaseUrl: process.env.AI_GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com',
    stabilityApiKey: process.env.AI_STABILITY_API_KEY ?? '',
    stabilityBaseUrl:
      process.env.AI_STABILITY_BASE_URL ?? 'https://api.stability.ai/v2beta/stable-image',
    volcengineApiKey: process.env.AI_VOLCENGINE_API_KEY ?? '',
    volcengineBaseUrl:
      process.env.AI_VOLCENGINE_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3',
  };
});
