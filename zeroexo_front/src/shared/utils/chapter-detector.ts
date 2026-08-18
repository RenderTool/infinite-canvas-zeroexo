/**
 * 章节/段落检测器
 *
 * 纯浏览器端文本结构检测器，零 API 成本。
 * 用于检测文本中的章节结构和段落划分。
 */

/** 章节信息 */
export interface Chapter {
  index: number;
  title: string;
  content: string;
  charCount: number;
  autoSkip: boolean;
}

/** 段落信息 */
export interface Paragraph {
  index: number;
  content: string;
  charCount: number;
  autoSkip: boolean;
}

/** 段落分割模式 */
export type DivisionMode = 'empty_line' | 'char_count' | 'sentence';

/** 检测结果 */
export interface DetectResult {
  structure: 'chaptered' | 'paragraph' | 'mixed' | 'unknown';
  chapters: Chapter[];
  paragraphs: Paragraph[];
  detectedPatterns: string[];
  autoSkipIndices: number[];
}

// ============================================================
// 章节正则模式（6种，按优先级从高到低排列）
// ============================================================

interface ChapterPattern {
  pattern: RegExp;
  name: string;
}

const CHAPTER_PATTERNS: ChapterPattern[] = [
  // 模式1: 第X章 (中文) — 如 "第一章" "第一百二十三章"（含前导空格）
  { pattern: /^\s*(第[一二三四五六七八九十百千万\d]+章)[\s　]*/gm, name: 'chapter_cn' },
  // 模式2: 第X回/第X节/第X部分 — 如 "第一回" "第二节" "第三部分"（含前导空格）
  { pattern: /^\s*(第[一二三四五六七八九十百千万\d]+[回节部分篇])[\s　]*/gm, name: 'section_cn' },
  // 模式3: Volume X / Chapter X / Part X (英文)
  { pattern: /^\s*(Volume|Chapter|Part|Section)\s+(\d+|[IVXLCDM]+)[.\s]*/gim, name: 'volume_en' },
  // 模式4: 数字 + 章节标题 — 如 "1. " "1、" "1. 标题"（含前导空格）
  { pattern: /^\s*(\d+)[.、．\s]\s*.+/gm, name: 'number_dot' },
  // 模式5: 中文数字 + 章 — 如 "第一章" "第二章" 无空格版（含前导空格）
  { pattern: /^\s*第[一二三四五六七八九十百千万]+章[\s　]*/gm, name: 'cn_chapter_no_space' },
  // 模式6: 分割线 — 如 "---" "***" "＿＿＿＿"
  { pattern: /^\s*[-*＿_]{3,}\s*$/gm, name: 'divider' },
];

/** 需要自动跳过的章节标题 */
const AUTO_SKIP_TITLES = new Set([
  '目录', '版权', '前言', '序', '后记', '附录', '扉页', '序言',
]);

// ============================================================
// 内部类型
// ============================================================

/** 原始章节匹配结果 */
interface ChapterMatch {
  /** 匹配在文本中的起始位置 */
  index: number;
  /** 匹配所在行的完整内容（标题行） */
  title: string;
  /** 匹配行的结束位置（下一个 \n 的索引，或文本末尾） */
  lineEnd: number;
  /** 匹配到的模式名称 */
  patternName: string;
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 获取文本中指定位置所在行的完整内容（不含行尾换行符）
 */
function getLineAt(text: string, pos: number): string {
  const lineEnd = text.indexOf('\n', pos);
  if (lineEnd === -1) {
    return text.slice(pos).trimEnd();
  }
  return text.slice(pos, lineEnd).trimEnd();
}

/**
 * 获取文本中指定位置所在行的行尾（下一个 \n 的位置，或文本长度）
 */
function getLineEnd(text: string, pos: number): number {
  const idx = text.indexOf('\n', pos);
  return idx === -1 ? text.length : idx;
}

/**
 * 检测一段文本是否为独立标题（匹配任意章节模式）
 */
function isTitleLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // 对每行单独检测
  for (const cp of CHAPTER_PATTERNS) {
    // 去掉全局标志，用 test 逐行检测
    const regex = new RegExp(cp.pattern.source, cp.pattern.flags.replace('g', ''));
    if (regex.test(trimmed)) return true;
  }
  return false;
}

// ============================================================
// 核心逻辑
// ============================================================

/**
 * 在文本中查找所有章节匹配
 */
function findChapterMatches(rawText: string): ChapterMatch[] {
  const matches: ChapterMatch[] = [];
  const seenPositions = new Set<number>();

  for (const cp of CHAPTER_PATTERNS) {
    const regex = new RegExp(cp.pattern.source, cp.pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(rawText)) !== null) {
      const pos = match.index;

      // 跳过已匹配过的位置（高优先级模式优先）
      if (seenPositions.has(pos)) continue;
      seenPositions.add(pos);

      const title = getLineAt(rawText, pos);
      const lineEnd = getLineEnd(rawText, pos);

      matches.push({ index: pos, title, lineEnd, patternName: cp.name });
    }
  }

  // 按位置排序
  matches.sort((a, b) => a.index - b.index);

  return matches;
}

/**
 * 根据章节匹配结果构建章节列表
 */
function buildChapters(rawText: string, matches: ChapterMatch[]): Chapter[] {
  const chapters: Chapter[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    // 内容从标题行下一行开始
    const contentStart = match!.lineEnd + 1;
    // 内容结束于下一个章节标题的开始，或文本末尾
    const contentEnd = i < matches.length - 1 ? matches[i + 1]!.index : rawText.length;

    const content = rawText.slice(contentStart, contentEnd).trim();
    const charCount = content.length;

    // 检查标题是否在自动跳过列表中
    const titleTrimmed = match!.title.trim();
    const autoSkip = AUTO_SKIP_TITLES.has(titleTrimmed);

    chapters.push({
      index: i,
      title: match!.title,
      content,
      charCount,
      autoSkip,
    });
  }

  return chapters;
}

/**
 * 验证并合并章节
 * - 章节间内容 < 200 chars 且无独立标题 → 合并到上一章
 */
function validateChapters(chapters: Chapter[]): {
  validatedChapters: Chapter[];
  autoSkipIndices: number[];
} {
  if (chapters.length === 0) {
    return { validatedChapters: [], autoSkipIndices: [] };
  }

  const result: Chapter[] = [];
  let merged: Chapter | null = null;

  for (const chapter of chapters) {
    if (merged) {
      // 检查是否可以合并到上一章
      if (chapter.charCount < 200 && !isTitleLine(chapter.title)) {
        // 合并到 merged 章节
        merged = {
          ...(merged as Chapter),
          content: merged.content + '\n\n' + chapter.content,
          charCount: merged.charCount + chapter.charCount + 2,
          autoSkip: merged.autoSkip && chapter.autoSkip,
        };
        continue;
      } else {
        result.push(merged);
        merged = null;
      }
    }

    if (!merged) {
      merged = { ...chapter };
    }
  }

  // 处理最后一个章节
  if (merged) {
    result.push(merged);
  }

  // 重新编号
  const validatedChapters = result.map((ch, idx) => ({ ...ch, index: idx }));
  const autoSkipIndices = validatedChapters
    .filter((ch) => ch.autoSkip)
    .map((ch) => ch.index);

  return { validatedChapters, autoSkipIndices };
}

/**
 * 段落模式检测
 * - 按空行分割
 * - 过滤过短段落（charCount < 20 且不是独立标题）
 * - 保留空段落但标记为 autoSkip
 */
function detectParagraphs(rawText: string, divisionMode: DivisionMode = 'empty_line'): Paragraph[] {
  if (divisionMode === 'empty_line') {
    // 按空行分割（多个连续空行算一个分隔符）
    const segments = rawText.split(/\n\s*\n/);
    const paragraphs: Paragraph[] = [];

    for (let i = 0; i < segments.length; i++) {
      const content = (segments[i] ?? '').trim();
      const charCount = content.length;
      let autoSkip = false;

      if (charCount === 0) {
        // 空段落 → 标记为跳过
        autoSkip = true;
      } else if (charCount < 20 && !isTitleLine(content)) {
        // 过短且不是独立标题 → 标记为跳过
        autoSkip = true;
      }

      paragraphs.push({
        index: i,
        content,
        charCount,
        autoSkip,
      });
    }

    return paragraphs;
  }

  // 非 empty_line 模式：先获取 segments，再构建段落
  const segments: string[] = [];

  if (divisionMode === 'char_count') {
    // 按字符数分割（默认 500 字符一段）
    const CHUNK_SIZE = 500;
    for (let i = 0; i < rawText.length; i += CHUNK_SIZE) {
      // 尝试在 chunk 边界附近的句子边界处断开
      let end = Math.min(i + CHUNK_SIZE, rawText.length);
      if (end < rawText.length) {
        const lookahead = rawText.slice(end, end + 100);
        const sentenceEnd = lookahead.search(/[。！？\n.!?]/);
        if (sentenceEnd > 0) {
          end += sentenceEnd + 1;
        }
      }
      segments.push(rawText.slice(i, end).trim());
    }
  } else {
    // sentence 模式：按句号分割（。！？.!?）
    segments.push(...rawText.split(/(?<=[。！？.!?])\s*/).filter(s => s.trim()));
  }

  const paragraphs: Paragraph[] = [];
  for (let i = 0; i < segments.length; i++) {
    const content = (segments[i] ?? '').trim();
    const charCount = content.length;
    let autoSkip = false;

    if (charCount === 0) {
      autoSkip = true;
    } else if (charCount < 20 && !isTitleLine(content)) {
      autoSkip = true;
    }

    paragraphs.push({
      index: i,
      content,
      charCount,
      autoSkip,
    });
  }

  return paragraphs;
}

// ============================================================
// 导出主函数
// ============================================================

/**
 * 检测文本结构（章节/段落）
 *
 * 算法概述：
 * 1. 尝试使用 6 种章节正则模式匹配章节标题
 * 2. 匹配 ≥2 个有效章节 → 返回 'chaptered' 结构
 * 3. 匹配 1 个或 0 个 → 返回 'paragraph' 结构（按空行分割段落）
 * 4. 空文本 → 返回 'unknown' 结构
 */
export function detectStructure(rawText: string, divisionMode: DivisionMode = 'empty_line'): DetectResult {
  // 空文本处理
  if (!rawText || rawText.trim().length === 0) {
    return {
      structure: 'unknown',
      chapters: [],
      paragraphs: [],
      detectedPatterns: [],
      autoSkipIndices: [],
    };
  }

  // 查找章节匹配
  const matches = findChapterMatches(rawText);

  // 收集实际匹配到的模式名称（去重）
  const patternNameSet = new Set<string>();
  for (const m of matches) {
    patternNameSet.add(m.patternName);
  }
  const detectedPatterns = Array.from(patternNameSet);

  if (matches.length >= 2) {
    // 构建章节
    const chapters = buildChapters(rawText, matches);
    // 验证和合并
    const { validatedChapters, autoSkipIndices } = validateChapters(chapters);

    return {
      structure: 'chaptered',
      chapters: validatedChapters,
      paragraphs: [],
      detectedPatterns,
      autoSkipIndices,
    };
  }

  // 段落模式（1 个或 0 个匹配）
  const paragraphs = detectParagraphs(rawText, divisionMode);
  const autoSkipIndices = paragraphs
    .filter((p) => p.autoSkip)
    .map((p) => p.index);

  return {
    structure: 'paragraph',
    chapters: [],
    paragraphs,
    detectedPatterns,
    autoSkipIndices,
  };
}