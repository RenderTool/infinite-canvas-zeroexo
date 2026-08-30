/**
 * storyboard-utils - 分镜工具函数
 *
 * 从 storyboard-sheet.tsx 中抽离的辅助函数。
 */
import type { Shot, StoryboardNodeData, StoryboardEntity, EntityRef, EntityKind, AiSubject } from './storyboard-types';
import type { ProductionItem } from '../production-manager/production-manager-types';

/** 创建新空 shot */
export function createNewShot(shots: Shot[]): Shot {
  const number = shots.length + 1;
  const id = `shot-${Date.now()}-${number}`;
  return {
    id,
    number,
    sceneId: `1-${number}`,
    dayNight: '日',
    duration: 5,
    description: '',
    shotType: '中景',
    cameraMovement: '固定',
    dialogue: '',
    voiceoverText: '',
    monologue: '',
    sfx: [],
    entities: [],
    emotion: '',
    lighting: { keyLight: '自然光', colorTemp: '5500K', mood: '平和' },
    environment: { location: '', time: '午后', weather: '晴' },
    continuity: { transition: 'cut' },
    prompt: '',
  };
}

/** 归一化更新:把传给 updater 的 prev.shots/status/progress 归一化为"当前集"视图 */
export function normalizeUpdate(
  data: StoryboardNodeData,
  activeEpisodeId: string,
  updater: (prev: StoryboardNodeData) => StoryboardNodeData,
): StoryboardNodeData {
  const shots = data.shotsByEpisode?.[activeEpisodeId] ?? (Object.keys(data.shotsByEpisode ?? {}).length > 0 ? [] : (data.shots ?? []));
  const status = data.statusByEpisode?.[activeEpisodeId] ?? (Object.keys(data.statusByEpisode ?? {}).length > 0 ? 'idle' : (data.status ?? 'idle'));
  const progress = data.progressByEpisode?.[activeEpisodeId] ?? data.progress ?? 0;
  const normalizedPrev: StoryboardNodeData = { ...data, shots, status, progress };
  const next = updater(normalizedPrev);
  const sbe = { ...(next.shotsByEpisode ?? {}), [activeEpisodeId]: next.shots };
  return { ...next, shotsByEpisode: sbe };
}

// ===== Plan#20 T2: 契约统一工具(后端字符串产出 / 旧数据对象双兼容) =====

/** 光影字符串化: string 直显 / 对象拼 mood·keyLight·colorTemp */
export function formatLighting(lighting: Shot['lighting'] | undefined | null): string {
  if (lighting == null) return '';
  if (typeof lighting === 'string') return lighting;
  return [lighting.mood, lighting.keyLight, lighting.colorTemp].filter(Boolean).join('，');
}

/** 环境字符串化: string 直显 / 对象拼 location·time·weather */
export function formatEnvironment(env: Shot['environment'] | undefined | null): string {
  if (env == null) return '';
  if (typeof env === 'string') return env;
  return [env.location, env.time, env.weather].filter(Boolean).join('，');
}

/** 实体展示名双兼容(EntityRef 取 mention / string 直显) */
export function entityDisplayName(e: EntityRef | string | undefined | null): string {
  if (e == null) return '';
  return typeof e === 'string' ? e : (e.mention ?? '');
}

/**
 * onDone 适配层(写入 node.data 前跑一遍):
 * - lighting/environment 异常形态(非 string 非对象)转字符串
 * - entities 归一为数组(容忍字符串/空)
 * - prompt 映射 promptText(后端分块契约无 prompt 字段)
 * - 新旧数据(含断点续跑复用旧子任务产出)一次适配
 */
export function normalizeShotForUi(raw: Record<string, any>): Shot {
  const shot = { ...raw } as Shot;
  if (shot.lighting != null && typeof shot.lighting !== 'string' && typeof shot.lighting !== 'object') {
    shot.lighting = String(shot.lighting);
  }
  if (shot.environment != null && typeof shot.environment !== 'string' && typeof shot.environment !== 'object') {
    shot.environment = String(shot.environment);
  }
  if (!Array.isArray(shot.entities)) {
    shot.entities = typeof shot.entities === 'string' && shot.entities ? [shot.entities] : [];
  }
  if (!shot.prompt && typeof (shot as any).promptText === 'string') {
    shot.prompt = (shot as any).promptText;
  }
  // 2026-08-20: 对白/旁白/音效字段默认值兜底(旧数据或缺字段时不致空列异常)
  if (typeof shot.dialogue !== 'string') shot.dialogue = shot.dialogue != null ? String(shot.dialogue) : '';
  if (typeof shot.voiceoverText !== 'string') shot.voiceoverText = shot.voiceoverText != null ? String(shot.voiceoverText) : '';
  if (typeof shot.monologue !== 'string') shot.monologue = shot.monologue != null ? String(shot.monologue) : '';
  if (!Array.isArray(shot.sfx)) {
    shot.sfx = typeof shot.sfx === 'string' && shot.sfx ? [shot.sfx] : [];
  }
  // 2026-08-20 T3: dayNight 默认值兜底(旧数据无此字段时空列不致异常)
  if (typeof shot.dayNight !== 'string') shot.dayNight = shot.dayNight != null ? String(shot.dayNight) : '';
  return shot;
}

// ===== 主体 kind 展示元数据(Plan#20 T3: 表格主体列/StepView 单一事实源, 图标对齐 StepView 体系) =====

/** 范文模板分镜主体字典(T3: 生成时写入 node.data; 修复前旧节点无此字段时作兜底展示源) */
export const SAMPLE_SUBJECTS: AiSubject[] = [
  { name: '男主', kind: 'character', aliases: [], description: '三十岁左右，神情怅惘的都市男性' },
  { name: '女主', kind: 'character', aliases: [], description: '步态轻盈、笑容温暖的女性' },
  { name: '江边栈桥', kind: 'scene', aliases: ['江边'], description: '黄昏江边的木质栈桥，夕阳洒在江面' },
  { name: '老茶馆', kind: 'scene', aliases: ['茶馆'], description: '木桌竹椅、茶香袅袅的老式茶馆' },
];

/** 实体类型颜色标准(对齐 production-manager-types KIND_COLOR, 全站统一) */
export const ENTITY_KIND_META: Record<EntityKind, { emoji: string; color: string; labelKey: string }> = {
  character: { emoji: '\u{1F464}', color: '#22c55e', labelKey: 'entity.character' }, // 角色绿色
  scene: { emoji: '\u{1F4CD}', color: '#3b82f6', labelKey: 'entity.scene' },        // 场景蓝色
  prop: { emoji: '\u{1F4E6}', color: '#a855f7', labelKey: 'entity.prop' },           // 道具紫色
};

/**
 * 实体名 → kind 查找链(Plan#20 T3):
 * 1. entities(节点内主体列表, EntityRef.id 或名字匹配)
 * 2. aiSubjects(后端主体字典, 名字/别名匹配)
 * 均未命中返回 undefined(展示中性色)
 */
export function resolveEntityKind(
  name: string,
  entities: StoryboardEntity[],
  aiSubjects?: AiSubject[],
): EntityKind | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  const ent = entities.find((e) => e.name === trimmed || e.id === trimmed);
  if (ent) return ent.kind;
  const subj = aiSubjects?.find((s) => s.name === trimmed || s.aliases.includes(trimmed));
  return subj?.kind;
}

// ===== 2026-08-30 征集 #110: 描述文本主体自动匹配 =====

/** 主体匹配源：entities ∪ aiSubjects ∪ 剧管 items（征集 #110：三者都匹配，entities 优先） */
export interface SubjectMatchSource {
  name: string;
  kind: EntityKind;
  id: string;
  aliases?: string[];
}

/**
 * 收集全部可匹配主体（entities 优先，aiSubjects 与 productionItems 兜底去重）。
 * 供 @ 搜索面板与描述文本自动匹配共用单一数据源。
 */
export function collectSubjectSources(
  entities: StoryboardEntity[],
  aiSubjects?: AiSubject[],
  productionItems?: ProductionItem[],
): SubjectMatchSource[] {
  const out: SubjectMatchSource[] = [];
  const seen = new Set<string>();
  const push = (s: SubjectMatchSource) => {
    if (!s.name.trim() || seen.has(s.name)) return;
    seen.add(s.name);
    out.push(s);
  };
  for (const e of entities ?? []) push({ name: e.name, kind: e.kind, id: e.id, aliases: [] });
  for (const s of aiSubjects ?? []) push({ name: s.name, kind: s.kind ?? 'character', id: `subj-${s.name}`, aliases: s.aliases ?? [] });
  for (const it of productionItems ?? []) push({ name: it.name, kind: it.kind, id: it.id, aliases: it.aliases ?? [] });
  return out;
}

/**
 * 精确匹配：输入文本与主体名/别名完全相等时命中。
 * 用于 @ 面板搜索过滤与失焦自动匹配。
 */
export function matchSubjectByText(
  text: string,
  sources: SubjectMatchSource[],
): SubjectMatchSource | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const exact = sources.find((s) => s.name === trimmed);
  if (exact) return exact;
  return sources.find((s) => (s.aliases ?? []).includes(trimmed));
}

/** 描述文本中已用 @ 引用的主体名集合（扫描 @xxx 词，跳过不重复匹配） */
export function extractExplicitMentions(text: string): Set<string> {
  const set = new Set<string>();
  const re = /@([\w\u4e00-\u9fa5]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    if (m[1]) set.add(m[1]);
  }
  return set;
}