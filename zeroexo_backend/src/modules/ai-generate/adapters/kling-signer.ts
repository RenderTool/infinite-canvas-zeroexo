/**
 * Kling(可灵)官方 API 签名器 - DSL v2 auth.type='kling-hmac'
 *
 * 签名机制（Kling 官方现行标准，2026 确认）：
 *   - 使用 AccessKey + SecretKey 生成 JWT（HS256），放入 Authorization: Bearer <token>
 *   - Header:  { alg: 'HS256', typ: 'JWT' }
 *   - Payload: { iss: AccessKey, exp: now+1800s, nbf: now-5s }
 *   - Signature: HMAC-SHA256(SecretKey, base64url(header) + "." + base64url(payload))
 *   - 输出: base64url(header).base64url(payload).base64url(signature)
 *
 * 实现仅依赖 Node 内置 crypto，无需 jsonwebtoken 依赖。
 */
import * as crypto from 'crypto';

/** Base64URL 编码（JWT 风格：去 =、+ → -、/ → _） */
function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * 生成 Kling JWT
 * @param accessKeyId Kling AccessKey
 * @param accessKeySecret Kling SecretKey
 * @param nowSec 当前时间戳（秒），缺省取当前时间（可注入便于测试）
 */
export function signKlingJwt(accessKeyId: string, accessKeySecret: string, nowSec?: number): string {
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { iss: accessKeyId, exp: now + 1800, nbf: now - 5 };

  const h = toBase64Url(JSON.stringify(header));
  const p = toBase64Url(JSON.stringify(payload));
  const signingInput = `${h}.${p}`;

  const sig = crypto
    .createHmac('sha256', accessKeySecret)
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${signingInput}.${sig}`;
}

/**
 * 按 DSL v2 auth 配置生成请求头
 * @param auth 模板 auth 配置（缺省按 Bearer）
 * @param apiKey 渠道 apiKey（bearer/header 模式）
 * @param secretKey 渠道 secretKey（kling-hmac 模式）
 */
export function buildAuthHeaders(
  auth: { type: 'bearer' | 'header' | 'kling-hmac'; apiKeyHeader?: string; alsoBearer?: boolean; signer?: unknown } | undefined,
  apiKey: string,
  secretKey?: string,
): Record<string, string> {
  if (!auth || auth.type === 'bearer') {
    return { Authorization: `Bearer ${apiKey}` };
  }

  if (auth.type === 'header') {
    const headerName = auth.apiKeyHeader ?? 'X-Api-Key';
    const headers: Record<string, string> = { [headerName]: apiKey };
    if (auth.alsoBearer) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    return headers;
  }

  if (auth.type === 'kling-hmac') {
    if (!secretKey) {
      throw new Error('渠道缺少 SecretKey（AK/SK 签名渠道需配置 credentials.secretKey）');
    }
    const token = signKlingJwt(apiKey, secretKey);
    return { Authorization: `Bearer ${token}` };
  }

  return { Authorization: `Bearer ${apiKey}` };
}
