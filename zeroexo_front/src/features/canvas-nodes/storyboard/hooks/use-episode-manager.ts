/**
 * use-episode-manager.ts - 剧集管理 Hook（Phase 5）
 *
 * 提供：
 *  - 分页算法 calculatePageCount（1 页 ≈ 1 分钟，LINES_PER_PAGE = 55）
 *  - 时长估算 estimateScreenTime
 *  - 剧集 CRUD / 复制 / 拆分 / 合并 / 排序
 */
import { useCallback, useMemo } from 'react';
import type { Episode, EpisodeStatus } from '../script-types.js';

/** 每页行数（行业标准，Courier 12pt） */
export const LINES_PER_PAGE = 55;
/** 每行字符数（Courier 12pt 约 55 字符/行） */
export const CHARS_PER_LINE = 55;
/** 对白行更短，缩进后约 35 字符 */
const DIALOGUE_CHARS_PER_LINE = 35;

/** 拆分后的单页内容 */
export interface ScriptContentPage {
  pageNumber: number;
  /** 该页 HTML 片段（不含分页标记本身） */
  html: string;
  /** 该页折算行数 */
  lines: number;
}

/** 计算单块文本折算行数（空文本视为 1 个空行） */
function lineCountForText(text: string, charsPerLine: number): number {
  const len = text.trim().length;
  if (len === 0) return 1;
  return Math.ceil(len / charsPerLine);
}

/** 单个 HTML 块折算行数（按好莱坞格式块类型） */
function blockLineCount(el: HTMLElement): number {
  const cls = el.className || '';
  const text = el.textContent ?? '';
  if (cls.includes('script-page-break')) {
    return 0; // 手动分页标记不计行数
  }
  if (cls.includes('script-scene-heading')) {
    return lineCountForText(text, CHARS_PER_LINE) + 1; // 标题 + 空行
  }
  if (cls.includes('script-character') || cls.includes('script-parenthetical')) {
    return 1; // 角色名 / 括号指示各占一行
  }
  if (cls.includes('script-dialogue')) {
    return lineCountForText(text, DIALOGUE_CHARS_PER_LINE);
  }
  if (cls.includes('script-transition')) {
    return lineCountForText(text, CHARS_PER_LINE) + 1; // 转场 + 空行
  }
  if (el.tagName === 'UL' || el.tagName === 'OL') {
    const items = Array.from(el.querySelectorAll('li'));
    return items.reduce((acc, li) => acc + lineCountForText(li.textContent ?? '', CHARS_PER_LINE), 0);
  }
  if (el.tagName === 'H1' || el.tagName === 'H2' || el.tagName === 'H3') {
    return lineCountForText(text, CHARS_PER_LINE) + 1;
  }
  // 普通段落 / 动作描述 / 其余块：内容 + 块间空行
  return lineCountForText(text, CHARS_PER_LINE) + 1;
}

/** HTML 转义（纯文本分页时使用） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 纯文本内容分页（每页 CHARS_PER_LINE × LINES_PER_PAGE 字符，按行包裹 <p>） */
function splitPlainTextIntoPages(text: string): ScriptContentPage[] {
  const perPageChars = CHARS_PER_LINE * LINES_PER_PAGE;
  if (text.trim().length === 0) return [{ pageNumber: 1, html: '', lines: 1 }];
  const pages: ScriptContentPage[] = [];
  let pageNumber = 1;
  for (let i = 0; i < text.length; i += perPageChars) {
    const chunk = text.slice(i, i + perPageChars);
    const html = chunk
      .split('\n')
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join('');
    pages.push({
      pageNumber: pageNumber++,
      html,
      lines: Math.ceil(chunk.length / CHARS_PER_LINE),
    });
  }
  return pages;
}

/**
 * 将剧集 HTML 内容按页拆分（分集与分页关系映射核心）：
 * 1. 遇到 .script-page-break 手动分页标记 → 强制换页
 * 2. 自然累计行数超过 LINES_PER_PAGE → 换页
 * 3. 返回每页 HTML 片段（不含分页标记本身）
 */
export function splitContentIntoPages(contentHtml: string): ScriptContentPage[] {
  if (!contentHtml) return [];
  const doc = new DOMParser().parseFromString(contentHtml, 'text/html');
  const blocks = Array.from(doc.body.children) as HTMLElement[];
  if (blocks.length === 0) {
    // 纯文本：按字符数均匀分页
    return splitPlainTextIntoPages(doc.body.textContent ?? '');
  }
  const pages: ScriptContentPage[] = [];
  let currentHtml: string[] = [];
  let currentLines = 0;
  let pageNumber = 1;
  const flush = () => {
    pages.push({
      pageNumber: pageNumber++,
      html: currentHtml.join(''),
      lines: currentLines,
    });
    currentHtml = [];
    currentLines = 0;
  };
  for (const el of blocks) {
    const cls = el.className || '';
    if (cls.includes('script-page-break')) {
      if (currentHtml.length > 0) flush(); // 手动分页：强制换页
      continue;
    }
    const lines = blockLineCount(el);
    if (currentLines > 0 && currentLines + lines > LINES_PER_PAGE) {
      flush();
    }
    currentHtml.push(el.outerHTML);
    currentLines += lines;
  }
  if (currentHtml.length > 0) flush();
  return pages.length > 0
    ? pages
    : [{ pageNumber: 1, html: contentHtml, lines: 1 }];
}

/**
 * 分页算法：
 * 实际页数 = 内容拆分出的页数（含手动分页标记），并与遗留的 pageBreaks 索引数组取大
 */
export function calculatePageCount(contentHtml: string, pageBreaks: number[] = []): number {
  const pages = splitContentIntoPages(contentHtml);
  const manualBreaks = Array.isArray(pageBreaks) ? pageBreaks.length : 0;
  return Math.max(pages.length, manualBreaks + 1, 1);
}

/** 按分页边界拆分剧集（页数 ≥ 2 才可拆分；第一页为前集，其余为后集） */
export function splitEpisodeByPage(episode: Episode): { first: Episode; second: Episode } | null {
  const pages = splitContentIntoPages(episode.content);
  if (pages.length < 2) return null;
  const now = new Date().toISOString();
  const first: Episode = {
    ...episode,
    title: `${episode.title}（上）`,
    content: pages[0]!.html,
    pageBreaks: [], // 分页标记已包含在 HTML 中，索引数组失效
    updatedAt: now,
  };
  const second: Episode = {
    ...episode,
    id: `ep-${Date.now()}`,
    title: `${episode.title}（下）`,
    content: pages.slice(1).map((p) => p.html).join(''),
    pageBreaks: [],
    createdAt: now,
    updatedAt: now,
  };
  return { first, second };
}

/** 时长估算：1 页 ≈ 1 分钟 */
export function estimateScreenTime(pageCount: number): string {
  return `${pageCount} 分钟`;
}

/** 单个剧集页数统计 */
export function getEpisodePageCount(episode: Episode): number {
  return calculatePageCount(episode.content, episode.pageBreaks ?? []);
}

interface UseEpisodeManagerOptions {
  episodes: Episode[];
  /** 更新剧集列表（页面内部负责写回对应版本） */
  onUpdateEpisodes: (eps: Episode[]) => void;
  /** 新增/切换剧集后需要选中时回调 */
  onSelect?: (id: string) => void;
}

export function useEpisodeManager({
  episodes,
  onUpdateEpisodes,
  onSelect,
}: UseEpisodeManagerOptions) {
  /** 派生出页数/时长/序号字段（不写回持久化，仅渲染用） */
  const normalizedEpisodes = useMemo(() => episodes.map((ep, index) => ({
    ...ep,
    number: index + 1,
    pageCount: getEpisodePageCount(ep),
    estimatedDuration: getEpisodePageCount(ep),
  })), [episodes]);

  const totalPages = useMemo(
    () => normalizedEpisodes.reduce((acc, ep) => acc + (ep.pageCount ?? 0), 0),
    [normalizedEpisodes],
  );

  const totalDuration = useMemo(() => totalPages, [totalPages]);

  const addEpisode = useCallback((afterId?: string) => {
    const now = Date.now();
    const newEp: Episode = {
      id: `ep-${now}`,
      number: episodes.length + 1,
      title: `第${episodes.length + 1}集`,
      content: '',
      status: 'draft' as EpisodeStatus,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (!afterId) {
      onUpdateEpisodes([...episodes, newEp]);
    } else {
      const idx = episodes.findIndex((e) => e.id === afterId);
      if (idx === -1) { onUpdateEpisodes([...episodes, newEp]); return; }
      const next = [...episodes];
      next.splice(idx + 1, 0, newEp);
      onUpdateEpisodes(next);
    }
    onSelect?.(newEp.id);
  }, [episodes, onUpdateEpisodes, onSelect]);

  const removeEpisode = useCallback((id: string) => {
    const filtered = episodes.filter((e) => e.id !== id);
    const next = filtered.length > 0
      ? filtered
      : [{ id: `ep-${Date.now()}`, number: 1, title: '第1集', content: '', status: 'draft' as EpisodeStatus, createdAt: new Date().toISOString() }];
    onUpdateEpisodes(next);
    if (next[0] && filtered.length === 0) onSelect?.(next[0]!.id);
  }, [episodes, onUpdateEpisodes, onSelect]);

  const duplicateEpisode = useCallback((id: string) => {
    const src = episodes.find((e) => e.id === id);
    if (!src) return;
    const copy: Episode = {
      ...src,
      id: `ep-${Date.now()}`,
      title: `${src.title}（副本）`,
      content: src.content,
      pageBreaks: src.pageBreaks ? [...src.pageBreaks] : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const idx = episodes.findIndex((e) => e.id === id);
    const next = [...episodes];
    next.splice(idx + 1, 0, copy);
    onUpdateEpisodes(next);
    onSelect?.(copy.id);
  }, [episodes, onUpdateEpisodes, onSelect]);

  const reorderEpisodes = useCallback((ids: string[]) => {
    const reordered = ids
      .map((id) => episodes.find((e) => e.id === id))
      .filter((e): e is Episode => Boolean(e));
    if (reordered.length !== episodes.length) return;
    onUpdateEpisodes(reordered);
  }, [episodes, onUpdateEpisodes]);

  const updateEpisode = useCallback((id: string, partial: Partial<Episode>) => {
    onUpdateEpisodes(episodes.map((e) => (
      e.id === id
        ? { ...e, ...partial, updatedAt: new Date().toISOString() }
        : e
    )));
  }, [episodes, onUpdateEpisodes]);

  /** 按分页边界拆分剧集（页数 ≥ 2 时成功，返回是否可拆分） */
  const splitEpisode = useCallback((id: string): boolean => {
    const src = episodes.find((e) => e.id === id);
    if (!src) return false;
    const result = splitEpisodeByPage(src);
    if (!result) return false;
    const idx = episodes.findIndex((e) => e.id === id);
    const next = [...episodes];
    next.splice(idx, 1, result.first, result.second);
    onUpdateEpisodes(next);
    onSelect?.(result.second.id);
    return true;
  }, [episodes, onUpdateEpisodes, onSelect]);

  /** 合并两集为第一集（内容直接拼接，HTML 块自包含） */
  const mergeEpisodes = useCallback((id1: string, id2: string) => {
    const first = episodes.find((e) => e.id === id1);
    const second = episodes.find((e) => e.id === id2);
    if (!first || !second) return;
    const merged: Episode = {
      ...first,
      content: `${first.content}${second.content}`,
      pageBreaks: first.pageBreaks ? [...first.pageBreaks] : [],
      updatedAt: new Date().toISOString(),
    };
    const next = episodes
      .filter((e) => e.id !== id2)
      .map((e) => (e.id === id1 ? merged : e));
    onUpdateEpisodes(next);
    onSelect?.(id1);
  }, [episodes, onUpdateEpisodes, onSelect]);

  return {
    normalizedEpisodes,
    totalPages,
    totalDuration,
    addEpisode,
    removeEpisode,
    duplicateEpisode,
    reorderEpisodes,
    updateEpisode,
    splitEpisode,
    mergeEpisodes,
  };
}
