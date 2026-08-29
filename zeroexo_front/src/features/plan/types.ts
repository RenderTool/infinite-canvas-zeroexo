/**
 * plan/types — 制作计划（Plan）数据模型（Plan#51）
 *
 * Plan 是与「剧本」同级的一等对象，由 Agent 读取剧本后生成并维护，
 * 以资产形式存储（AssetKind='plan'，content 存本结构的 JSON）。
 *
 * 颗粒度决策（用户采纳推荐）：**整部剧一个 Plan**
 * - subjects 为剧级共享（角色定妆图全剧复用，不按集重复）
 * - shots 按 episodeId 分组（Tab2 内按集筛选）
 * - refId 在剧内唯一，不带集号
 *
 * 强关联约定：
 * - 任何地方（提示词正文、分镜块、其它资产）都只写 refId 或槽位号「图N」，
 *   绝不直接写真实 assetId；真实素材只存在于 Variant.assetId，解析时反查。
 */

// ===== 枚举 =====

export type SubjectRole = 'character' | 'scene' | 'prop' | 'style';

/** 变体（占位）状态：missing=待收集 / collected=已绑定素材 / generating=生成中 / ready=就绪 */
export type VariantStatus = 'missing' | 'collected' | 'generating' | 'ready';

/** 主体状态由其变体聚合而来 */
export type SubjectStatus = 'missing' | 'partial' | 'ready';

/** 分镜块状态：draft=AI 草稿 / confirmed=用户确认 / sent=已发送到画布 */
export type ShotStatus = 'draft' | 'confirmed' | 'sent';

export type PlanUpdatedBy = 'ai' | 'user';

// ===== 色卡 =====

export interface ColorSwatch {
  /** 色号键，如 'C1' */
  key: string;
  /** 十六进制，如 '#D4D4D4' */
  hex: string;
  /** 色名，如 '晨雾灰' */
  name: string;
  /** 用途说明，如 '日景山林/晨雾高光' */
  usage?: string;
}

/** 色卡：剧级全局共用，所有资产生成共用同一套色板 */
export interface ColorCardEntry {
  /** 固定 'STYLE'，作为特殊主体参与引用 */
  refId: string;
  name: string;
  swatches: ColorSwatch[];
  /** 色卡参考图（可选） */
  assetId?: string | null;
  status: VariantStatus;
}

// ===== 主体与变体 =====

/**
 * 主体变体：一个主体的多个状态/版本占位。
 * 例：小狼崽 C2 → 「未受伤 C2-a」「被治疗后 C2-b」「高兴 C2-c」。
 * 用户说「小狼需要高兴的参考图」→ Agent 在 C2 下新增一个 variant 占位，
 * 而不是新建一个主体（保证强关联、总清单不膨胀）。
 */
export interface Variant {
  /** 变体引用 id，格式 `<主体refId>-<后缀>`，如 'C2-a' */
  refId: string;
  /** 变体名，如 '定妆' / '受伤' / '治疗后' / '高兴' */
  name: string;
  /** 该变体的生成提示词 */
  prompt: string;
  /** 绑定的真实素材；null/undefined 表示占位未收集 */
  assetId?: string | null;
  status: VariantStatus;
}

/** 主体：整部剧的角色/场景/道具/色卡条目 */
export interface Subject {
  /** 项目内稳定主键，如 'C1' / 'S1' / 'P2' / 'STYLE' */
  refId: string;
  role: SubjectRole;
  /** 主体名，如 '老张' */
  name: string;
  description?: string;
  /** 基础生成提示词（变体提示词通常在此基础上加状态描述） */
  basePrompt: string;
  /** 多个状态/版本占位；至少 1 个 */
  variants: Variant[];
  /** 由变体聚合得出的状态 */
  status: SubjectStatus;
}

// ===== 分镜块 =====

/**
 * 槽位映射：把提示词正文里的「图N」绑定到主体或变体。
 * 采用 zerovideoAgent 范式（prompts_15s_PartA_v2.md）：
 * 正文写「图1/图2」，映射表独立维护 —— 模型对 @语法支持差，且换素材不动正文。
 */
export interface ShotSlot {
  /** 槽位号，正文用「图{slot}」指代 */
  slot: number;
  /** 引用的主体 refId 或变体 refId（'S1' 或 'C2-b'） */
  refId: string;
  /** 槽位说明，如 '场景「深山老林」全景参考' */
  note?: string;
}

/** 分镜块：剧集下的一个生成单元（对应一段 15s 视频） */
export interface Shot {
  /** 块 id，如 'A01' */
  id: string;
  /** 所属集，用于分组筛选；整部剧一个 Plan 内按集组织 */
  episodeId?: string;
  title: string;
  /** 时间范围，如 '0s-15s' */
  timeRange?: string;
  durationSec?: number;
  slots: ShotSlot[];
  /** 提示词正文，用「图1/图2」指代槽位 */
  prompt: string;
  status: ShotStatus;
}

// ===== Plan 文档 =====

export interface PlanMeta {
  updatedAt: string;
  updatedBy: PlanUpdatedBy;
}

export interface PlanDoc {
  version: 1;
  title: string;
  /** 来源剧本资产 id（Plan 由剧本生成） */
  sourceScriptAssetId?: string | null;
  /** 色卡（剧级全局共用） */
  colorCard?: ColorCardEntry | null;
  subjects: Subject[];
  shots: Shot[];
  meta: PlanMeta;
}

// ===== 构造与工具 =====

export function createEmptyPlan(title: string, sourceScriptAssetId?: string | null): PlanDoc {
  return {
    version: 1,
    title: title.trim() || '未命名制作计划',
    sourceScriptAssetId: sourceScriptAssetId ?? null,
    colorCard: null,
    subjects: [],
    shots: [],
    meta: { updatedAt: new Date().toISOString(), updatedBy: 'ai' },
  };
}

/** 由变体状态聚合主体状态 */
export function computeSubjectStatus(subject: Subject): SubjectStatus {
  const vs = subject.variants;
  if (vs.length === 0) return 'missing';
  const ready = vs.filter((v) => v.status === 'ready' || v.status === 'collected').length;
  if (ready === 0) return 'missing';
  return ready === vs.length ? 'ready' : 'partial';
}

/** 重算全部主体状态（Agent 改动后调用，保证总映射清单一致） */
export function normalizePlan(plan: PlanDoc, updatedBy: PlanUpdatedBy = 'ai'): PlanDoc {
  return {
    ...plan,
    subjects: plan.subjects.map((s) => ({ ...s, status: computeSubjectStatus(s) })),
    meta: { updatedAt: new Date().toISOString(), updatedBy },
  };
}

/** 解析 Plan JSON（容错：结构损坏时回退空 Plan） */
export function parsePlanDoc(raw: string | null | undefined, fallbackTitle = '制作计划'): PlanDoc {
  if (!raw) return createEmptyPlan(fallbackTitle);
  try {
    const parsed = JSON.parse(raw) as PlanDoc;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.subjects)) {
      return createEmptyPlan(fallbackTitle);
    }
    return {
      version: 1,
      title: parsed.title || fallbackTitle,
      sourceScriptAssetId: parsed.sourceScriptAssetId ?? null,
      colorCard: parsed.colorCard ?? null,
      subjects: Array.isArray(parsed.subjects) ? parsed.subjects : [],
      shots: Array.isArray(parsed.shots) ? parsed.shots : [],
      meta: parsed.meta ?? { updatedAt: new Date().toISOString(), updatedBy: 'ai' },
    };
  } catch {
    return createEmptyPlan(fallbackTitle);
  }
}

/** 按 refId 查找主体（变体 refId 会回溯到其主体） */
export function findSubjectByRef(plan: PlanDoc, refId: string): Subject | undefined {
  return plan.subjects.find((s) => s.refId === refId);
}

/** 按变体 refId 查找变体，返回 [主体, 变体] */
export function findVariantByRef(
  plan: PlanDoc,
  refId: string,
): { subject: Subject; variant: Variant } | undefined {
  // 1) 先按变体 refId 精确匹配（'C2-b'）
  for (const subject of plan.subjects) {
    const variant = subject.variants.find((v) => v.refId === refId);
    if (variant) return { subject, variant };
  }
  // 2) 退化：传的是主体 refId（'C2'）→ 取首个就绪变体，没有则首个变体
  const subject = findSubjectByRef(plan, refId);
  if (!subject || subject.variants.length === 0) return undefined;
  const ready = subject.variants.find((v) => v.status === 'ready' || v.status === 'collected');
  return { subject, variant: ready ?? subject.variants[0]! };
}

/** 生成一个唯一的 refId（Agent 新增主体时用） */
export function nextSubjectRefId(plan: PlanDoc, role: SubjectRole): string {
  const prefix = role === 'character' ? 'C' : role === 'scene' ? 'S' : role === 'prop' ? 'P' : 'STYLE';
  if (prefix === 'STYLE') return 'STYLE';
  let n = 1;
  const used = new Set(plan.subjects.map((s) => s.refId));
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

/** 生成一个唯一的变体 refId（Agent 新增变体时用） */
export function nextVariantRefId(subject: Subject): string {
  const used = new Set(subject.variants.map((v) => v.refId));
  const suffixes = 'abcdefghijklmnopqrstuvwxyz'.split('');
  for (const s of suffixes) {
    const candidate = `${subject.refId}-${s}`;
    if (!used.has(candidate)) return candidate;
  }
  let n = 1;
  while (used.has(`${subject.refId}-v${n}`)) n += 1;
  return `${subject.refId}-v${n}`;
}
