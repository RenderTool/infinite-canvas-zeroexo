/**
 * 图片字节工具
 *
 * 图生图 base64 data URL 前缀曾硬编码 image/png，JPEG 数据错标 png MIME，
 * 部分 API 严格校验 MIME 会解码异常 → 2026-08-25 seedream 参考图修复：
 * 按字节魔数嗅探真实 MIME。
 */

/** 按字节魔数探测图片 MIME（未知格式回退 png） */
export function sniffImageMime(buf: Buffer): string {
  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  // GIF: 47 49 46
  if (buf.length >= 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  // WebP: RIFF .... WEBP
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'image/webp';
  // BMP: 42 4D
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  return 'image/png';
}
