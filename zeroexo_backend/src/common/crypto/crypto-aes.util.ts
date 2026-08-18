import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM 加解密工具 - 用于 API Key 安全存储。
 * 密文格式: iv(base64):authTag(base64):ciphertext(base64)
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey(encryptionKey: string): Buffer {
  const buf = Buffer.from(encryptionKey, 'hex');
  if (buf.length !== 32) {
    throw new Error('AI_ENCRYPTION_KEY 必须是 32 字节 hex(64 字符)');
  }
  return buf;
}

/** 加密明文,返回 iv:authTag:ciphertext(base64) 格式密文 */
export function encrypt(plaintext: string, encryptionKey: string): string {
  const key = getKey(encryptionKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/** 解密 iv:authTag:ciphertext(base64) 格式密文 */
export function decrypt(ciphertext: string, encryptionKey: string): string {
  const key = getKey(encryptionKey);
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('密文格式错误');
  }
  const [ivB64, authTagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(dataB64, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/** 脱敏 API Key: 前 3 位 + *** + 后 2 位 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 6) return '***';
  return `${apiKey.slice(0, 3)}***${apiKey.slice(-2)}`;
}
