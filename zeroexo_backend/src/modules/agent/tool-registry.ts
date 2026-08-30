/**
 * tool-registry — Agent 工具注册表（工厂入口）
 *
 * 本文件仅包含工具工厂函数和重导出。
 * 具体工具实现已拆分到 ./tools/ 子模块：
 * - tool-types.ts:        公共类型（Tool/ToolContext/CanvasOp 等）
 * - common-tools.ts:      基础 CRUD 工具（readScript/saveScript 等）
 * - canvas-tools.ts:      画布操作工具（canvasGetState/canvasAddNode 等）
 * - storyboard-tools.ts:  分镜写入/校验工具（saveShotsV2/validateShots）
 * - entity-tools.ts:      主体管理工具（saveEntitiesV2/mergeEntities 等）
 * - generation-tools.ts:  AI 生成工具（aiImage/aiAudio/listExistingAssets）
 * - canvas-agent-tools.ts: canvas_agent 编排工具（createScriptNode/workflowGenerate 等）
 * - legacy-tools.ts:      遗留兼容工具（searchWeb/saveShotsLegacy 等）
 */

import { Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AssetsService } from '../assets/assets.service';
import { AiGenerateService } from '../ai-generate/ai-generate.service';
import { AgentSkillService } from './agent-skill.service';

// 重导出类型（保持外部引用兼容）
export type { Tool, ToolContext, CanvasOp, WorkflowChainSource, WorkflowChainDefinition } from './tools/tool-types';

// 重导出工具函数（保持外部引用兼容）
export { readScript, saveScript, readProjectConfig, saveProjectConfig, readStoryboard, commonTools } from './tools/common-tools';
export { canvasGetState, canvasAddNode, canvasAddEdge, canvasUpdateNode, canvasRemoveNode, canvasSetSelection, canvasFocus, readNode, storyboardAddShot, canvasTools } from './tools/canvas-tools';
export { saveShotsV2, validateShots } from './tools/storyboard-tools';
export { saveEntitiesV2, mergeEntities, replaceEntityImage, addVariant, removeVariant, moveVariantToEntity } from './tools/entity-tools';
export { aiImage, aiAudio, listExistingAssets, pollGenerationResult } from './tools/generation-tools';
export { createScriptNode, createStoryboardNode, canvasSetConfig, readContentChunked, readAssetContent, workflowGenerate, artifactLibrary, agentSelfUpgrade } from './tools/canvas-agent-tools';
export { searchWeb, saveShotsLegacy, saveEntitiesLegacy } from './tools/legacy-tools';

// 导入工具函数用于工厂组装
import type { Tool, ToolContext } from './tools/tool-types';
import { commonTools } from './tools/common-tools';
import { canvasTools } from './tools/canvas-tools';
import { saveShotsV2, validateShots } from './tools/storyboard-tools';
import { saveEntitiesV2, mergeEntities, replaceEntityImage, addVariant, removeVariant, moveVariantToEntity } from './tools/entity-tools';
import { aiImage, aiAudio, listExistingAssets } from './tools/generation-tools';
import { createScriptNode, createStoryboardNode, canvasSetConfig, readContentChunked, readAssetContent, workflowGenerate, artifactLibrary, agentSelfUpgrade } from './tools/canvas-agent-tools';
import { searchWeb, saveShotsLegacy, saveEntitiesLegacy } from './tools/legacy-tools';
import { planReadScript, planSubmitOps } from './tools/plan-tools';
import { qualityGateTool } from './tools/production-tools';

const toolLogger = new Logger('AgentTool');

// ============================================================================
// 工具集工厂
// ============================================================================

/**
 * storyboard_assistant 专用工具集（包含全部 16 个工具）
 */
function storyboardAssistantTools(ctx: ToolContext): Tool[] {
  return [
    ...commonTools(ctx),
    saveShotsV2(ctx),
    validateShots(ctx),
    saveEntitiesV2(ctx),
    mergeEntities(ctx),
    replaceEntityImage(ctx),
    addVariant(ctx),
    removeVariant(ctx),
    moveVariantToEntity(ctx),
    aiImage(ctx),
    aiAudio(ctx),
    listExistingAssets(ctx),
    ...canvasTools(ctx),
    workflowGenerate(),
  ];
}

/** 工厂映射（老 Agent 保留兼容） */
const legacyToolFactories: Record<
  string,
  (ctx: ToolContext) => Tool[]
> = {
  researcher: (ctx) => [...commonTools(ctx), searchWeb()],
  entity_extractor: (ctx) => [...commonTools(ctx), saveEntitiesLegacy(ctx)],
  storyboard_breaker: (ctx) => [...commonTools(ctx), saveShotsLegacy(ctx)],
  script_writer: (ctx) => [...commonTools(ctx)],
  cinematographer: (ctx) => [...commonTools(ctx), saveShotsLegacy(ctx)],
  grid_strategy: (ctx) => [...commonTools(ctx)],
  asset_manager: (ctx) => [...commonTools(ctx), saveEntitiesLegacy(ctx)],
  script_format: (ctx) => [...commonTools(ctx)],
  script_multi_version: (ctx) => [...commonTools(ctx)],
};

/**
 * 工厂入口
 *
 * @param agentType    Agent 类型（决定返回哪些工具）
 * @param projectId   项目 ID（所有工具共享的上下文）
 * @param userId       用户 ID（扩展工具必填）
 * @param prisma       Prisma 服务
 * @param assetsService 资产服务（ai_image/ai_audio/list_existing_assets 需要）
 * @param aiGenerateService AI 生成服务（ai_image/ai_audio 需要）
 */
export function createToolsForAgentType(
  agentType: string,
  projectId: string,
  userId: string,
  prisma: PrismaService,
  assetsService?: AssetsService,
  aiGenerateService?: AiGenerateService,
  skillService?: AgentSkillService,
  /** R2：当前任务 ID（Agent 建节点打 agentTaskId 烙印） */
  taskId?: string,
): Tool[] {
  const ctx: ToolContext = {
    projectId,
    userId,
    taskId,
    prisma,
    assetsService,
    aiGenerateService,
  };

  if (agentType === 'storyboard_assistant') {
    if (!assetsService || !aiGenerateService) {
      toolLogger.warn(
        `storyboard_assistant 缺少 AssetsService/AiGenerateService 注入,部分工具将不可用`,
      );
    }
    return storyboardAssistantTools(ctx);
  }

  // plan_agent: 制作计划 Agent（读剧本 → 生成 PlanOp → 提交前端落地）
  if (agentType === 'plan_agent') {
    return [
      planReadScript(ctx),
      planSubmitOps(),
    ];
  }

  // production_agent: 出片生产台 Agent（2026-08-31 新建）
  // 面对出片工作台镜头,不操作画布;读镜头/资产 + 质量门 + 通用 CRUD
  if (agentType === 'production_agent') {
    return [
      readContentChunked(ctx),
      readAssetContent(ctx),
      artifactLibrary(ctx),
      qualityGateTool(),
      ...commonTools(ctx),
    ];
  }

  // canvas_agent: 画布编排助手
  if (agentType === 'canvas_agent') {
    if (!skillService) {
      toolLogger.warn(`canvas_agent 缺少 AgentSkillService 注入,agent_self_upgrade 工具将不可用`);
    }
    const upgradeTools = skillService ? [agentSelfUpgrade(ctx, skillService)] : [];
    return [
      ...canvasTools(ctx),
      workflowGenerate(),
      ...commonTools(ctx),
      createScriptNode(ctx),
      createStoryboardNode(ctx),
      canvasSetConfig(),
      readContentChunked(ctx),
      readAssetContent(ctx),
      artifactLibrary(ctx),
      ...upgradeTools,
    ];
  }

  const legacy = legacyToolFactories[agentType];
  if (legacy) {
    return legacy(ctx);
  }
  return commonTools(ctx);
}
