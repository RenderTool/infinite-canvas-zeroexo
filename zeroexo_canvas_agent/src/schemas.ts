/**
 * schemas — MCP 工具 zod schema 与描述（唯一事实源）
 *
 * 工具映射到浏览器侧既有 CanvasOp 执行层（executeCanvasOp 串行队列）：
 * op ∈ add_node / add_edge / update_node / remove_node / set_selection / focus
 */

import { z } from 'zod';

const recordSchema = z.record(z.unknown());
const positionSchema = z.object({ x: z.number(), y: z.number() });
const sizeSchema = z.object({ width: z.number(), height: z.number() });

/** 对齐 zeroexo_front 画布节点类型 */
const nodeTypeSchema = z.enum([
  'script', 'storyboard', 'image', 'video', 'audio',
  'generator', 'text', 'config', 'production-manager',
]);

export const toolNames = [
  'canvas_get_state',
  'canvas_get_selection',
  'canvas_apply_ops',
  'canvas_create_node',
  'canvas_create_text_nodes',
  'canvas_update_node',
  'canvas_delete_nodes',
  'canvas_connect_nodes',
  'canvas_select_nodes',
  'canvas_focus_node',
] as const;
export type ToolName = (typeof toolNames)[number];

/** 批量操作并集（对齐前端 CanvasOp 子集） */
export const canvasOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_node'),
    args: z.object({
      id: z.string().optional(),
      type: z.string(),
      position: positionSchema.optional(),
      size: sizeSchema.optional(),
      title: z.string().optional(),
      data: recordSchema.optional(),
    }).passthrough(),
  }),
  z.object({
    op: z.literal('add_edge'),
    args: z.object({
      source: z.object({ nodeId: z.string(), pinId: z.string().default('output') }),
      target: z.object({ nodeId: z.string(), pinId: z.string().default('input') }),
    }).passthrough(),
  }),
  z.object({
    op: z.literal('update_node'),
    args: z.object({
      id: z.string(),
      patch: recordSchema.optional(),
    }).passthrough(),
  }),
  z.object({
    op: z.literal('remove_node'),
    args: z.object({ id: z.string() }).passthrough(),
  }),
  z.object({
    op: z.literal('set_selection'),
    args: z.object({ nodeIds: z.array(z.string()) }).passthrough(),
  }),
  z.object({
    op: z.literal('focus'),
    args: z.object({ id: z.string() }).passthrough(),
  }),
]);

const textNodeItemSchema = z.object({
  text: z.string(),
  title: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

export const toolInputSchemas = {
  canvas_get_state: z.object({}).passthrough(),
  canvas_get_selection: z.object({}).passthrough(),
  canvas_apply_ops: z.object({ ops: z.array(canvasOpSchema).min(1) }),
  canvas_create_node: z.object({
    type: nodeTypeSchema,
    title: z.string().optional(),
    content: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    size: sizeSchema.optional(),
    data: recordSchema.optional(),
  }),
  canvas_create_text_nodes: z.object({
    items: z.array(textNodeItemSchema).min(1),
    x: z.number().optional(),
    y: z.number().optional(),
    gap: z.number().optional(),
    direction: z.enum(['row', 'column']).optional(),
  }),
  canvas_update_node: z.object({
    id: z.string(),
    title: z.string().optional(),
    patch: recordSchema.optional(),
  }),
  canvas_delete_nodes: z.object({ ids: z.array(z.string()).min(1) }),
  canvas_connect_nodes: z.object({
    connections: z.array(z.object({
      fromNodeId: z.string(),
      toNodeId: z.string(),
    })).min(1),
  }),
  canvas_select_nodes: z.object({ ids: z.array(z.string()) }),
  canvas_focus_node: z.object({ id: z.string() }),
} satisfies Record<ToolName, z.AnyZodObject>;

export const toolDescriptions: Record<ToolName, string> = {
  canvas_get_state:
    '读取当前网页画布的节点、连线、选区与视口。操作画布前必须先调用本工具获取真实节点 id，禁止凭记忆猜测。',
  canvas_get_selection:
    '读取当前画布选中的节点。用户提到"这个/选中的/当前节点"时使用。',
  canvas_apply_ops:
    '批量操作画布（一次调用完成多个操作）。ops 支持 add_node / add_edge / update_node / remove_node / set_selection / focus。复杂批量改动优先用本工具。',
  canvas_create_node:
    '创建节点。type：script 剧本 / storyboard 分镜 / text 文本 / image 图片 / video 视频 / audio 音频 / generator 生成器 / config 配置。text/script 类型用 content 传内容。',
  canvas_create_text_nodes:
    '批量创建文本节点，自动行列布局留间距。适合一次性输出多个内容块。',
  canvas_update_node:
    '更新节点（外科手术式：只改传入字段）。title 改标题，patch 合并进节点 data。',
  canvas_delete_nodes:
    '删除指定节点（相关连线自动清理）。',
  canvas_connect_nodes:
    '批量连接节点（上游素材 → 下游产物）。',
  canvas_select_nodes:
    '设置画布选中节点。',
  canvas_focus_node:
    '视口聚焦定位到指定节点（带 AI 操纵动效）。',
};
