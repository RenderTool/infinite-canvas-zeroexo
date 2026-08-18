import { registerAs } from '@nestjs/config';

/**
 * JWT 配置 - 密钥与令牌过期时间。
 * - access token: 15 分钟(短时效,降低泄露风险)
 * - refresh token: 7 天(长时效,用于换发 access token)
 *
 * 安全要求: JWT_SECRET 必须在环境变量中显式配置,缺失时直接抛异常阻止启动,
 * 禁止使用任何默认密钥兜底(否则可被伪造任意身份 token)。
 * 校验需放在工厂函数内部执行(此时 .env 已由 ConfigModule 加载)。
 */
export default registerAs('jwt', () => {
  const secret = process.env.JWT_SECRET ?? '';
  if (!secret.trim()) {
    throw new Error('JWT_SECRET 未配置，请在环境变量中设置强随机密钥（如 openssl rand -hex 64），生产环境禁止使用默认值');
  }
  return {
    secret,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  };
});
