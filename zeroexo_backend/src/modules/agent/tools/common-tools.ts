/**
 * common-tools — 基础工具集（无副作用，任何 Agent 都能用）
 *
 * 仅读写 project.script 和 project.config，只需要 PrismaService。
 */

import type { Tool, ToolContext } from './tool-types';

export function readScript(ctx: ToolContext): Tool {
  return {
    name: 'read_script',
    description: '读取当前项目的剧本/脚本内容,返回多集结构化数据',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async (_args: any) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { script: true },
      });
      return { script: project?.script ?? null, message: '剧本已读取' };
    },
  };
}

export function saveScript(ctx: ToolContext): Tool {
  return {
    name: 'save_script',
    description: '保存/更新剧本内容到当前项目',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'object', description: '剧本内容(JSON)' },
      },
      required: ['content'],
    },
    execute: async (args: { content: any }) => {
      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: { script: args.content },
      });
      return { success: true, message: '剧本已保存' };
    },
  };
}

export function readProjectConfig(ctx: ToolContext): Tool {
  return {
    name: 'read_project_config',
    description: '读取当前项目的配置信息(题材、风格、时长等)',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async (_args: any) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { config: true },
      });
      return { config: project?.config ?? null, message: '配置已读取' };
    },
  };
}

export function saveProjectConfig(ctx: ToolContext): Tool {
  return {
    name: 'save_project_config',
    description: '保存项目配置信息(题材、风格、时长等),浅合并现有 config',
    parameters: {
      type: 'object',
      properties: {
        config: { type: 'object', description: '要合并的配置字段' },
      },
      required: ['config'],
    },
    execute: async (args: { config: Record<string, any> }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { config: true },
      });
      const currentConfig = (project?.config as Record<string, any>) ?? {};
      const merged = { ...currentConfig, ...args.config };
      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: { config: merged },
      });
      return { success: true, message: '配置已保存' };
    },
  };
}

export function readStoryboard(ctx: ToolContext): Tool {
  return {
    name: 'read_storyboard',
    description: '读取当前项目的分镜数据(v2 schema,含 episodes/entities)',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async (_args: any) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { storyboard: true },
      });
      return { storyboard: project?.storyboard ?? null, message: '分镜已读取' };
    },
  };
}

/** 基础工具集工厂 */
export function commonTools(ctx: ToolContext): Tool[] {
  return [
    readScript(ctx),
    saveScript(ctx),
    readProjectConfig(ctx),
    saveProjectConfig(ctx),
    readStoryboard(ctx),
  ];
}
