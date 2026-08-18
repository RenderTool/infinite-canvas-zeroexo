import { registerAs } from '@nestjs/config';

/**
 * 数据库配置 - 从环境变量读取 DATABASE_URL。
 * Prisma schema 通过 env("DATABASE_URL") 直接读取,此处仅用于 ConfigService 统一管理与校验。
 */
export default registerAs('database', () => ({
  url:
    process.env.DATABASE_URL ??
    'postgresql://zeroexo:zeroexo@localhost:5432/zeroexo?schema=public',
}));
