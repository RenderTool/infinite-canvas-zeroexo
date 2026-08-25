/**
 * legacy-tools — 遗留兼容工具（老 Agent 类型保留）
 *
 * 包含 searchWeb、saveShotsLegacy、saveEntitiesLegacy。
 * 新 Agent 请使用 v2 工具。
 */

import type { Tool, ToolContext } from './tool-types';

/** search_web - 联网搜索（待集成） */
export function searchWeb(): Tool {
  return {
    name: 'search_web',
    description: '联网搜索,获取最新的网络信息用于事实验证和资料收集',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
      },
      required: ['query'],
    },
    execute: async (args: { query: string }) => {
      return { results: [], query: args.query, message: '联网搜索功能待集成' };
    },
  };
}

/** save_shots (老 v1 接口) */
export function saveShotsLegacy(ctx: ToolContext): Tool {
  return {
    name: 'save_shots',
    description: '保存分镜数据到项目(老 v1 接口,新 Agent 请用 storyboard_assistant 的 v2 save_shots)',
    parameters: {
      type: 'object',
      properties: {
        shots: { type: 'array', items: { type: 'object' } },
      },
      required: ['shots'],
    },
    execute: async (args: { shots: any[] }) => {
      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: { storyboard: args.shots },
      });
      return { success: true, shotCount: args.shots?.length ?? 0 };
    },
  };
}

/** save_entities (老 v1 接口) */
export function saveEntitiesLegacy(ctx: ToolContext): Tool {
  return {
    name: 'save_entities',
    description: '保存提取的实体信息到项目中(老 v1 接口)',
    parameters: {
      type: 'object',
      properties: {
        entities: { type: 'array', items: { type: 'object' } },
      },
      required: ['entities'],
    },
    execute: async (args: { entities: any[] }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { assets: true },
      });
      const currentAssets = (project?.assets as Record<string, any>) ?? {};
      currentAssets.entities = args.entities;
      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: { assets: currentAssets },
      });
      return { success: true, entityCount: args.entities?.length ?? 0 };
    },
  };
}
