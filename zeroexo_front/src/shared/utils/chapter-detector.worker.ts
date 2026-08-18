/**
 * chapter-detector.worker - 章节检测 Web Worker（流式版）
 *
 * 支持流式接收文件分块，仅返回章节边界（标题+偏移量，不含内容）。
 * 大幅降低大文件的内存占用和 postMessage 传输量。
 *
 * 消息协议：
 *   发送 { type: 'chunk', data: { text: string; offset: number; isLast: boolean } }
 *   回复 { type: 'progress', data: { phase: string; message: string; progress?: number } }
 *   回复 { type: 'result',  data: ChapterBoundaryResult }
 *   回复 { type: 'error',   data: { message: string } }
 */

import { detectStructure } from './chapter-detector.js';

// ── 类型定义 ─────────────────────────────────────────────────────────

export interface ChapterBoundary {
  title: string;
  startOffset: number;   // 章节标题在文件中的起始偏移
  lineEndOffset: number; // 标题行结束偏移（\n 之后）
  charCount: number;     // 章节内容字符数（不含标题行）
}

export interface ChapterBoundaryResult {
  type: 'chaptered' | 'paragraph' | 'unknown';
  chapters: ChapterBoundary[];
  totalCharCount: number;
  detectedPatterns: string[];
}

// ── 流式处理状态 ──────────────────────────────────────────────────────

interface StreamState {
  lineBuffer: string;          // 未完成行缓冲
  accumulatedLines: number;    // 已处理行数
  totalBytesProcessed: number; // 已处理字节数
  totalFileSize: number;       // 文件总大小（用于进度报告）
  chapterMatches: Array<{
    title: string;
    startOffset: number;
    lineEndOffset: number;
  }>;
  lastChapterEnd: number;      // 上一个章节的结束偏移
}

function createStreamState(totalFileSize: number): StreamState {
  return {
    lineBuffer: '',
    accumulatedLines: 0,
    totalBytesProcessed: 0,
    totalFileSize,
    chapterMatches: [],
    lastChapterEnd: 0,
  };
}

// ── 章节检测正则（与 chapter-detector.ts 保持一致，去掉了 \s* 前缀因为这里行已 trim） ──

const CHAPTER_LINE_PATTERNS = [
  /^(第[一二三四五六七八九十百千万\d]+章)[\s　]*/,
  /^(第[一二三四五六七八九十百千万\d]+[回节部分篇])[\s　]*/,
  /^(Volume|Chapter|Part|Section)\s+(\d+|[IVXLCDM]+)[.\s]*/i,
  /^(\d+)[.、．\s]\s*.+/,
  /^第[一二三四五六七八九十百千万]+章[\s　]*/,
  /^[-*＿_]{3,}$/,
];

/** 检测单行是否为章节标题 */
function isChapterLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  for (const pattern of CHAPTER_LINE_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

/** 需要自动跳过的章节标题 */
const AUTO_SKIP_TITLES = new Set([
  '目录', '版权', '前言', '序', '后记', '附录', '扉页', '序言',
]);

// ── 分块处理 ──────────────────────────────────────────────────────────

function processChunk(state: StreamState, text: string, _chunkOffset: number): void {
  const combined = state.lineBuffer + text;
  state.lineBuffer = '';

  // 缓冲行的起始偏移 = 上一个已处理块的末尾
  const bufferFileOffset = state.totalBytesProcessed;
  state.totalBytesProcessed += text.length;

  // 按行分割
  let searchStart = 0;
  const lines: Array<{ text: string; offset: number }> = [];

  while (searchStart < combined.length) {
    const newlineIdx = combined.indexOf('\n', searchStart);
    if (newlineIdx === -1) {
      // 没有换行符，剩余部分作为缓冲
      state.lineBuffer = combined.slice(searchStart);
      break;
    }
    // 行内容（不含 \n）
    const lineText = combined.slice(searchStart, newlineIdx);
    // 行在文件中的绝对偏移
    const lineOffset = bufferFileOffset + searchStart;

    lines.push({ text: lineText, offset: lineOffset });
    searchStart = newlineIdx + 1;
  }

  // 处理每一行
  for (const line of lines) {
    state.accumulatedLines++;
    if (isChapterLine(line.text)) {
      const title = line.text.trim();
      const lineEndOffset = line.offset + line.text.length + 1; // +1 for \n
      state.chapterMatches.push({
        title,
        startOffset: line.offset,
        lineEndOffset,
      });
    }
  }
}

/** 最终化：从章节匹配构建 ChapterBoundary[] */
function finalizeChapters(state: StreamState): ChapterBoundary[] {
  const matches = state.chapterMatches;

  if (matches.length < 2) return [];

  // 排序去重（按 startOffset）
  matches.sort((a, b) => a.startOffset - b.startOffset);
  const seen = new Set<number>();
  const unique = matches.filter((m) => {
    if (seen.has(m.startOffset)) return false;
    seen.add(m.startOffset);
    return true;
  });

  return unique.map((m, i) => {
    const contentEnd = i < unique.length - 1
      ? (unique[i + 1]?.startOffset ?? state.totalFileSize)
      : state.totalFileSize;
    return {
      title: m.title,
      startOffset: m.startOffset,
      lineEndOffset: m.lineEndOffset,
      charCount: contentEnd - m.lineEndOffset,
    };
  });
}

// ── 消息处理 ──────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;

  // ── 兼容旧模式：直接接收整个 rawText ──────────────────────────────
  if (msg.rawText !== undefined) {
    handleLegacyMode(msg.rawText, msg.divisionMode);
    return;
  }

  // ── 新模式：流式分块 ──────────────────────────────────────────────
  if (msg.type === 'init') {
    // 初始化：开始流式处理
    const state = createStreamState(msg.totalFileSize);
    (self as any).__streamState = state;
    self.postMessage({
      type: 'progress',
      data: { phase: 'start', message: '开始读取文件...' },
    });
    return;
  }

  if (msg.type === 'chunk') {
    const state = (self as any).__streamState as StreamState;
    if (!state) {
      self.postMessage({ type: 'error', data: { message: '未初始化流式状态' } });
      return;
    }

    const { text, offset, isLast } = msg.data;
    processChunk(state, text, offset);

    // 报告进度
    if (state.totalFileSize > 0) {
      const progress = Math.min(state.totalBytesProcessed / state.totalFileSize, 1);
      self.postMessage({
        type: 'progress',
        data: {
          phase: 'scanning',
          message: `正在扫描章节标题... ${Math.round(progress * 100)}%`,
          progress,
        },
      });
    }

    if (isLast) {
      // 处理最后缓冲的行
      if (state.lineBuffer.trim()) {
        const lastLine = state.lineBuffer.trim();
        if (isChapterLine(lastLine)) {
          state.chapterMatches.push({
            title: lastLine,
            startOffset: state.totalBytesProcessed - state.lineBuffer.length,
            lineEndOffset: state.totalFileSize,
          });
        }
      }

      // 构建结果
      const chapters = finalizeChapters(state);

      if (chapters.length >= 2) {
        // 检测到章节模式
        const autoSkipIndices = chapters
          .map((ch, idx) => ({ ch, idx }))
          .filter(({ ch }) => AUTO_SKIP_TITLES.has(ch.title))
          .map(({ idx }) => idx);

        self.postMessage({
          type: 'result',
          data: {
            type: 'chaptered',
            chapters,
            totalCharCount: state.totalFileSize,
            detectedPatterns: ['chapter_cn'],
            autoSkipIndices,
          },
        });
      } else {
        // 未检测到章节，回退到段落模式（小文件可以用 detectStructure）
        // 但从流式数据构建段落
        self.postMessage({
          type: 'result',
          data: {
            type: 'paragraph',
            chapters: [],
            totalCharCount: state.totalFileSize,
            detectedPatterns: [],
            autoSkipIndices: [],
          },
        });
      }

      delete (self as any).__streamState;
    }
    return;
  }
};

// ── 兼容旧模式 ───────────────────────────────────────────────────────

function handleLegacyMode(rawText: string, divisionMode: string): void {
  self.postMessage({
    type: 'progress',
    data: { phase: 'start', message: '开始检测章节结构...' },
  });

  try {
    const result = detectStructure(rawText, divisionMode as any);
    self.postMessage({ type: 'result', data: result });
  } catch (err) {
    self.postMessage({
      type: 'error',
      data: { message: err instanceof Error ? err.message : '检测失败' },
    });
  }
}