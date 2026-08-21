/**
 * production-manager-types - 统筹节点数据契约（Plan#29 主体系统 V3）
 *
 * 统筹 = 一部剧的资产管理器（剧级聚合节点）：
 * - 条目(items) = 演员/场景/道具，是主体信息的唯一事实源
 * - 分镜 shot.entities 以条目 id(cardId) 幂等引用，改名不断链
 * - 「状态」已废弃：条目图片为「剧照集」，每张图挂自由标签（不约束语义）
 */

export type ProductionItemKind = 'character' | 'scene' | 'prop';

/** 剧照（自由标签替代旧「状态」枚举） */
export interface ProductionItemImage {
  storageKey: string;
  tags: string[];
}

/** 统筹条目（一个演员/场景/道具） */
export interface ProductionItem {
  /** 条目稳定 id：分镜 shot.entities 的 cardId 引用键 */
  id: string;
  name: string;
  kind: ProductionItemKind;
  /** 别名（逗号分隔录入） */
  aliases: string[];
  /** 一致性提示词 */
  consistency: string;
  /** 音色（演员） */
  voice: string;
  /** 备注 */
  note: string;
  /** 出场集（展示标记，非过滤维度） */
  episodeIds: string[];
  /** 剧照集（不同时期形象 + 自由标签） */
  images: ProductionItemImage[];
  /** 可提炼提示词（发送到资产 → 提示词条目） */
  prompt: string;
}

export interface ProductionManagerData {
  title: string;
  /** 关联剧本节点 id（剧本→统筹自动建联） */
  scriptId?: string;
  items: ProductionItem[];
}

export function createProductionItem(kind: ProductionItemKind, name = ''): ProductionItem {
  return {
    id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    kind,
    aliases: [],
    consistency: '',
    voice: '',
    note: '',
    episodeIds: [],
    images: [],
    prompt: '',
  };
}

export function createProductionManagerDefaultData(): ProductionManagerData {
  return { title: '统筹', items: [] };
}

/** 条目名字键集合（名字 + 别名，供幂等匹配） */
export function productionItemKeys(item: { name?: string; aliases?: string[] }): Set<string> {
  const keys = new Set<string>();
  const push = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s) keys.add(s);
  };
  push(item.name);
  for (const a of item.aliases ?? []) push(a);
  return keys;
}
