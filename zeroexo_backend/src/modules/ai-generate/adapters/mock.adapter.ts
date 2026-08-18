/**
 * Mock 适配器 - Bug5 测试渠道
 *
 * 不调用任何外部 API,直接返回测试内容:
 * - image: 生成纯色 PNG(使用 zlib 压缩)
 * - text:  返回测试文本(含 prompt 摘要)
 * - video: 返回最小有效 MP4 容器(1秒,无帧数据)
 * - audio: 生成静音 WAV(1秒)
 *
 * 用于验证端到端业务流程(前端→后端→Asset→下载→节点显示)。
 */

import { deflateSync } from 'zlib';
import type { AiProviderAdapter, GenerateRequest, GenerateResult, AdapterContext } from './adapter.interface';

// ===== CRC32 (PNG 用) =====

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** 生成纯色 PNG */
function createSolidPng(width: number, height: number, r: number, g: number, b: number): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowSize] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const off = y * rowSize + 1 + x * 3;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
    }
  }
  const compressed = deflateSync(raw);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 生成静音 WAV (16-bit PCM mono) */
function createSilentWav(durationSec: number): Buffer {
  const sampleRate = 44100;
  const numSamples = sampleRate * durationSec;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  // samples 默认全 0(静音)
  return buf;
}

// ===== MP4 box 构造辅助 =====

function mp4Box(type: string, ...children: Buffer[]): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const payload = Buffer.concat(children);
  const size = 8 + payload.length;
  const header = Buffer.alloc(8);
  header.writeUInt32BE(size, 0);
  typeBuf.copy(header, 4);
  return Buffer.concat([header, payload]);
}

function mp4FullBox(type: string, version: number, flags: number, data: Buffer): Buffer {
  const v = Buffer.alloc(4);
  v[0] = version;
  v[1] = (flags >> 16) & 0xff;
  v[2] = (flags >> 8) & 0xff;
  v[3] = flags & 0xff;
  return mp4Box(type, v, data);
}

/** 生成最小有效 MP4 (1秒,320x240,无实际帧数据) */
function createMinimalMp4(): Buffer {
  // ftyp
  const ftypData = Buffer.alloc(8);
  ftypData.write('isom', 0, 'ascii'); // major brand
  ftypData.writeUInt32BE(0x200, 4); // minor version
  const ftyp = mp4Box('ftyp', ftypData, Buffer.from('isom', 'ascii'));

  // mvhd (version 0, 108 bytes)
  const mvhdData = Buffer.alloc(96);
  mvhdData.writeUInt32BE(1000, 12); // timescale
  mvhdData.writeUInt32BE(1000, 16); // duration = 1s
  mvhdData.writeUInt32BE(0x00010000, 20); // rate = 1.0
  mvhdData.writeUInt16BE(0x0100, 24); // volume = 1.0
  // matrix (identity) at offset 36
  mvhdData.writeUInt32BE(0x00010000, 36); // [0]
  mvhdData.writeUInt32BE(0, 40);
  mvhdData.writeUInt32BE(0, 44);
  mvhdData.writeUInt32BE(0, 48);
  mvhdData.writeUInt32BE(0x00010000, 52); // [5]
  mvhdData.writeUInt32BE(0, 56);
  mvhdData.writeUInt32BE(0, 60);
  mvhdData.writeUInt32BE(0, 64);
  mvhdData.writeUInt32BE(0x40000000, 68); // [10]
  mvhdData.writeUInt32BE(2, 92); // next_track_ID
  const mvhd = mp4FullBox('mvhd', 0, 0, mvhdData);

  // tkhd (version 0)
  const tkhdData = Buffer.alloc(80);
  tkhdData.writeUInt32BE(1, 8); // track_ID
  tkhdData.writeUInt32BE(1000, 20); // duration
  // matrix at offset 36
  tkhdData.writeUInt32BE(0x00010000, 36);
  tkhdData.writeUInt32BE(0x00010000, 52);
  tkhdData.writeUInt32BE(0x40000000, 68);
  tkhdData.writeUInt32BE(0x01400000, 72); // width 320 (16.16)
  tkhdData.writeUInt32BE(0x00f00000, 76); // height 240 (16.16)
  const tkhd = mp4FullBox('tkhd', 0, 3, tkhdData);

  // mdhd (version 0)
  const mdhdData = Buffer.alloc(20);
  mdhdData.writeUInt32BE(1000, 8); // timescale
  mdhdData.writeUInt32BE(1000, 12); // duration
  mdhdData.writeUInt16BE(0x55c4, 16); // 'und'
  const mdhd = mp4FullBox('mdhd', 0, 0, mdhdData);

  // hdlr
  const hdlrData = Buffer.alloc(25);
  hdlrData.write('vide', 4, 'ascii'); // handler_type
  hdlrData.write('VideoHandler\0', 12, 'ascii');
  const hdlr = mp4FullBox('hdlr', 0, 0, hdlrData);

  // vmhd
  const vmhd = mp4FullBox('vmhd', 0, 1, Buffer.alloc(8));

  // dref (self-contained url entry)
  const urlEntry = mp4FullBox('url ', 0, 1, Buffer.alloc(0));
  const drefData = Buffer.alloc(4);
  drefData.writeUInt32BE(1, 0); // entry_count
  const dref = mp4FullBox('dref', 0, 0, Buffer.concat([drefData, urlEntry]));
  const dinf = mp4Box('dinf', dref);

  // stbl children (all empty)
  const stsd = mp4FullBox('stsd', 0, 0, Buffer.alloc(4)); // entry_count=0
  const stts = mp4FullBox('stts', 0, 0, Buffer.alloc(4));
  const stsc = mp4FullBox('stsc', 0, 0, Buffer.alloc(4));
  const stsz = mp4FullBox('stsz', 0, 0, Buffer.alloc(8));
  const stco = mp4FullBox('stco', 0, 0, Buffer.alloc(4));
  const stbl = mp4Box('stbl', stsd, stts, stsc, stsz, stco);

  const minf = mp4Box('minf', vmhd, dinf, stbl);
  const mdia = mp4Box('mdia', mdhd, hdlr, minf);
  const trak = mp4Box('trak', tkhd, mdia);
  const moov = mp4Box('moov', mvhd, trak);

  // mdat (empty)
  const mdat = mp4Box('mdat', Buffer.alloc(0));

  return Buffer.concat([ftyp, moov, mdat]);
}

// ===== Mock 适配器实现 =====

export class MockAdapter implements AiProviderAdapter {
  async generate(req: GenerateRequest, _ctx: AdapterContext): Promise<GenerateResult> {
    // 模拟网络延迟
    await new Promise((resolve) => setTimeout(resolve, 500));

    switch (req.kind) {
      case 'image':
        return this.generateImage(req);
      case 'text':
        return this.generateText(req);
      case 'video':
        return this.generateVideo(req);
      case 'audio':
        return this.generateAudio(req);
      default:
        throw new Error(`Mock 适配器不支持类型: ${req.kind}`);
    }
  }

  private generateImage(req: GenerateRequest): GenerateResult {
    // 根据 prompt 哈希选择颜色,保证同一 prompt 返回相同颜色
    const hash = this.hashString(req.prompt);
    const colors = [
      [233, 69, 96], // 红
      [59, 130, 246], // 蓝
      [34, 197, 94], // 绿
      [249, 115, 22], // 橙
      [139, 92, 246], // 紫
      [250, 204, 21], // 黄
    ];
    const [r, g, b] = colors[hash % colors.length]!;
    const size = (req.params?.size as string) || '512x512';
    const [w, h] = size.split('x').map((n) => parseInt(n, 10) || 512);
    const buffer = createSolidPng(Math.min(w, 1024), Math.min(h, 1024), r, g, b);
    return {
      kind: 'image',
      buffer,
      mimeType: 'image/png',
      ext: 'png',
      width: Math.min(w, 1024),
      height: Math.min(h, 1024),
      costTokens: 1,
      inputTokens: 1,
      outputTokens: 1,
    };
  }

  private generateText(req: GenerateRequest): GenerateResult {
    const promptPreview = req.prompt.slice(0, 100);
    const text = `[Mock Provider 测试响应]\n\n收到提示词: "${promptPreview}"\n\n这是一条测试文本,用于验证 AI 文本生成业务流程是否正常。前端节点应能正确显示此文本。`;
    return {
      kind: 'text',
      text,
      costTokens: 10,
      inputTokens: 5,
      outputTokens: 5,
    };
  }

  private generateVideo(_req: GenerateRequest): GenerateResult {
    const buffer = createMinimalMp4();
    return {
      kind: 'video',
      buffer,
      mimeType: 'video/mp4',
      ext: 'mp4',
      width: 320,
      height: 240,
      duration: 1,
      costTokens: 1,
      inputTokens: 1,
      outputTokens: 1,
    };
  }

  private generateAudio(req: GenerateRequest): GenerateResult {
    const seconds = (req.params?.seconds as number) || 1;
    const buffer = createSilentWav(Math.min(seconds, 5));
    return {
      kind: 'audio',
      buffer,
      mimeType: 'audio/wav',
      ext: 'wav',
      duration: Math.min(seconds, 5),
      costTokens: 1,
      inputTokens: 1,
      outputTokens: 1,
    };
  }

  private hashString(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }
}
