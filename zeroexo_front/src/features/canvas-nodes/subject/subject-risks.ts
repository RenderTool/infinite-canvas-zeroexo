import { useSyncExternalStore } from 'react';

/**
 * Plan#20 T10/T12: 主体风险检测共享模块(扩展版)。
 * 检测项:
 * 1. noImage            — 缺形象图(全部状态 images 为空)
 * 2. placeholderPending — 占位未转正(AI 建卡 placeholder 标记未清除且无图)
 * 3. sameName           — 同名不同人(主体 name/aliases 与画布另一主体卡撞车)
 * 4. samePerson         — 同人不同名(与另一主体卡 name/aliases 交叉,疑似同一人两卡)
 * 5. brokenRef          — 引用断裂(分镜 shots 引用名在画布主体卡集合中找不到,消费端为分镜节点)
 * 6. crossEpisodeState  — 跨集形象冲突(同一主体被多集引用且引用到不同有图状态)
 * 消费端:SubjectNodeView(卡角标)、CreationNodeView 分镜聚合角标。
 * 另提供引用收集工具:collectStoryboardShots(合并/拆分/停用保护共用)。
 */

const EMPTY_NODES: ReadonlyArray<unknown> = [];
const EMPTY_EDGES: ReadonlyArray<unknown> = [];
const EMPTY_GRAPH = { nodes: EMPTY_NODES, edges: EMPTY_EDGES };

/** 安全订阅画布图(store 缺失时返回空图且不订阅,避免预览态崩溃) */
export function useGraphSafe(store?: unknown): { nodes: ReadonlyArray<unknown>; edges: ReadonlyArray<unknown> } {
  const s = store as
    | { subscribeGraph?: (cb: () => void) => () => void; getGraph?: () => { nodes: unknown[]; edges: unknown[] } }
    | undefined;
  return useSyncExternalStore(
    (cb) => (s?.subscribeGraph ? s.subscribeGraph(cb) : () => {}),
    () => (s?.getGraph ? s.getGraph() : EMPTY_GRAPH),
  );
}

/** 主体风险输入(轻量结构,SubjectCardData 结构兼容) */
export interface SubjectRiskInput {
  name: string;
  aliases: string[];
  states: Array<{ images: unknown[] }>;
  /** AI 占位创建未转正标记 */
  placeholder?: boolean;
}

export type SubjectRiskKind =
  | 'noImage'
  | 'placeholderPending'
  | 'sameName'
  | 'samePerson'
  | 'brokenRef'
  | 'crossEpisodeState';

export interface SubjectRisk {
  kind: SubjectRiskKind;
  /** 风险主体名 */
  subjectName: string;
  /** 同名不同人/同人不同名时的冲突对象名 */
  clashWith?: string;
}

/** 从节点数据解析轻量主体输入(非主体节点返回空主体) */
export function subjectRiskInputOf(node: unknown): SubjectRiskInput {
  const d = ((node as { data?: Record<string, unknown> } | null)?.data) ?? {};
  return {
    name: typeof d.name === 'string' ? d.name : '',
    aliases: Array.isArray(d.aliases) ? (d.aliases as string[]) : [],
    states: Array.isArray(d.states)
      ? (d.states as Array<Record<string, unknown>>).map((s) => ({
          images: Array.isArray(s.images) ? (s.images as unknown[]) : [],
        }))
      : [],
    placeholder: d.placeholder === true,
  };
}

/** 主体卡名/别名键集合 */
export function subjectNameKeys(name: string, aliases: string[]): Set<string> {
  const keys = new Set<string>();
  if (name) keys.add(name);
  for (const a of aliases) if (a) keys.add(a);
  return keys;
}

/**
 * 检测单个主体卡风险:缺形象图 / 占位未转正 / 同名不同人 / 同人不同名。
 * - sameName: 与 other 卡 name/aliases 直接撞车(不同人同名)
 * - samePerson: name 或 aliases 与 other 卡的另一键交叉(疑似同一人两张卡)
 */
export function detectSubjectRisks(me: SubjectRiskInput, others: ReadonlyArray<unknown>): SubjectRisk[] {
  const risks: SubjectRisk[] = [];
  const hasImage = me.states.some((st) => st.images.length > 0);
  if (!hasImage && me.placeholder) {
    risks.push({ kind: 'placeholderPending', subjectName: me.name });
  } else if (!hasImage) {
    risks.push({ kind: 'noImage', subjectName: me.name });
  }
  const myKeys = subjectNameKeys(me.name, me.aliases);
  for (const raw of others) {
    if (!raw || typeof raw !== 'object') continue;
    const n = raw as { id?: string; data?: Record<string, unknown> };
    const d = n.data ?? {};
    const oName = typeof d.name === 'string' ? d.name : '';
    const oAliases = Array.isArray(d.aliases) ? (d.aliases as string[]) : [];
    const oKeys = subjectNameKeys(oName, oAliases);
    // 同名不同人:直接撞车
    let clash: string | undefined;
    for (const k of myKeys) {
      if (oKeys.has(k)) {
        clash = oName || k;
        break;
      }
    }
    if (clash) {
      risks.push({ kind: 'sameName', subjectName: me.name, clashWith: clash });
      break;
    }
    // 同人不同名:本卡 name 在对方 aliases 中,或本卡 aliases 在对方 name 中
    if (me.name && oAliases.includes(me.name)) {
      risks.push({ kind: 'samePerson', subjectName: me.name, clashWith: oName });
      break;
    }
    if (oName && me.aliases.includes(oName)) {
      risks.push({ kind: 'samePerson', subjectName: me.name, clashWith: oName });
      break;
    }
  }
  return risks;
}

// ===== Plan#20 T12: 引用收集与改写工具(合并/拆分/停用保护共用) =====

/** 分镜内单个镜头引用(定位用) */
export interface ShotRef {
  /** 分镜节点 id */
  storyboardId: string;
  /** 分镜节点标题(提示用) */
  storyboardTitle: string;
  /** 集 id(空 = 单集旧数据 shots 数组) */
  episodeId?: string;
  /** 镜头序号(列表内下标,提示用) */
  shotIndex: number;
  /** 镜头 id(落库字段) */
  shotId: string;
  /** 镜头内被引用名字(改写用) */
  mention: string;
  /** 镜头简写(提示用,截断) */
  preview: string;
}

/** 收集全画布分镜中引用指定主体名/别名的镜头(名字文本匹配,与对账逻辑一致) */
export function collectSubjectShotRefs(
  graphNodes: ReadonlyArray<unknown>,
  name: string,
  aliases: string[],
): ShotRef[] {
  const keys = subjectNameKeys(name, aliases);
  if (keys.size === 0) return [];
  const refs: ShotRef[] = [];
  for (const raw of graphNodes) {
    const n = raw as { id?: string; title?: string; type?: string; data?: Record<string, unknown> };
    if (n.type !== 'storyboard') continue;
    const d = n.data ?? {};
    const shots = Array.isArray(d.shots) ? (d.shots as Array<Record<string, unknown>>) : [];
    const shotsByEpisode = (d.shotsByEpisode as Record<string, Array<Record<string, unknown>>> | undefined) ?? {};
    const collect = (shotList: Array<Record<string, unknown>>, episodeId?: string) => {
      shotList.forEach((shot, shotIndex) => {
        const entities = Array.isArray(shot.entities) ? (shot.entities as Array<unknown>) : [];
        for (const e of entities) {
          const mention = typeof e === 'string' ? e : ((e as { mention?: string }).mention ?? '');
          if (mention && keys.has(mention)) {
            refs.push({
              storyboardId: n.id ?? '',
              storyboardTitle: n.title ?? '',
              episodeId,
              shotIndex,
              shotId: (shot.id as string) ?? '',
              mention,
              preview: ((shot.promptText ?? shot.prompt) as string ?? '').slice(0, 48),
            });
            break;
          }
        }
      });
    };
    collect(shots);
    for (const [epId, list] of Object.entries(shotsByEpisode)) {
      if (Array.isArray(list)) collect(list, epId);
    }
  }
  return refs;
}

/**
 * 跨集状态引用统计:同主体卡在各集引用到的状态 id 集合。
 * 返回 Map<stateId, { episodes: string[]; hasImage: boolean; count: number }>
 */
export function collectSubjectStateRefsByEpisode(
  graphNodes: ReadonlyArray<unknown>,
  name: string,
  aliases: string[],
  states: Array<{ id: string; images: unknown[] }>,
): Map<string, { episodes: string[]; hasImage: boolean; count: number }> {
  const keys = subjectNameKeys(name, aliases);
  const stateByImage = new Map<string, { episodes: string[]; hasImage: boolean; count: number }>();
  for (const raw of graphNodes) {
    const n = raw as { type?: string; data?: Record<string, unknown> };
    if (n.type !== 'storyboard') continue;
    const d = n.data ?? {};
    const shotsByEpisode = (d.shotsByEpisode as Record<string, Array<Record<string, unknown>>> | undefined) ?? {};
    for (const [epId, list] of Object.entries(shotsByEpisode)) {
      if (!Array.isArray(list)) continue;
      for (const shot of list) {
        const entities = Array.isArray(shot.entities) ? (shot.entities as Array<unknown>) : [];
        for (const e of entities) {
          if (typeof e === 'string') continue;
          const ref = e as { mention?: string; stateId?: string };
          if (!ref.mention || !keys.has(ref.mention) || !ref.stateId) continue;
          const state = states.find((s) => s.id === ref.stateId);
          const entry = stateByImage.get(ref.stateId) ?? { episodes: [], hasImage: Boolean(state && state.images.length > 0), count: 0 };
          if (!entry.episodes.includes(epId)) entry.episodes.push(epId);
          entry.count += 1;
          stateByImage.set(ref.stateId, entry);
        }
      }
    }
  }
  return stateByImage;
}

/** 引用断裂:分镜 shots 中出现的实体名在画布主体卡集合中找不到匹配(引用名 → 卡) */
export function detectBrokenRefs(
  storyboardNodes: ReadonlyArray<unknown>,
  subjectCards: ReadonlyArray<unknown>,
): Array<{ subjectName: string; storyboardTitle: string; mention: string; count: number }> {
  const cardKeys = subjectCards
    .map((c) => subjectRiskInputOf(c))
    .filter((i) => i.name)
    .map((i) => subjectNameKeys(i.name, i.aliases));
  const seen = new Map<string, { subjectName: string; storyboardTitle: string; mention: string; count: number }>();
  for (const raw of storyboardNodes) {
    const n = raw as { id?: string; type?: string; title?: string; data?: Record<string, unknown> };
    if (n.type !== 'storyboard') continue;
    const d = n.data ?? {};
    const shots = Array.isArray(d.shots) ? (d.shots as Array<Record<string, unknown>>) : [];
    const shotsByEpisode = (d.shotsByEpisode as Record<string, Array<Record<string, unknown>>> | undefined) ?? {};
    const allShots = [...shots, ...Object.values(shotsByEpisode).flat().filter(Array.isArray)];
    for (const shot of allShots) {
      const entities = Array.isArray(shot.entities) ? (shot.entities as Array<unknown>) : [];
      for (const e of entities) {
        const mention = typeof e === 'string' ? e : ((e as { mention?: string }).mention ?? '');
        if (!mention) continue;
        const matched = cardKeys.some((keys) => keys.has(mention));
        if (matched) continue;
        const key = `${n.id ?? ''}|${mention}`;
        const entry = seen.get(key) ?? { subjectName: mention, storyboardTitle: n.title ?? '', mention, count: 0 };
        entry.count += 1;
        seen.set(key, entry);
      }
    }
  }
  return [...seen.values()];
}

/**
 * 跨集形象冲突:同一主体被多集引用且引用到不同的有图状态。
 * 判定:两个有图状态都被引用,但引用集集合不相交(状态 A 只被集 X 引用、状态 B 只被集 Y 引用, X≠Y)。
 * 同一集内切换状态(共享引用集)不算冲突。
 */
export function detectCrossEpisodeStateConflicts(
  graphNodes: ReadonlyArray<unknown>,
  name: string,
  aliases: string[],
  states: Array<{ id: string; images: unknown[] }>,
): Array<{ subjectName: string; stateA: string; stateB: string }> {
  const byImage = collectSubjectStateRefsByEpisode(graphNodes, name, aliases, states);
  const refStates = [...byImage.entries()].filter(([, info]) => info.hasImage && info.episodes.length > 0);
  const conflicts: Array<{ subjectName: string; stateA: string; stateB: string }> = [];
  for (let i = 0; i < refStates.length; i++) {
    const [idA, infoA] = refStates[i]!;
    for (let j = i + 1; j < refStates.length; j++) {
      const [idB, infoB] = refStates[j]!;
      if (infoA.episodes.some((ep) => infoB.episodes.includes(ep))) continue;
      conflicts.push({ subjectName: name, stateA: idA, stateB: idB });
    }
  }
  return conflicts;
}

// ===== Plan#20 T12d: 视频生成三级门禁(纯函数预留) =====
// workbench 当前为占位页,无视频生成功能;本函数供未来视频生成 Plan 直接调用,
// 门禁语义:block 必拦截(形象未定稿/无法确定用哪个形象/引用断裂),warn 可跳过。

export type VideoGateLevel = 'ok' | 'warn' | 'block';

export interface VideoGateIssue {
  level: Exclude<VideoGateLevel, 'ok'>;
  kind: SubjectRiskKind | 'noCard';
  subjectName: string;
  detail: string;
}

/** 风险 → 门禁级别映射(缺图可生成但形象无参考=warn;占位未转正/同名/断引用=block) */
function gateLevelOf(kind: SubjectRiskKind): VideoGateIssue['level'] {
  switch (kind) {
    case 'placeholderPending':
    case 'sameName':
    case 'brokenRef':
      return 'block';
    default:
      return 'warn';
  }
}

/**
 * 三级门禁评估:输入目标分镜节点 + 全画布节点,输出拦截/警告清单。
 * - block: 占位未转正(形象未定稿) / 同名不同人(无法确定用哪个形象) / 引用断裂(主体无卡)
 * - warn: 缺形象图(可生成但无参考) / 同人不同名 / 跨集形象冲突
 */
export function assessVideoGate(
  storyboardNode: unknown,
  graphNodes: ReadonlyArray<unknown>,
): VideoGateIssue[] {
  const issues: VideoGateIssue[] = [];
  const subjectCards = graphNodes.filter((n) => (n as { type?: string }).type === 'subject');
  const sb = storyboardNode as { id?: string; title?: string; data?: Record<string, unknown> } | null;
  if (!sb) return issues;
  const d = sb.data ?? {};
  const shots = Array.isArray(d.shots) ? (d.shots as Array<Record<string, unknown>>) : [];
  const shotsByEpisode = (d.shotsByEpisode as Record<string, Array<Record<string, unknown>>> | undefined) ?? {};
  const allShots = [...shots, ...Object.values(shotsByEpisode).flat().filter(Array.isArray)];
  // 1) 引用断裂:shots 中引用名在主体卡集合找不到
  const seenBroken = new Set<string>();
  for (const shot of allShots) {
    const entities = Array.isArray(shot.entities) ? (shot.entities as Array<unknown>) : [];
    for (const e of entities) {
      const mention = typeof e === 'string' ? e : ((e as { mention?: string }).mention ?? '');
      if (!mention || seenBroken.has(mention)) continue;
      const cardKeys = subjectCards.map((c) => subjectNameKeys(subjectRiskInputOf(c).name, subjectRiskInputOf(c).aliases));
      const matched = cardKeys.some((keys) => keys.has(mention));
      if (!matched) {
        seenBroken.add(mention);
        issues.push({ level: 'block', kind: 'noCard', subjectName: mention, detail: mention });
      }
    }
  }
  // 2) 主体卡风险:占位未转正 / 缺图 / 同名 / 同人不同名 → 门禁级别
  for (const c of subjectCards) {
    const input = subjectRiskInputOf(c);
    if (!input.name) continue;
    const others = subjectCards.filter((o) => o !== c);
    for (const r of detectSubjectRisks(input, others)) {
      if (r.kind === 'sameName' || r.kind === 'samePerson') continue; // 撞车风险已由引用匹配覆盖,不重复计
      issues.push({ level: gateLevelOf(r.kind), kind: r.kind, subjectName: r.subjectName, detail: r.kind });
    }
  }
  // 3) 跨集形象冲突(warn)
  for (const c of subjectCards) {
    const input = subjectRiskInputOf(c);
    if (!input.name) continue;
    const states = ((c as { data?: Record<string, unknown> }).data?.states as Array<{ id?: string; images?: unknown[] }> | undefined) ?? [];
    const cross = detectCrossEpisodeStateConflicts(
      graphNodes,
      input.name,
      input.aliases,
      states.filter((s) => typeof s.id === 'string').map((s) => ({ id: s.id as string, images: Array.isArray(s.images) ? s.images : [] })),
    );
    for (const cnf of cross) {
      issues.push({ level: 'warn', kind: 'crossEpisodeState', subjectName: cnf.subjectName, detail: cnf.stateA });
    }
  }
  return issues;
}

/** 引用改写核心:把 shot 中匹配源名字的实体改为目标名字(纯函数,返回新 shots 数组) */
export function rewriteShotRefs<T extends { entities?: unknown }>(shots: T[], sourceKeys: Set<string>, targetName: string): T[] {
  return shots.map((shot) => {
    const entities = Array.isArray(shot.entities) ? (shot.entities as unknown[]) : [];
    let changed = false;
    const next = entities.map((e) => {
      if (typeof e === 'string') {
        if (sourceKeys.has(e)) {
          changed = true;
          return targetName;
        }
        return e;
      }
      const ref = e as { mention?: string };
      if (ref.mention && sourceKeys.has(ref.mention)) {
        changed = true;
        return { ...ref, mention: targetName };
      }
      return e;
    });
    if (!changed) return shot;
    return { ...shot, entities: next };
  });
}

/** 改写单个 shot 的 entities 中匹配 mention 的实体(字符串直接替换 / 对象改 mention 字段,拆分主体按镜头改写用) */
export function rewriteMentionInEntities(entities: unknown, sourceMention: string, targetName: string): unknown {
  if (!Array.isArray(entities)) return entities;
  return entities.map((e) => {
    if (typeof e === 'string') return e === sourceMention ? targetName : e;
    const ref = e as { mention?: string };
    return ref.mention === sourceMention ? { ...ref, mention: targetName } : e;
  });
}

/** 风险角标颜色/文案映射(SubjectNodeView 与分镜聚合共用) */
export const RISK_KIND_META: Record<SubjectRiskKind, { tone: 'red' | 'amber' | 'blue'; short: string }> = {
  noImage: { tone: 'amber', short: '缺图' },
  placeholderPending: { tone: 'amber', short: '占位' },
  sameName: { tone: 'red', short: '重名' },
  samePerson: { tone: 'red', short: '疑似同人' },
  brokenRef: { tone: 'red', short: '断引用' },
  crossEpisodeState: { tone: 'blue', short: '跨集冲突' },
};
