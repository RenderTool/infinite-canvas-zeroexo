/**
 * plan-tools — plan_agent 专用工具
 *
 * plan_agent 负责把剧本拆解为「制作计划（Plan）」。Plan 文档由前端持有并持久化
 * （纯本地资产，云同步仅支持 text/script），因此后端只做两件事：
 *   1. plan_read_script：读取剧本资产内容（剧本已云同步至后端 text 字段）
 *   2. plan_submit_ops：接收 Agent 产出的 PlanOp 序列，原样回传前端逐条应用
 *
 * 设计对齐 Plan#51 用户诉求：一切增删改由 Agent 输出结构化 op 落地，
 * 前端执行并展示操作链路（plan/agent/plan-op-executor.ts）。
 */

import type { Tool, ToolContext } from './tool-types';

const PLAN_SCRIPT_MAX_CHARS = 20000;

/** 读取剧本资产内容（kind='script' | 'text'，内容存 text 字段） */
export function planReadScript(ctx: ToolContext): Tool {
  return {
    name: 'plan_read_script',
    description:
      '读取项目中的剧本/文本资产内容，用于生成或更新制作计划（Plan）。' +
      '传入剧本资产 id（sourceScriptAssetId）后返回剧本全文（超长时截断并标记 truncated）。' +
      '生成 Plan 前必须先调用本工具获取剧本内容。',
    parameters: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '剧本/文本资产 ID' },
        maxChars: { type: 'number', description: '最大读取字符数（默认 20000，最大 50000）' },
      },
      required: ['assetId'],
    },
    execute: async (args: any) => {
      const assetId = String(args.assetId ?? '');
      if (!assetId) return { ok: false, errorMessage: '缺少 assetId' };
      const asset = await ctx.prisma.asset.findFirst({
        where: { id: assetId, ownerId: ctx.userId },
      });
      if (!asset) return { ok: false, errorMessage: '剧本资产不存在或无权访问' };
      if (asset.kind !== 'script' && asset.kind !== 'text') {
        return { ok: false, errorMessage: `该资产（${asset.kind}）不是剧本/文本资产` };
      }
      const content = asset.text ?? '';
      const max = Math.min(Math.max(Number(args.maxChars) || PLAN_SCRIPT_MAX_CHARS, 1000), 50000);
      const truncated = content.length > max;
      return {
        ok: true,
        assetId,
        title: asset.filename,
        totalChars: content.length,
        content: truncated ? content.slice(0, max) : content,
        truncated,
      };
    },
  };
}

/** 提交 PlanOp 操作序列（Agent 的唯一交付通道；前端逐条应用并展示操作链路） */
export function planSubmitOps(): Tool {
  return {
    name: 'plan_submit_ops',
    description:
      '提交制作计划（Plan）的结构化操作序列（PlanOp[]）。分析完成后必须调用本工具交付结果：' +
      'ops 为按执行顺序排列的操作数组，前端会逐条应用并展示操作链路。' +
      '禁止在回复正文里输出 Plan 全文 JSON，一切成果只通过本工具提交。',
    parameters: {
      type: 'object',
      properties: {
        ops: {
          type: 'array',
          description:
            'PlanOp 操作序列。每个 op 结构：{ op: <操作名>, args: <参数对象> }。' +
            '可用操作：add_subject / update_subject / duplicate_subject / add_variant / ' +
            'update_variant / bind_asset / add_shot / update_shot / set_color_card。',
          items: { type: 'object' },
        },
        summary: {
          type: 'string',
          description: '一句话成果摘要（如「已从剧本生成 8 个主体、12 个分镜块、5 色色卡」）',
        },
      },
      required: ['ops'],
    },
    execute: async (args: any) => {
      const ops = Array.isArray(args.ops) ? args.ops : [];
      if (ops.length === 0) {
        return { ok: false, errorMessage: 'ops 为空：没有需要落地的操作' };
      }
      const valid = ops.filter(
        (op: any) =>
          op &&
          typeof op === 'object' &&
          typeof op.op === 'string' &&
          op.args &&
          typeof op.args === 'object',
      );
      if (valid.length === 0) {
        return { ok: false, errorMessage: 'ops 格式非法：每个 op 必须包含 op 名称与 args 对象' };
      }
      return {
        ok: true,
        ops: valid,
        count: valid.length,
        summary: typeof args.summary === 'string' ? args.summary : '',
        message: `已提交 ${valid.length} 条 Plan 操作，前端将逐条应用`,
      };
    },
  };
}
