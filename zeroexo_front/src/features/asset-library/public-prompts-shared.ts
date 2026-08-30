/**
 * public-prompts-shared - 公共提示词公共类型与工具（征集 #111 抽取）
 *
 * 单独成文件的原因：getLocalizedTitle / PublicPromptItem 原先定义在
 * public-prompts-page.tsx，而该页面 import 了 shared/components 大桶 →
 * prompt-viewer → asset-library/index → use-asset-library，形成循环依赖。
 * 循环初始化时消费方拿到的 getLocalizedTitle 可能是 undefined（运行时
 * TypeError 且是否触发取决于模块加载顺序——实测同一代码不同入口时崩时好）。
 * 抽到无重依赖的独立文件后，任何一层导入都不再成环。
 */

// ===== 类型 =====

export interface PublicPromptItem {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  images: { storageKey: string; width?: number; height?: number; alt?: string }[];
  source: string;
  sourceId?: string;
  sourceName?: string;
  sourceUrl?: string;
  license?: string;
  clusterName?: string;
  demoTitles?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

// ===== 多语言标题 =====

export function getLocalizedTitle(item: PublicPromptItem, lang: string): string {
  const titles = item?.demoTitles || {};
  const fallback = item?.title ?? '';
  if (!titles || Object.keys(titles).length === 0) return fallback;
  if (lang.startsWith('zh')) {
    if (lang === 'zh-Hant' || lang === 'zh-TW' || lang === 'zh-HK') {
      return titles.zh_hant || titles.zh_hans || fallback;
    }
    return titles.zh_hans || titles.zh_hant || fallback;
  }
  return titles.en || fallback;
}
