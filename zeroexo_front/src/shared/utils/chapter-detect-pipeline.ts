/**
 * chapter-detect-pipeline - 共享章节检测管线（流式版）
 *
 * 封装章节检测 → 用户选择 → 命名 → 保存 zeroexo-text 到资产库的完整流程。
 * 对大文件（>1MB）使用流式 Web Worker 后台处理，避免 UI 阻塞。
 * 仅返回章节边界（标题+偏移量，不含内容），大幅降低内存占用。
 *
 * Task 15/21/24 统一调用此管线。
 */
import { message } from 'antd';
import { buildZeroexoText, buildZeroexoTextFromFile, type ZeroexoText } from './zeroexo-builder';
import { getToken } from '@/services/api-client';
import i18n from '@/i18n/config';

export interface PipelineResult {
  assetId: string;
  filename: string;
  zeroexoText: ZeroexoText;
}

export interface PipelineOptions {
  /** 弹窗容器（默认 document.body） */
  getPopupContainer?: () => HTMLElement;
  /** 是否允许跳过命名（默认 false，强制命名） */
  allowSkipName?: boolean;
  /** 段落分割模式（默认 'empty_line'） */
  divisionMode?: 'empty_line' | 'char_count' | 'sentence';
  /** 进度回调（0-100），不传则使用 message.loading 冒泡提示 */
  onProgress?: (percent: number, message: string) => void;
}

// ── 章节边界信息（不含完整内容，用于大文件） ──────────────────────────

export interface ChapterBoundaryInfo {
  index: number;
  title: string;
  charCount: number;
  autoSkip: boolean;
  /** 章节内容在文件中的起始偏移（标题行之后） */
  contentStart: number;
  /** 章节内容在文件中的结束偏移（下一个章节标题之前） */
  contentEnd: number;
}

/** 检测结果（兼容大文件边界模式和小文件全文模式） */
export interface DetectResult {
  structure: 'chaptered' | 'paragraph' | 'mixed' | 'unknown';
  chapters: ChapterBoundaryInfo[];
  paragraphs: Array<{ index: number; content: string; charCount: number; autoSkip: boolean }>;
  detectedPatterns: string[];
  autoSkipIndices: number[];
}

// ── 流式读取参数 ──────────────────────────────────────────────────────

const STREAM_CHUNK_SIZE = 256 * 1024; // 256KB 分块
const LARGE_FILE_THRESHOLD = 1024 * 1024; // 1MB 以上使用流式

/**
 * 智能读取文本文件:严格 UTF-8 优先,失败回落 GB18030(经验 #31,禁止裸 readAsText)。
 * 用于小文件全文读取。
 */
async function readTextWithEncodingDetect(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    // 严格 UTF-8:非法字节序列会抛错,据此判定非 UTF-8 文件
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // GB18030 是 GBK/GB2312 超集,兼容 Windows 中文 txt 常见编码
    return new TextDecoder('gb18030').decode(buf);
  }
}

/**
 * 探测大文件流式读取的编码:读头部 256KB 做严格 UTF-8 判定,失败回落 GB18030。
 * 流式解码全程使用同一编码器,保证块边界多字节字符不被切碎。
 */
async function detectStreamEncoding(file: File): Promise<'utf-8' | 'gb18030'> {
  const head = await file.slice(0, STREAM_CHUNK_SIZE).arrayBuffer();
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head);
    return 'utf-8';
  } catch {
    return 'gb18030';
  }
}

/**
 * 执行章节检测管线
 *
 * 流程：
 * 1. 流式读取文件 → 分块发送给 Worker 检测章节边界
 * 2. 展示章节/段落选择弹窗 → 用户确认选中索引
 * 3. 从 File 对象按需读取选中章节内容，构建 zeroexo-text
 * 4. 展示命名弹窗 → 用户输入名称
 * 5. 上传到后端 → 返回 assetId + filename
 */
export async function chapterDetectPipeline(
  file: File,
  options?: PipelineOptions,
): Promise<PipelineResult | null> {
  const { getPopupContainer, allowSkipName, divisionMode = 'empty_line', onProgress } = options ?? {};

  const isLargeFile = file.size > LARGE_FILE_THRESHOLD;

  // ── 1. 检测章节/段落结构 ──────────────────────────────────────────
  let detectResult: DetectResult;

  // 无 onProgress 回调时，使用 message.loading 简单提示（不频繁更新以避免冒泡）
  const loadingMsg = !onProgress ? message.loading(i18n.t('chapterDetect.processingFile'), 0) : null;

  if (isLargeFile) {
    // 大文件：流式处理
    onProgress?.(0, i18n.t('chapterDetect.scanningStructure'));
    try {
      detectResult = await streamDetectChapters(file, divisionMode, (progressMsg, progressVal) => {
        onProgress?.(progressVal, progressMsg);
      });
    } catch (e) {
      loadingMsg?.();
      throw e;
    }
  } else {
    // 小文件：直接读取全文(编码探测,经验 #31)
    onProgress?.(5, i18n.t('chapterDetect.readingFile'));
    let rawText: string;
    try {
      rawText = await readTextWithEncodingDetect(file);
    } catch (e) {
      loadingMsg?.();
      throw e;
    }

    if (!rawText.trim()) {
      loadingMsg?.();
      throw new Error(i18n.t('chapterDetect.fileEmpty'));
    }

    onProgress?.(50, i18n.t('chapterDetect.detectingStructure'));
    try {
      const { detectStructure } = await import('./chapter-detector');
      const result = detectStructure(rawText, divisionMode);

      // 转换为统一格式
      if (result.structure === 'chaptered' || result.structure === 'mixed') {
        detectResult = {
          structure: result.structure,
          chapters: result.chapters.map((ch) => ({
            index: ch.index,
            title: ch.title,
            charCount: ch.charCount,
            autoSkip: ch.autoSkip,
            contentStart: 0,
            contentEnd: 0,
          })),
          paragraphs: [],
          detectedPatterns: result.detectedPatterns,
          autoSkipIndices: result.autoSkipIndices,
        };
      } else {
        detectResult = {
          structure: 'paragraph',
          chapters: [],
          paragraphs: result.paragraphs.map((p) => ({
            index: p.index,
            content: p.content,
            charCount: p.charCount,
            autoSkip: p.autoSkip,
          })),
          detectedPatterns: result.detectedPatterns,
          autoSkipIndices: result.autoSkipIndices,
        };
      }
    } catch (e) {
      throw e;
    }
  }

  // 关闭 message.loading（检测阶段已完成）
  loadingMsg?.();

  if (detectResult.structure === 'unknown') {
    throw new Error(i18n.t('chapterDetect.cannotDetectStructure'));
  }

  // ── 2. 展示章节/段落选择弹窗 ──────────────────────────────────────
  const selectedIndices = await showChapterSelectorModal(
    file.name,
    detectResult,
    getPopupContainer,
    divisionMode,
    isLargeFile ? file : null,
  );
  if (!selectedIndices) return null; // 用户取消

  // ── 3. 构建 zeroexo-text ─────────────────────────────────────────
  let zeroexoText: ZeroexoText;
  if (isLargeFile && detectResult.structure === 'chaptered') {
    zeroexoText = await buildZeroexoTextFromFile(
      file,
      detectResult.chapters,
      selectedIndices,
      file.name,
      detectResult.detectedPatterns,
    );
  } else {
    // 小文件：重新读取全文构建（段落模式也走此路径）
    const rawText = await readTextWithEncodingDetect(file);
    const { detectStructure } = await import('./chapter-detector');
    const fullResult = detectStructure(rawText, divisionMode);
    zeroexoText = buildZeroexoText(rawText, fullResult, selectedIndices, file.name);
  }

  // ── 4. 命名弹窗 ──────────────────────────────────────────────────
  let name = file.name.replace(/\.[^/.]+$/, '');
  if (!allowSkipName) {
    const named = await showNamingModal(name, getPopupContainer);
    if (!named) return null; // 用户取消
    name = named;
  }

  // 将用户命名写入 metadata.name
  zeroexoText.metadata.name = name;

  // ── 5. 上传到后端 ────────────────────────────────────────────────
  const assetId = await uploadZeroexoText(zeroexoText, name);

  // 静默提示保存成功
  message.success(i18n.t('chapterDetect.savedToSourceClassification'));

  return { assetId, filename: name, zeroexoText };
}

// ─── 流式章节检测 ─────────────────────────────────────────────────────

/**
 * 流式读取文件，分块发送给 Worker 进行章节检测
 */
async function streamDetectChapters(
  file: File,
  divisionMode: 'empty_line' | 'char_count' | 'sentence',
  onProgress?: (msg: string, percent: number) => void,
): Promise<DetectResult> {
  const worker = new Worker(
    new URL('./chapter-detector.worker.ts', import.meta.url),
    { type: 'module' },
  );

  try {
    // 先探测编码(GBK 文件按 UTF-8 分块解码会全篇乱码,经验 #31),再建立 Worker 流式链路
    const encoding = await detectStreamEncoding(file);

    return await new Promise<DetectResult>((resolve, reject) => {
      let resolved = false;

      worker.onmessage = (e: MessageEvent) => {
        const { type, data } = e.data;

        if (type === 'progress') {
          onProgress?.(data.message ?? i18n.t('chapterDetect.processing'), Math.round((data.progress ?? 0) * 100));
        } else if (type === 'result') {
          if (resolved) return;
          resolved = true;
          worker.terminate();

          if (data.type === 'chaptered' && data.chapters?.length > 0) {
            const autoSkipIndices = data.autoSkipIndices ?? [];
            resolve({
              structure: 'chaptered',
              chapters: data.chapters.map((ch: any, idx: number) => ({
                index: idx,
                title: ch.title,
                charCount: ch.charCount,
                autoSkip: autoSkipIndices.includes(idx),
                contentStart: ch.lineEndOffset,
                contentEnd: ch.lineEndOffset + ch.charCount,
              })),
              paragraphs: [],
              detectedPatterns: data.detectedPatterns ?? ['chapter_cn'],
              autoSkipIndices,
            });
          } else {
            // 未检测到章节，使用段落模式
            resolve({
              structure: 'paragraph',
              chapters: [],
              paragraphs: [],
              detectedPatterns: [],
              autoSkipIndices: [],
            });
          }
        } else if (type === 'error') {
          if (resolved) return;
          resolved = true;
          worker.terminate();
          reject(new Error(data.message));
        }
      };

      worker.onerror = (err) => {
        if (resolved) return;
        resolved = true;
        worker.terminate();
        reject(new Error(err.message));
      };

      // 初始化 Worker
      worker.postMessage({ type: 'init', totalFileSize: file.size });

      // 分块读取文件并发送给 Worker
      streamFileToWorker(file, worker, encoding);
    });
  } catch {
    // Worker 失败时回退到主线程（小文件模式）
    worker.terminate();
    const rawText = await readTextWithEncodingDetect(file);
    const { detectStructure } = await import('./chapter-detector');
    const result = detectStructure(rawText, divisionMode);
    return {
      structure: result.structure,
      chapters: result.chapters.map((ch) => ({
        index: ch.index,
        title: ch.title,
        charCount: ch.charCount,
        autoSkip: ch.autoSkip,
        contentStart: 0,
        contentEnd: 0,
      })),
      paragraphs: result.paragraphs.map((p) => ({
        index: p.index,
        content: p.content,
        charCount: p.charCount,
        autoSkip: p.autoSkip,
      })),
      detectedPatterns: result.detectedPatterns,
      autoSkipIndices: result.autoSkipIndices,
    };
  }
}

/**
 * 分块读取文件并发送给 Worker
 * 使用 TextDecoder 连续解码(stream:true)保持跨块状态,避免块边界切碎多字节字符产生乱码;
 * 最后 flush 解码器残留字节,与最后一块合并发送,保持 isLast 语义唯一。
 */
async function streamFileToWorker(
  file: File,
  worker: Worker,
  encoding: 'utf-8' | 'gb18030',
): Promise<void> {
  const totalSize = file.size;
  let offset = 0;
  const decoder = new TextDecoder(encoding, { stream: true } as TextDecoderOptions);

  while (offset < totalSize) {
    const end = Math.min(offset + STREAM_CHUNK_SIZE, totalSize);
    const buf = await file.slice(offset, end).arrayBuffer();
    const text = decoder.decode(buf, { stream: true });
    const physicallyLast = end >= totalSize;

    if (physicallyLast) {
      // 最后一块:先 flush 解码器残留,拼接后一次性发送(保证 isLast 只发一次)
      const tail = decoder.decode();
      worker.postMessage({
        type: 'chunk',
        data: { text: text + tail, offset, isLast: true },
      });
      offset = end;
      break;
    }

    worker.postMessage({
      type: 'chunk',
      data: { text, offset, isLast: false },
    });

    offset = end;

    // 让出主线程，避免 UI 卡顿
    await new Promise((r) => setTimeout(r, 0));
  }
}

// ─── 内部弹窗函数（动态导入，避免直接引用导致循环依赖） ──────────────

async function showChapterSelectorModal(
  fileName: string,
  detectResult: DetectResult,
  getPopupContainer?: () => HTMLElement,
  divisionMode: 'empty_line' | 'char_count' | 'sentence' = 'empty_line',
  file: File | null = null,
): Promise<number[] | null> {
  const { ChapterSelectorModal } = await import(
    '@/features/source-material/chapter-selector-modal'
  );
  const { ParagraphSelectorModal } = await import(
    '@/features/source-material/paragraph-selector-modal'
  );
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');

  // 段落模式：需要全文 content，编码探测读取（经验 #31）
  if (detectResult.structure === 'paragraph' && file) {
    const rawText = await readTextWithEncodingDetect(file);
    const { detectStructure } = await import('./chapter-detector');
    const newResult = detectStructure(rawText, divisionMode);

    return new Promise((resolve) => {
      const container = document.createElement('div');
      (getPopupContainer?.() ?? document.body).appendChild(container);
      const root = createRoot(container);

      const cleanup = () => {
        root.unmount();
        container.remove();
      };

      const handleConfirm = (selectedIndices: number[], _processingMode: 'per_paragraph' | 'merge_all') => {
        cleanup();
        // 段落模式始终返回所有选中索引
        resolve(selectedIndices);
      };

      const handleCancel = () => {
        cleanup();
        resolve(null);
      };

      const ModalWrapper: React.FC = () => {
        const [currentMode, setCurrentMode] = React.useState(divisionMode);
        const [currentResult, setCurrentResult] = React.useState(newResult);

        const handleDivisionModeChange = async (mode: 'empty_line' | 'char_count' | 'sentence') => {
          setCurrentMode(mode);
          const { detectStructure } = await import('./chapter-detector');
          const result = detectStructure(rawText, mode);
          setCurrentResult(result);
        };

        return React.createElement(ParagraphSelectorModal, {
          open: true,
          fileName,
          paragraphs: currentResult.paragraphs.map((p) => ({
            index: p.index,
            content: p.content,
            charCount: p.charCount,
            autoSkip: currentResult.autoSkipIndices.includes(p.index),
          })),
          autoSkipIndices: currentResult.autoSkipIndices,
          divisionMode: currentMode,
          onDivisionModeChange: handleDivisionModeChange,
          onConfirm: handleConfirm,
          onCancel: handleCancel,
        });
      };

      root.render(React.createElement(ModalWrapper));
    });
  }

  // 章节模式：使用 ChapterBoundaryInfo（无 content）
  if (detectResult.structure === 'chaptered' || detectResult.structure === 'mixed') {
    return new Promise((resolve) => {
      const container = document.createElement('div');
      (getPopupContainer?.() ?? document.body).appendChild(container);
      const root = createRoot(container);

      const cleanup = () => {
        root.unmount();
        container.remove();
      };

      const handleConfirm = (selectedIndices: number[]) => {
        cleanup();
        resolve(selectedIndices);
      };

      const handleCancel = () => {
        cleanup();
        resolve(null);
      };

      const ModalWrapper: React.FC = () => {
        return React.createElement(ChapterSelectorModal, {
          open: true,
          fileName,
          chapters: detectResult.chapters.map((ch) => ({
            index: ch.index,
            title: ch.title,
            charCount: ch.charCount,
            autoSkip: ch.autoSkip,
          })),
          autoSkipIndices: detectResult.autoSkipIndices,
          onConfirm: handleConfirm,
          onCancel: handleCancel,
        });
      };

      root.render(React.createElement(ModalWrapper));
    });
  }

  return null;
}

async function showNamingModal(
  defaultName: string,
  getPopupContainer?: () => HTMLElement,
): Promise<string | null> {
  const { Modal, Input } = await import('antd');
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');

  return new Promise((resolve) => {
    const container = document.createElement('div');
    (getPopupContainer?.() ?? document.body).appendChild(container);
    const root = createRoot(container);
    let inputValue = defaultName;

    const cleanup = () => {
      root.unmount();
      container.remove();
    };

    Modal.confirm({
      title: i18n.t('chapterDetect.namingTitle'),
      content: React.createElement(Input, {
        defaultValue: defaultName,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
          inputValue = e.target.value;
        },
        maxLength: 100,
        style: { marginTop: 8 },
      }),
      okText: i18n.t('chapterDetect.confirm'),
      cancelText: i18n.t('chapterDetect.cancel'),
      centered: true,
      getContainer: getPopupContainer ? getPopupContainer() : undefined,
      onOk: () => {
        const name = inputValue.trim() || defaultName;
        cleanup();
        resolve(name);
      },
      onCancel: () => {
        cleanup();
        resolve(null);
      },
    });
  });
}

async function uploadZeroexoText(
  zeroexoText: ZeroexoText,
  name: string,
): Promise<string> {
  const token = getToken();
  if (!token) {
    throw new Error('未登录');
  }

  const response = await fetch('/api/resources/zeroexo', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      kind: 'zeroexo-text',
      filename: `${name}.zeroexo`,
      text: JSON.stringify(zeroexoText),
      size: new TextEncoder().encode(JSON.stringify(zeroexoText)).length,
      mimeType: 'application/zeroexo+json',
      tags: [],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`保存失败: ${response.status} ${errorBody}`);
  }

  const data = await response.json();
  return data.id;
}