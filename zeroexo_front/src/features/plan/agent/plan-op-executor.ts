/**
 * plan/agent/plan-op-executor — Agent 对 Plan 的操作执行器（Plan#51 T9 + Agent 本体）
 *
 * 用户诉求：一切修改通过 Agent 执行，用户能看到 AI 的操作链路。
 * 因此 Agent 对 Plan 的所有写操作都建模为**可枚举的 PlanOp**，由本执行器统一落地：
 * - 纯函数：applyPlanOp(plan, op) → { plan, description, focus }
 * - description 用于 Agent 面板展示「AI 刚做了什么」
 * - focus 用于「跟随 AI 操作」：自动定位/高亮到受影响的主体或分镜块
 *
 * 这样 Agent 只需输出结构化 op 序列，不需要理解 Plan 内部存储细节。
 */

import {
  computeSubjectStatus,
  nextSubjectRefId,
  nextVariantRefId,
  type ColorCardEntry,
  type PlanDoc,
  type Shot,
  type Subject,
  type Variant,
} from '../types.js';

export type PlanOp =
  | { op: 'add_subject'; args: { subject: Subject } }
  | { op: 'update_subject'; args: { refId: string; patch: Partial<Omit<Subject, 'refId' | 'variants'>> } }
  | { op: 'duplicate_subject'; args: { refId: string; newRefId?: string; newName?: string; newBasePrompt?: string; variantNames?: string[] } }
  | { op: 'add_variant'; args: { subjectRefId: string; name: string; prompt: string } }
  | { op: 'update_variant'; args: { refId: string; patch: Partial<Omit<Variant, 'refId'>> } }
  | { op: 'bind_asset'; args: { refId: string; assetId: string | null } }
  | { op: 'add_shot'; args: { shot: Shot } }
  | { op: 'update_shot'; args: { id: string; patch: Partial<Omit<Shot, 'id'>> } }
  | { op: 'set_color_card'; args: { colorCard: ColorCardEntry } };

export interface PlanOpResult {
  /** 应用后的 Plan */
  plan: PlanDoc;
  /** 人类可读的操作描述（Agent 面板展示） */
  description: string;
  /** 受影响目标，供「跟随 AI 操作」定位高亮 */
  focus?: { scope: 'subject' | 'shot'; refId: string };
}

function withSubject(plan: PlanDoc, refId: string, fn: (s: Subject) => Subject): PlanDoc {
  return {
    ...plan,
    subjects: plan.subjects.map((s) => {
      if (s.refId !== refId) return s;
      const next = fn(s);
      return { ...next, status: computeSubjectStatus(next) };
    }),
  };
}

/** 应用单条 op（纯函数；非法输入原样返回并记录说明） */
export function applyPlanOp(plan: PlanDoc, op: PlanOp): PlanOpResult {
  switch (op.op) {
    case 'add_subject': {
      const subject = op.args.subject;
      if (!subject?.refId) return { plan, description: '新增主体失败：缺少 refId' };
      if (plan.subjects.some((s) => s.refId === subject.refId)) {
        return { plan, description: `主体 ${subject.refId} 已存在，跳过`, focus: { scope: 'subject', refId: subject.refId } };
      }
      const withStatus: Subject = {
        ...subject,
        variants: subject.variants ?? [],
        status: computeSubjectStatus(subject),
      };
      return {
        plan: { ...plan, subjects: [...plan.subjects, withStatus] },
        description: `新增主体「${withStatus.name}」(${withStatus.refId})`,
        focus: { scope: 'subject', refId: withStatus.refId },
      };
    }

    case 'update_subject': {
      const { refId, patch } = op.args;
      if (!plan.subjects.some((s) => s.refId === refId)) {
        return { plan, description: `更新失败：主体 ${refId} 不存在` };
      }
      const next = withSubject(plan, refId, (s) => ({ ...s, ...patch }));
      return {
        plan: next,
        description: `更新主体 ${refId}`,
        focus: { scope: 'subject', refId },
      };
    }

    case 'duplicate_subject': {
      const { refId, newRefId, newName, newBasePrompt, variantNames } = op.args;
      const src = plan.subjects.find((s) => s.refId === refId);
      if (!src) return { plan, description: `复制失败：主体 ${refId} 不存在` };

      const targetRefId = newRefId && !plan.subjects.some((s) => s.refId === newRefId)
        ? newRefId
        : nextSubjectRefId(plan, src.role);

      // 复制变体结构但**不复制已绑定素材**（副本需重新生成/收集，避免误用原图）
      const base: Subject = {
        ...src,
        refId: targetRefId,
        name: newName ?? `${src.name} 副本`,
        basePrompt: newBasePrompt ?? src.basePrompt,
        variants: src.variants.map((v, i) => ({
          refId: `${targetRefId}-${String.fromCharCode(97 + i)}`,
          name: variantNames?.[i] ?? v.name,
          prompt: v.prompt,
          assetId: null,
          status: 'missing' as const,
        })),
        status: 'missing' as const,
      };

      return {
        plan: { ...plan, subjects: [...plan.subjects, base] },
        description: `复制主体 ${refId} → ${targetRefId}（新版本，素材待重新生成）`,
        focus: { scope: 'subject', refId: targetRefId },
      };
    }

    case 'add_variant': {
      const { subjectRefId, name, prompt } = op.args;
      const subject = plan.subjects.find((s) => s.refId === subjectRefId);
      if (!subject) return { plan, description: `新增状态失败：主体 ${subjectRefId} 不存在` };

      const variantRefId = nextVariantRefId(subject);
      const variant: Variant = { refId: variantRefId, name: name || '新状态', prompt: prompt || '', assetId: null, status: 'missing' };
      const next = withSubject(plan, subjectRefId, (s) => ({ ...s, variants: [...s.variants, variant] }));
      return {
        plan: next,
        description: `为主体「${subject.name}」新增状态占位「${variant.name}」(${variantRefId})`,
        focus: { scope: 'subject', refId: subjectRefId },
      };
    }

    case 'update_variant': {
      const { refId, patch } = op.args;
      let subjectRefId: string | null = null;
      for (const s of plan.subjects) {
        if (s.variants.some((v) => v.refId === refId)) { subjectRefId = s.refId; break; }
      }
      if (!subjectRefId) return { plan, description: `更新失败：变体 ${refId} 不存在` };

      const next = withSubject(plan, subjectRefId, (s) => ({
        ...s,
        variants: s.variants.map((v) => (v.refId === refId ? { ...v, ...patch } : v)),
      }));
      return {
        plan: next,
        description: `更新状态 ${refId}`,
        focus: { scope: 'subject', refId: subjectRefId },
      };
    }

    case 'bind_asset': {
      const { refId, assetId } = op.args;
      let subjectRefId: string | null = null;
      for (const s of plan.subjects) {
        if (s.variants.some((v) => v.refId === refId)) { subjectRefId = s.refId; break; }
      }
      if (!subjectRefId) return { plan, description: `绑定失败：变体 ${refId} 不存在` };

      const next = withSubject(plan, subjectRefId, (s) => ({
        ...s,
        variants: s.variants.map((v) => v.refId === refId ? {
          ...v,
          assetId,
          status: (assetId ? 'collected' : 'missing') as Variant['status'],
        } : v),
      }));
      return {
        plan: next,
        description: assetId ? `绑定素材到 ${refId}` : `解绑 ${refId} 的素材`,
        focus: { scope: 'subject', refId: subjectRefId },
      };
    }

    case 'add_shot': {
      const shot = op.args.shot;
      if (!shot?.id) return { plan, description: '新增分镜块失败：缺少 id' };
      if (plan.shots.some((s) => s.id === shot.id)) {
        return { plan, description: `分镜块 ${shot.id} 已存在，跳过`, focus: { scope: 'shot', refId: shot.id } };
      }
      return {
        plan: { ...plan, shots: [...plan.shots, { ...shot, status: shot.status ?? 'draft' }] },
        description: `新增分镜块「${shot.id} ${shot.title}」`,
        focus: { scope: 'shot', refId: shot.id },
      };
    }

    case 'update_shot': {
      const { id, patch } = op.args;
      if (!plan.shots.some((s) => s.id === id)) {
        return { plan, description: `更新失败：分镜块 ${id} 不存在` };
      }
      return {
        plan: { ...plan, shots: plan.shots.map((s) => (s.id === id ? { ...s, ...patch } : s)) },
        description: `更新分镜块 ${id}`,
        focus: { scope: 'shot', refId: id },
      };
    }

    case 'set_color_card': {
      const { colorCard } = op.args;
      return {
        plan: { ...plan, colorCard },
        description: `设置色卡「${colorCard.name}」`,
        focus: { scope: 'subject', refId: colorCard.refId },
      };
    }

    default:
      return { plan, description: `未知的 Plan 操作：${(op as { op: string }).op}` };
  }
}

/** 批量应用（Agent 一次可能输出多条 op） */
export function applyPlanOps(plan: PlanDoc, ops: PlanOp[]): { plan: PlanDoc; results: PlanOpResult[] } {
  let current = plan;
  const results: PlanOpResult[] = [];
  for (const op of ops) {
    const result = applyPlanOp(current, op);
    results.push(result);
    current = result.plan;
  }
  return { plan: current, results };
}
