/**
 * zeroexo-builder - .zeroexo 产物构建器
 *
 * 从文本检测结果和用户选中索引构建标准化的 .zeroexo 数据。
 */

import type { ZeroexoContainer } from './zeroexo-types';import type { DetectResult, Chapter, Paragraph } from './chapter-detector';

// ─── 类型定义 ───────────────────────────────────────────────────────

export interface ZeroexoText extends ZeroexoContainer {
  format: 'zeroexo-text';
  source: {
    fileName: string;
    originalCharCount: number;
    uploadedAt: number;
    processedAt: number;
  };
  processingHistory: {
    totalUnits: number;
    selectedCount: number;
    autoSkippedCount: number;
    autoSkippedTitles: string[];
    discardedCharCount: number;
  };
  data: {
    type: 'chaptered' | 'paragraph' | 'mixed' | 'unknown';
    units: ZeroexoTextUnit[];
  };
}

export interface ZeroexoTextUnit {
  index: number;
  title: string;
  content: string;
  charCount: number;
  originalIndex: number | null;
  markerType: 'chapter' | 'volume' | 'part' | 'section' | 'paragraph' | 'unknown';
}

// ─── 构建函数 ───────────────────────────────────────────────────────

export function buildZeroexoText(
  rawText: string,
  detectResult: DetectResult,
  selectedIndices: number[],
  sourceFileName: string,
): ZeroexoText {
  const now = Date.now();
  const fileNameWithoutExt = sourceFileName.replace(/\.[^/.]+$/, '');
  const selectedSet = new Set(selectedIndices);

  // ── 未知结构处理 ──────────────────────────────────────────────────
  if (detectResult.structure === 'unknown') {
    return {
      format: 'zeroexo-text',
      version: '1.0' as const,
      path: `/zeroexo/novels/${fileNameWithoutExt}`,
      metadata: {
        name: fileNameWithoutExt,
        tags: [],
        createdAt: now,
        updatedAt: now,
      },
      dependencies: [],
      referencedBy: [],
      source: {
        fileName: sourceFileName,
        originalCharCount: rawText.length,
        uploadedAt: now,
        processedAt: now,
      },
      processingHistory: {
        totalUnits: 0,
        selectedCount: 0,
        autoSkippedCount: 0,
        autoSkippedTitles: [],
        discardedCharCount: 0,
      },
      data: {
        type: 'unknown',
        units: [],
      },
    };
  }

  // ── 确定数据来源（章节模式 / 段落模式）────────────────────────────
  const isChaptered = detectResult.structure === 'chaptered' || detectResult.structure === 'mixed';
  const sourceUnits: (Chapter | Paragraph)[] = isChaptered
    ? detectResult.chapters
    : detectResult.paragraphs;

  // 预计算 markerType（章节模式下从 detectedPatterns 推断）
  const inferredMarkerType = isChaptered
    ? inferMarkerTypeFromPatterns(detectResult.detectedPatterns)
    : 'paragraph' as const;

  // ── 构建输出 units（只包含选中的单元，重新 1-based 编号）───────────
  const outputUnits: ZeroexoTextUnit[] = [];
  let nextIndex = 1;

  for (const unit of sourceUnits) {
    if (!selectedSet.has(unit.index)) continue;

    outputUnits.push({
      index: nextIndex++,
      title: isChaptered ? (unit as Chapter).title : `#${unit.index}`,
      content: unit.content,
      charCount: unit.charCount,
      originalIndex: unit.index,
      markerType: inferredMarkerType,
    });
  }

  // ── processingHistory 统计 ────────────────────────────────────────
  let autoSkippedCount = 0;
  const autoSkippedTitles: string[] = [];
  let discardedCharCount = 0;

  for (const unit of sourceUnits) {
    if (unit.autoSkip && !selectedSet.has(unit.index)) {
      autoSkippedCount++;
      autoSkippedTitles.push(
        isChaptered ? (unit as Chapter).title : `#${unit.index}`,
      );
    }
    if (!selectedSet.has(unit.index)) {
      discardedCharCount += unit.charCount;
    }
  }

  // ── data.type ────────────────────────────────────────────────────
  const dataType = detectResult.structure === 'chaptered'
    ? 'chaptered' as const
    : detectResult.structure === 'paragraph'
      ? 'paragraph' as const
      : 'mixed' as const;

  return {
    format: 'zeroexo-text',
    version: '1.0' as const,
    path: `/zeroexo/novels/${fileNameWithoutExt}`,
    metadata: {
      name: fileNameWithoutExt,
      tags: [],
      createdAt: now,
      updatedAt: now,
    },
    dependencies: [],
    referencedBy: [],
    source: {
      fileName: sourceFileName,
      originalCharCount: rawText.length,
      uploadedAt: now,
      processedAt: now,
    },
    processingHistory: {
      totalUnits: sourceUnits.length,
      selectedCount: outputUnits.length,
      autoSkippedCount,
      autoSkippedTitles,
      discardedCharCount,
    },
    data: {
      type: dataType,
      units: outputUnits,
    },
  };
}

// ─── 从 File 对象构建（大文件用，按需读取选中章节内容） ────────────────

/**
 * 从 File 对象按需读取选中章节内容，构建 ZeroexoText。
 *
 * @param file         源文件
 * @param chapterInfos 章节边界信息（含 contentStart/contentEnd）
 * @param selectedIndices 用户选中的章节索引
 * @param sourceFileName 源文件名
 * @param detectedPatterns 检测到的模式
 */
export async function buildZeroexoTextFromFile(
  file: File,
  chapterInfos: Array<{
    index: number;
    title: string;
    charCount: number;
    autoSkip: boolean;
    contentStart: number;
    contentEnd: number;
  }>,
  selectedIndices: number[],
  sourceFileName: string,
  detectedPatterns: string[],
): Promise<ZeroexoText> {
  const now = Date.now();
  const fileNameWithoutExt = sourceFileName.replace(/\.[^/.]+$/, '');
  const selectedSet = new Set(selectedIndices);

  // 按需读取选中章节的内容
  const outputUnits: ZeroexoTextUnit[] = [];
  let nextIndex = 1;

  for (const ch of chapterInfos) {
    if (!selectedSet.has(ch.index)) continue;

    // 从 File 读取此章节内容（使用 contentStart/contentEnd）
    let content = '';
    if (ch.contentEnd > ch.contentStart) {
      const blob = file.slice(ch.contentStart, ch.contentEnd);
      content = await blob.text();
    }

    outputUnits.push({
      index: nextIndex++,
      title: ch.title,
      content: content.trim(),
      charCount: ch.charCount,
      originalIndex: ch.index,
      markerType: inferMarkerTypeFromPatterns(detectedPatterns),
    });
  }

  // 统计
  let autoSkippedCount = 0;
  const autoSkippedTitles: string[] = [];
  let discardedCharCount = 0;

  for (const ch of chapterInfos) {
    if (ch.autoSkip && !selectedSet.has(ch.index)) {
      autoSkippedCount++;
      autoSkippedTitles.push(ch.title);
    }
    if (!selectedSet.has(ch.index)) {
      discardedCharCount += ch.charCount;
    }
  }

  return {
    format: 'zeroexo-text',
    version: '1.0' as const,
    path: `/zeroexo/novels/${fileNameWithoutExt}`,
    metadata: {
      name: fileNameWithoutExt,
      tags: [],
      createdAt: now,
      updatedAt: now,
    },
    dependencies: [],
    referencedBy: [],
    source: {
      fileName: sourceFileName,
      originalCharCount: file.size,
      uploadedAt: now,
      processedAt: now,
    },
    processingHistory: {
      totalUnits: chapterInfos.length,
      selectedCount: outputUnits.length,
      autoSkippedCount,
      autoSkippedTitles,
      discardedCharCount,
    },
    data: {
      type: 'chaptered',
      units: outputUnits,
    },
  };
}

// ─── 辅助函数 ───────────────────────────────────────────────────────

/**
 * 从 detectedPatterns 推断章节的 markerType。
 *
 * 映射规则（按优先级）：
 *   chapter_cn / cn_chapter_no_space  → 'chapter'
 *   section_cn                        → 'section'
 *   volume_en (Volume)                → 'volume'
 *   volume_en (Chapter/Part/Section)  → 'chapter' / 'part' / 'section'
 *   number_dot                        → 'section'
 *   divider                           → 'unknown'
 *   无匹配                             → 'unknown'
 */
function inferMarkerTypeFromPatterns(
  detectedPatterns: string[],
): ZeroexoTextUnit['markerType'] {
  const patternMap: Record<string, ZeroexoTextUnit['markerType']> = {
    chapter_cn: 'chapter',
    cn_chapter_no_space: 'chapter',
    section_cn: 'section',
    volume_en: 'chapter',
    number_dot: 'section',
    divider: 'unknown',
  };

  for (const pattern of detectedPatterns) {
    const mapped = patternMap[pattern];
    if (mapped && mapped !== 'unknown') return mapped;
  }

  return 'unknown';
}