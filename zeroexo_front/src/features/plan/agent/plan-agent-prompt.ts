/**
 * plan/agent/plan-agent-prompt — 制作计划 Agent 的本体定义（Plan#51）
 *
 * 这个文件就是「Agent 的大脑」：
 * - PLAN_AGENT_SYSTEM_PROMPT：读剧本 → 生成主体清单 + 视频提示词分镜块的完整规范
 * - PLAN_OP_TOOLS：Agent 可调用的结构化工具（function calling schema），
 *   对应 plan-op-executor.ts 里可枚举的 PlanOp
 *
 * 设计原则（用户诉求）：Plan 是 AI 强关联对象，用户不直接编辑结构与提示词，
 * 一切增删改由 Agent 输出结构化 op 落地，前端执行并展示操作链路。
 */

import type { PlanDoc } from '../types.js';

/**
 * 系统提示词。
 *
 * 关键范式来自 zerovideoAgent 已验证的产物：
 * - 主体清单：media/asset_prompts.md（色卡锁定 + 角色/场景/道具 + 多状态占位）
 * - 视频提示词：media/video/EP01/prompts_15s_PartA_v2.md（槽位映射 + 图N 指代）
 */
export const PLAN_AGENT_SYSTEM_PROMPT = `你是影视制作策划 Agent，负责把剧本拆解为可执行的「制作计划（Plan）」。

# 你的产出

Plan 是一份结构化文档，包含两大部分：

## 一、主体清单（subjects）
整部剧共用一份主体清单（角色/场景/道具/色卡），**不按集重复**。
每个主体是一个「资产占位」，用户随后收集素材或由你生成。

主体结构：
- refId：项目内稳定主键，人可读。规范：
  - C + 数字 = 角色（C1 老张、C2 小狼崽）
  - S + 数字 = 场景（S1 深山老林）
  - P + 数字 = 道具（P2 古董碗）
  - STYLE = 色卡（唯一）
- role：character / scene / prop / style
- name：中文名
- basePrompt：该主体的基础生成提示词
- variants：状态/变体数组。**这是关键**：一个角色往往有多个状态，
  你必须提前把需要的状态都生成成占位节点，而不是等用户来要。
  例如「小狼崽」应有：未受伤、被治疗后、高兴 等状态。
  变体 refId 格式：<主体refId>-<小写字母>（C2-a、C2-b、C2-c）
  变体结构：{ refId, name, prompt, assetId: null, status: 'missing' }

提示词质量规范（沿用已验证范式）：
- 角色：画幅/构图/角色一致性/体态/服装质感/灯光/色彩/背景/质量标签
- 场景：名称/描述/前中远景/氛围/构图规范/色卡锁定/视觉风格

## 二、视频提示词分镜块（shots）
把剧本按「每块约 15s」拆解成 N 块，每块对应一段视频生成。

块结构：
- id：A01、A02…（可按 Part 分组：PartA = A，PartB = B）
- episodeId：所属集（EP01）
- title：块标题，如「深山晨景 + 老张出门」
- timeRange：如 "0s-15s"
- slots：参考素材槽位映射，**这是引用的关键**
- prompt：提示词正文

### 槽位映射（必须遵守）
正文里**不要**写 @C1 这类语法。正确做法是「映射表 + 图N 指代」：

slots: [
  { slot: 1, refId: 'S1', note: '场景「深山老林」全景参考' },
  { slot: 2, refId: 'C1', note: '角色「老张」定妆形象' },
  { slot: 3, refId: 'STYLE', note: '项目色卡，色调参考' }
]

正文里用「图1/图2/图3」指代：
\`\`\`
[总调性] ...
[场景锚定] 图1为深山全景参考。晨雾缭绕...
[镜头1 0-10s] 大全景极缓推...
[镜头2 10-15s] 中景锁定。图2角色从木门走出...
[光影统一细则] 主光：晨雾柔光 C1 #D4D4D4...
[声音] ...
[通用约束] 不要字幕，不要水印，不要画面内出现参考图原图。
\`\`\`

理由：视频模型对 @ 语法支持不稳定，「图N」是稳定指代；
且映射表与正文分离后，换素材/重新生成时只改绑定，不动正文。

## 三、色卡（colorCard）
必须先定色卡（5 色绑定），所有资产生成共用：
{ refId: 'STYLE', name: '色卡', swatches: [{ key:'C1', hex:'#D4D4D4', name:'晨雾灰', usage:'日景山林/晨雾高光' }, ...] }

生成清单前先询问用户：色卡是**立即生成**还是**占位待定**。

# 你的工作方式

1. 读剧本 → 先定色卡 → 再拆主体（角色→场景→道具）→ 再拆分镜块
2. 主体要覆盖完整，宁可多列占位也不要遗漏（漏了后续生成会缺素材）
3. 每个主体至少 1 个变体；角色按剧情需要列出多个状态变体
4. 分镜块的 slots 只引用清单里已存在的 refId（可以是主体 refId 或变体 refId）
5. 用户后续提出修改时，输出结构化 op（见工具定义），不要重写整份 Plan

# 修改原则

- 用户说「XX 需要更多状态」→ 用 add_variant 在对应主体下新增变体占位
- 用户说「XX 不太好，重新写一版」→ 用 duplicate_subject 生成副本（新 refId，素材不复制，待重新生成）
- 用户说「改一下某块的提示词」→ 用 update_shot 只改那一块
- 不要把已有素材绑到新副本上（新版本需要重新出图）`;

/** 生成 Plan 时的用户输入模板（把剧本内容塞进去） */
export function buildGeneratePlanUserPrompt(input: {
  title: string;
  scriptText: string;
  episodeId?: string;
  colorCardMode: 'generate' | 'placeholder';
}): string {
  const { title, scriptText, episodeId, colorCardMode } = input;
  return `请为以下剧本生成制作计划（Plan）。

标题：${title}
${episodeId ? `集：${episodeId}` : ''}
色卡：${colorCardMode === 'generate' ? '请立即生成 5 色色卡' : '先占位，待用户后续补充'}

剧本内容：
"""
${scriptText}
"""

请输出完整的 Plan JSON（包含 colorCard、subjects、shots 三部分），
严格遵循系统提示词里的 refId 规范、变体规范与槽位映射规范。`;
}

/** 增量修改时的用户输入模板 */
export function buildPatchPlanUserPrompt(input: {
  plan: PlanDoc;
  instruction: string;
}): string {
  return `当前 Plan：
"""
${JSON.stringify(input.plan, null, 2)}
"""

用户指令：${input.instruction}

请输出要执行的 op 序列（JSON 数组），不要重写整份 Plan。`;
}

// ===== 工具定义（function calling schema） =====

export interface PlanOpToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Agent 可调用的工具定义。
 * 与 plan-op-executor.ts 的 PlanOp 一一对应。
 */
export const PLAN_OP_TOOLS: PlanOpToolDef[] = [
  {
    name: 'add_subject',
    description: '新增一个主体（角色/场景/道具/色卡）。refId 必须唯一。',
    parameters: {
      type: 'object',
      required: ['refId', 'role', 'name', 'basePrompt'],
      properties: {
        refId: { type: 'string', description: '如 C1 / S1 / P2 / STYLE' },
        role: { type: 'string', enum: ['character', 'scene', 'prop', 'style'] },
        name: { type: 'string' },
        description: { type: 'string' },
        basePrompt: { type: 'string' },
        variants: {
          type: 'array',
          items: {
            type: 'object',
            required: ['refId', 'name', 'prompt'],
            properties: {
              refId: { type: 'string', description: '如 C1-a' },
              name: { type: 'string' },
              prompt: { type: 'string' },
              assetId: { type: ['string', 'null'] },
              status: { type: 'string', enum: ['missing', 'collected', 'generating', 'ready'] },
            },
          },
        },
      },
    },
  },
  {
    name: 'update_subject',
    description: '更新主体的名称/描述/基础提示词（不改 refId 与变体）。',
    parameters: {
      type: 'object',
      required: ['refId'],
      properties: {
        refId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        basePrompt: { type: 'string' },
      },
    },
  },
  {
    name: 'duplicate_subject',
    description: '复制一个主体生成新版本（用于「重做一版」）。新副本不继承已绑定素材，需重新生成。',
    parameters: {
      type: 'object',
      required: ['refId'],
      properties: {
        refId: { type: 'string', description: '源主体 refId' },
        newRefId: { type: 'string', description: '新 refId，不填则自动分配' },
        newName: { type: 'string' },
        newBasePrompt: { type: 'string' },
        variantNames: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'add_variant',
    description: '给已有主体新增一个状态占位变体（如「高兴」）。',
    parameters: {
      type: 'object',
      required: ['subjectRefId', 'name', 'prompt'],
      properties: {
        subjectRefId: { type: 'string' },
        name: { type: 'string' },
        prompt: { type: 'string' },
      },
    },
  },
  {
    name: 'update_variant',
    description: '更新变体的名称/提示词/状态。',
    parameters: {
      type: 'object',
      required: ['refId'],
      properties: {
        refId: { type: 'string', description: '变体 refId，如 C2-b' },
        name: { type: 'string' },
        prompt: { type: 'string' },
        status: { type: 'string', enum: ['missing', 'collected', 'generating', 'ready'] },
      },
    },
  },
  {
    name: 'bind_asset',
    description: '把已上传/已生成的素材绑定到变体（assetId=null 表示解绑）。',
    parameters: {
      type: 'object',
      required: ['refId', 'assetId'],
      properties: {
        refId: { type: 'string', description: '变体 refId' },
        assetId: { type: ['string', 'null'] },
      },
    },
  },
  {
    name: 'add_shot',
    description: '新增一个视频提示词分镜块。',
    parameters: {
      type: 'object',
      required: ['id', 'title', 'prompt'],
      properties: {
        id: { type: 'string', description: '如 A01' },
        episodeId: { type: 'string' },
        title: { type: 'string' },
        timeRange: { type: 'string' },
        durationSec: { type: 'number' },
        slots: {
          type: 'array',
          items: {
            type: 'object',
            required: ['slot', 'refId'],
            properties: {
              slot: { type: 'number', description: '槽位号，正文用「图N」指代' },
              refId: { type: 'string' },
              note: { type: 'string' },
            },
          },
        },
        prompt: { type: 'string' },
      },
    },
  },
  {
    name: 'update_shot',
    description: '更新分镜块的标题/提示词/槽位/状态。',
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        timeRange: { type: 'string' },
        slots: { type: 'array', items: { type: 'object' } },
        prompt: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'confirmed', 'sent'] },
      },
    },
  },
  {
    name: 'set_color_card',
    description: '设置/更新项目色卡（5 色绑定，所有资产生成共用）。',
    parameters: {
      type: 'object',
      required: ['name', 'swatches'],
      properties: {
        name: { type: 'string' },
        swatches: {
          type: 'array',
          items: {
            type: 'object',
            required: ['key', 'hex', 'name'],
            properties: {
              key: { type: 'string' },
              hex: { type: 'string' },
              name: { type: 'string' },
              usage: { type: 'string' },
            },
          },
        },
        assetId: { type: ['string', 'null'] },
      },
    },
  },
];

/** 把工具定义序列化为常见 function-calling 格式 */
export function toFunctionCallingTools(): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return PLAN_OP_TOOLS.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
