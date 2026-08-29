/**
 * plan/plan.test.ts — 制作计划（Plan）模块测试（Plan#51）
 *
 * 覆盖用户真实场景的端到端链路：
 * 解析 Plan → 主体状态聚合 → Agent 输出 op 改 Plan → 槽位解析 → 可发送到画布
 */

import { describe, expect, it } from 'vitest';
import type { Asset } from '@/features/asset-picker/index.js';
import {
  computeSubjectStatus,
  createEmptyPlan,
  findVariantByRef,
  nextSubjectRefId,
  nextVariantRefId,
  normalizePlan,
  parsePlanDoc,
  type PlanDoc,
  type Subject,
} from './types.js';
import { extractSlotNumbers, resolveSlots, validateShotSlots } from './resolve-slots.js';
import { applyPlanOp, applyPlanOps } from './agent/plan-op-executor.js';

// ===== 测试夹具 =====

function makeImageAsset(id: string, storageKey: string): Asset {
  return {
    id,
    title: id,
    kind: 'image',
    createdAt: new Date().toISOString(),
    bytes: 1024,
    data: { kind: 'image', dataUrl: '', storageKey },
  } as Asset;
}

/** 构造一个「民间故事」样例 Plan（对齐 zerovideoAgent ZV-002 的结构） */
function makeSamplePlan(): PlanDoc {
  return {
    version: 1,
    title: '民间故事AI短剧 EP01',
    sourceScriptAssetId: null,
    colorCard: {
      refId: 'STYLE',
      name: '色卡',
      swatches: [
        { key: 'C1', hex: '#D4D4D4', name: '晨雾灰' },
        { key: 'C2', hex: '#C4A35A', name: '森林赭' },
      ],
      assetId: null,
      status: 'missing',
    },
    subjects: [
      {
        refId: 'C1',
        role: 'character',
        name: '老张',
        basePrompt: '45岁宋代猎户定妆参考图',
        variants: [
          { refId: 'C1-a', name: '定妆', prompt: '老张定妆', assetId: 'ast_c1', status: 'ready' },
        ],
        status: 'ready',
      },
      {
        refId: 'C2',
        role: 'character',
        name: '小狼崽',
        basePrompt: '幼年灰狼参考图',
        variants: [
          { refId: 'C2-a', name: '未受伤', prompt: '小狼未受伤', assetId: null, status: 'missing' },
          { refId: 'C2-b', name: '被治疗后', prompt: '小狼包扎后', assetId: null, status: 'missing' },
        ],
        status: 'missing',
      },
      {
        refId: 'S1',
        role: 'scene',
        name: '深山老林',
        basePrompt: '深山老林全景',
        variants: [
          { refId: 'S1-a', name: '全景', prompt: '深山全景', assetId: 'ast_s1', status: 'ready' },
        ],
        status: 'ready',
      },
    ],
    shots: [
      {
        id: 'A01',
        episodeId: 'EP01',
        title: '深山晨景 + 老张出门',
        timeRange: '0s-15s',
        slots: [
          { slot: 1, refId: 'S1' },
          { slot: 2, refId: 'C1' },
        ],
        prompt: '[场景锚定] 图1为深山全景。\n[镜头2] 图2角色从木门走出。',
        status: 'draft',
      },
    ],
    meta: { updatedAt: new Date().toISOString(), updatedBy: 'ai' },
  };
}

const assets = [makeImageAsset('ast_c1', 'sk_c1'), makeImageAsset('ast_s1', 'sk_s1')];

// ===== 数据模型 =====

describe('types：解析与容错', () => {
  it('空/损坏 JSON 回退为空 Plan', () => {
    expect(parsePlanDoc(null).subjects).toEqual([]);
    expect(parsePlanDoc('{bad json').title).toBeTruthy();
    expect(parsePlanDoc(JSON.stringify({ subjects: 'not-array' })).subjects).toEqual([]);
  });

  it('正常 JSON 可往返解析', () => {
    const plan = makeSamplePlan();
    const back = parsePlanDoc(JSON.stringify(plan));
    expect(back.title).toBe(plan.title);
    expect(back.subjects).toHaveLength(3);
  });

  it('主体状态按变体聚合：全缺=missing、部分=partial、全齐=ready', () => {
    const subject: Subject = {
      refId: 'X', role: 'prop', name: 'x', basePrompt: '', status: 'missing',
      variants: [
        { refId: 'X-a', name: 'a', prompt: '', assetId: 'a1', status: 'ready' },
        { refId: 'X-b', name: 'b', prompt: '', assetId: null, status: 'missing' },
      ],
    };
    expect(computeSubjectStatus(subject)).toBe('partial');
    expect(computeSubjectStatus({ ...subject, variants: subject.variants.slice(0, 1) })).toBe('ready');
    expect(computeSubjectStatus({ ...subject, variants: [] })).toBe('missing');
  });

  it('normalizePlan 会重算全部主体状态', () => {
    const plan = makeSamplePlan();
    // 手工把 C2 标成 ready（错误状态）→ normalize 后应回到 missing
    const dirty: PlanDoc = {
      ...plan,
      subjects: plan.subjects.map((s) => (s.refId === 'C2' ? { ...s, status: 'ready' } : s)),
    };
    expect(normalizePlan(dirty).subjects.find((s) => s.refId === 'C2')?.status).toBe('missing');
  });
});

describe('types：refId 生成', () => {
  it('主体 refId 按角色前缀递增且避重', () => {
    const plan = makeSamplePlan();
    expect(nextSubjectRefId(plan, 'character')).toBe('C3');
    expect(nextSubjectRefId(plan, 'scene')).toBe('S2');
    expect(nextSubjectRefId(plan, 'prop')).toBe('P1');
    expect(nextSubjectRefId(plan, 'style')).toBe('STYLE');
  });

  it('变体 refId 按字母递增且避重', () => {
    const c2 = makeSamplePlan().subjects.find((s) => s.refId === 'C2')!;
    expect(nextVariantRefId(c2)).toBe('C2-c'); // a、b 已占用
  });
});

describe('types：引用查找', () => {
  it('变体 refId 精确命中', () => {
    const plan = makeSamplePlan();
    const hit = findVariantByRef(plan, 'C2-b');
    expect(hit?.variant.name).toBe('被治疗后');
  });

  it('主体 refId 退化为首个就绪变体，无就绪则取首个', () => {
    const plan = makeSamplePlan();
    expect(findVariantByRef(plan, 'C1')?.variant.refId).toBe('C1-a');
    // C2 两个变体都 missing → 取首个
    expect(findVariantByRef(plan, 'C2')?.variant.refId).toBe('C2-a');
  });

  it('不存在的 refId 返回 undefined', () => {
    expect(findVariantByRef(makeSamplePlan(), 'ZZ')).toBeUndefined();
  });
});

// ===== 槽位解析 =====

describe('resolve-slots：槽位解析', () => {
  it('已绑定槽位解析出 storageKey', () => {
    const plan = makeSamplePlan();
    const shot = plan.shots[0]!;
    const result = resolveSlots(shot, plan, assets);
    expect(result.images).toEqual(['sk_s1', 'sk_c1']); // 按 slot 升序
    expect(result.unresolved).toEqual([]);
    expect(result.ready).toBe(true);
  });

  it('未绑定槽位进入 unresolved 且 ready=false', () => {
    const plan = makeSamplePlan();
    const shot = { ...plan.shots[0]!, slots: [{ slot: 1, refId: 'C2-a' }] };
    const result = resolveSlots(shot, plan, assets);
    expect(result.unresolved).toEqual(['C2-a']);
    expect(result.images).toEqual([]);
    expect(result.ready).toBe(false);
  });

  it('悬空引用（变体标了 ready 但素材已删）视为未就绪', () => {
    const plan = makeSamplePlan();
    const shot = { ...plan.shots[0]!, slots: [{ slot: 1, refId: 'C1-a' }] };
    // 不传 assets → ast_c1 找不到
    const result = resolveSlots(shot, plan, []);
    expect(result.unresolved).toEqual(['C1-a']);
    expect(result.ready).toBe(false);
  });

  it('引用不存在的 refId 也进入 unresolved（不崩溃）', () => {
    const plan = makeSamplePlan();
    const shot = { ...plan.shots[0]!, slots: [{ slot: 1, refId: 'NOPE' }] };
    const result = resolveSlots(shot, plan, assets);
    expect(result.unresolved).toEqual(['NOPE']);
  });
});

describe('resolve-slots：正文与映射一致性', () => {
  it('提取正文槽位号', () => {
    expect(extractSlotNumbers('图1为深山，图2角色走出')).toEqual([1, 2]);
    expect(extractSlotNumbers('无引用')).toEqual([]);
  });

  it('映射表缺失正文引用的槽位会被检出', () => {
    const plan = makeSamplePlan();
    // 正文提到图3，但 slots 只有 1、2
    const shot = { ...plan.shots[0]!, prompt: '图1 图2 图3' };
    const { missingInMap } = validateShotSlots(shot);
    expect(missingInMap).toEqual([3]);
  });

  it('映射表定义但正文未用 → unusedInMap', () => {
    const plan = makeSamplePlan();
    const shot = { ...plan.shots[0]!, prompt: '只用图1' };
    const { unusedInMap } = validateShotSlots(shot);
    expect(unusedInMap).toEqual([2]);
  });
});

// ===== Agent 操作 =====

describe('plan-op-executor：Agent 操作', () => {
  it('add_subject 新增主体并定位', () => {
    const plan = createEmptyPlan('test');
    const result = applyPlanOp(plan, {
      op: 'add_subject',
      args: {
        subject: {
          refId: 'C1', role: 'character', name: '老张', basePrompt: 'p',
          variants: [], status: 'missing',
        },
      },
    });
    expect(result.plan.subjects).toHaveLength(1);
    expect(result.focus).toEqual({ scope: 'subject', refId: 'C1' });
  });

  it('add_subject 重复 refId 跳过', () => {
    const plan = makeSamplePlan();
    const result = applyPlanOp(plan, {
      op: 'add_subject',
      args: {
        subject: {
          refId: 'C1', role: 'character', name: '重复', basePrompt: '',
          variants: [], status: 'missing',
        },
      },
    });
    expect(result.plan.subjects).toHaveLength(3);
    expect(result.description).toContain('已存在');
  });

  it('add_variant 给主体加状态占位（用户场景：小狼要「高兴」）', () => {
    const plan = makeSamplePlan();
    const result = applyPlanOp(plan, {
      op: 'add_variant',
      args: { subjectRefId: 'C2', name: '高兴', prompt: '小狼高兴的参考图' },
    });
    const c2 = result.plan.subjects.find((s) => s.refId === 'C2')!;
    expect(c2.variants).toHaveLength(3);
    expect(c2.variants[2]!.refId).toBe('C2-c');
    expect(c2.variants[2]!.assetId).toBeNull(); // 新占位待收集
  });

  it('duplicate_subject 生成副本但**不复制素材**（用户场景：重做一版）', () => {
    const plan = makeSamplePlan();
    const result = applyPlanOp(plan, {
      op: 'duplicate_subject',
      args: { refId: 'C1', newName: '老张 新版本', newBasePrompt: '重新写的提示词' },
    });
    const copy = result.plan.subjects.find((s) => s.refId === 'C2' || s.refId === 'C3');
    const dup = result.plan.subjects[result.plan.subjects.length - 1]!;
    expect(dup.refId).toBe('C3');
    expect(dup.basePrompt).toBe('重新写的提示词');
    expect(dup.variants[0]!.assetId).toBeNull(); // 关键：不继承原素材
    expect(dup.status).toBe('missing');
    expect(copy).toBeDefined();
  });

  it('bind_asset 绑定/解绑会同步状态', () => {
    const plan = makeSamplePlan();
    const bound = applyPlanOp(plan, { op: 'bind_asset', args: { refId: 'C2-a', assetId: 'ast_x' } });
    const c2 = bound.plan.subjects.find((s) => s.refId === 'C2')!;
    expect(c2.variants[0]!.assetId).toBe('ast_x');
    expect(c2.variants[0]!.status).toBe('collected');
    expect(c2.status).toBe('partial'); // 只绑定了一个变体

    const unbound = applyPlanOp(bound.plan, { op: 'bind_asset', args: { refId: 'C2-a', assetId: null } });
    expect(unbound.plan.subjects.find((s) => s.refId === 'C2')!.variants[0]!.status).toBe('missing');
  });

  it('add_shot / update_shot 正常', () => {
    const plan = makeSamplePlan();
    const added = applyPlanOp(plan, {
      op: 'add_shot',
      args: { shot: { id: 'A02', title: '发现陷阱', slots: [], prompt: 'p', status: 'draft' } },
    });
    expect(added.plan.shots).toHaveLength(2);

    const updated = applyPlanOp(added.plan, {
      op: 'update_shot',
      args: { id: 'A02', patch: { status: 'confirmed' } },
    });
    expect(updated.plan.shots[1]!.status).toBe('confirmed');
  });

  it('非法输入不崩溃，返回原 Plan + 说明', () => {
    const plan = makeSamplePlan();
    expect(applyPlanOp(plan, { op: 'add_variant', args: { subjectRefId: 'NOPE', name: '', prompt: '' } }).plan).toBe(plan);
    expect(applyPlanOp(plan, { op: 'update_shot', args: { id: 'NOPE', patch: {} } }).description).toContain('不存在');
  });

  it('批量应用：多 op 按顺序生效', () => {
    const plan = makeSamplePlan();
    const { plan: next, results } = applyPlanOps(plan, [
      { op: 'add_variant', args: { subjectRefId: 'C2', name: '高兴', prompt: 'p' } },
      { op: 'bind_asset', args: { refId: 'C2-a', assetId: 'ast_y' } },
    ]);
    expect(results).toHaveLength(2);
    expect(next.subjects.find((s) => s.refId === 'C2')!.variants).toHaveLength(3);
  });
});

// ===== 端到端链路 =====

describe('端到端：AI 生成 → 用户补素材 → 解析 → 可发送画布', () => {
  it('完整链路', () => {
    // 1) Agent 生成清单（此时素材都未绑定）
    let plan = makeSamplePlan();
    const shotId = plan.shots[0]!.id;
    expect(resolveSlots(plan.shots[0]!, plan, assets).ready).toBe(true); // S1/C1 已绑定

    // 2) 用户说「小狼要多一个高兴的状态」→ Agent 加占位
    plan = applyPlanOps(plan, [
      { op: 'add_variant', args: { subjectRefId: 'C2', name: '高兴', prompt: '小狼高兴' } },
    ]).plan;
    expect(plan.subjects.find((s) => s.refId === 'C2')!.variants).toHaveLength(3);

    // 3) 用户上传素材 → 绑定
    plan = applyPlanOps(plan, [
      { op: 'bind_asset', args: { refId: 'C2-c', assetId: 'ast_c2c' } },
    ]).plan;

    // 4) Agent 新增引用该变体的分镜块
    plan = applyPlanOps(plan, [
      {
        op: 'add_shot',
        args: {
          shot: {
            id: 'A02', episodeId: 'EP01', title: '小狼高兴',
            slots: [{ slot: 1, refId: 'C2-c' }],
            prompt: '图1 小狼高兴地摇尾巴', status: 'draft',
          },
        },
      },
    ]).plan;

    // 5) 解析新块（带刚上传的素材）→ 就绪，可发送画布
    const a02 = plan.shots.find((s) => s.id === 'A02')!;
    const result = resolveSlots(a02, plan, [...assets, makeImageAsset('ast_c2c', 'sk_c2c')]);
    expect(result.ready).toBe(true);
    expect(result.images).toEqual(['sk_c2c']);
    expect(plan.shots.find((s) => s.id === shotId)).toBeDefined();
  });

  it('素材缺失时阻止发送（避免误生成）', () => {
    let plan = makeSamplePlan();
    const shot = { ...plan.shots[0]!, slots: [{ slot: 1, refId: 'C2-a' }], id: 'B01' };
    plan = applyPlanOps(plan, [
      { op: 'add_shot', args: { shot: { ...shot, status: 'draft' } } },
    ]).plan;
    const b01 = plan.shots.find((s) => s.id === 'B01')!;
    const result = resolveSlots(b01, plan, assets);
    expect(result.ready).toBe(false); // C2-a 未绑定素材
    expect(result.unresolved).toContain('C2-a');
  });
});
