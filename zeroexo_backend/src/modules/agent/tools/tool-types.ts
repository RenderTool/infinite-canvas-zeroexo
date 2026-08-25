/**
 * tool-types — Agent 工具系统类型定义
 *
 * 从 tool-registry.ts 提取的公共类型，供所有工具子模块引用。
 */

import { PrismaService } from '../../../common/prisma/prisma.service';
import { AssetsService } from '../../assets/assets.service';
import { AiGenerateService } from '../../ai-generate/ai-generate.service';
import { AgentSkillService } from '../agent-skill.service';

/** 工具接口 - LLM 可调用的最小单元 */
export interface Tool {
  name: string;
  description: string;
  /** LLM 调用的参数 schema (OpenAI function calling 格式) */
  parameters: Record<string, unknown>;
  execute: (args: any) => Promise<any>;
}

/** 工具工厂的依赖上下文(扩展层工具需要) */
export interface ToolContext {
  projectId: string;
  userId: string;
  /** 当前任务 ID（R2：Agent 创建的节点打 agentTaskId 烙印，供追溯/档案关联） */
  taskId?: string;
  prisma: PrismaService;
  assetsService?: AssetsService;
  aiGenerateService?: AiGenerateService;
}

/**
 * 画布操作意图（SSE 画布指令架构）
 *
 * 后端 Agent 通过 canvas_* 工具返回"画布操作意图" canvasOps,
 * 由前端 CanvasOpExecutor 映射为 @zeroexo/core 命令(AddNodeCommand 等)执行。
 * 这些工具不直接写 DB(数据层仍走 save_* 工具),只负责把已保存的数据在画布上呈现。
 */
export interface CanvasOp {
  op: 'add_node' | 'add_edge' | 'update_node' | 'remove_node' | 'set_selection' | 'focus' | 'workflow_chain' | 'set_config' | 'start_storyboard_generate';
  args: Record<string, unknown>;
}

/**
 * 工作链素材源引用（workflow_generate 工具输入）
 * - id/type: 画布已有节点（前端按 id 读取源节点数据创建副本）
 * - title: 供 Agent 语义引用与生成器标题命名
 */
export interface WorkflowChainSource {
  id: string;
  type: string;
  title?: string;
}

/** 工作链定义（workflow_chain canvasOp 的 args，前端展开执行） */
export interface WorkflowChainDefinition {
  sources: WorkflowChainSource[];
  targetType: string;
  prompt: string;
  generatorTitle?: string;
  generatorParams?: Record<string, unknown>;
  productTitle?: string;
  productId?: string;
}

/** AI 生成轮询选项 */
export interface PollOpts {
  timeoutMs: number;
  intervalMs: number;
  userId: string;
}

/** AI 生成轮询结果 */
export interface PollResult {
  status: 'success' | 'failed' | 'cancelled' | 'timeout';
  storageKey?: string;
  assetId?: string;
  width?: number;
  height?: number;
  duration?: number;
  errorMessage?: string;
}

// AgentSkillService 仅用于类型引用占位（实际注入在工厂层）
export type { AgentSkillService };
