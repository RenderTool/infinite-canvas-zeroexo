/**
 * orchestrator - Agent 编排器
 *
 * 1. orchestrate(): 按顺序执行一系列 Agent 步骤(原有逻辑),每一步的输出作为下一步的上下文输入。
 * 2. orchestrateStoryboardGenerate(): 分镜生成分块编排(Plan#9)
 *    - 输入: 超长剧本文本 → 按段落切块(每块 ≤12k 字符 ≈ 8k tokens)
 *    - 每块独立 AgentTask(taskType: storyboard_assistant, input 带 parentTaskId)
 *    - 并发池执行(≤3),断点续跑(已有 completed 子任务直接复用 output)
 *    - 汇总: JSON shots 合并 → 全局序号重排 → sceneId 加块前缀去重 → 父任务 output
 *
 * 通过 AsyncGenerator 向上层推送所有中间事件。
 */

import { Injectable, Logger } from '@nestjs/common';
import { AgentEvent } from './dto/agent.dto';
import { AgentFactory } from './agent-factory';
import { AgentTaskService } from './agent-task.service';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface OrchestrationStep {
  agentType: string;
  input?: string;
}

/** 分镜分块编排输入(storyboard_generate 父任务 input) */
export interface StoryboardGenerateInput {
  scriptText: string;
  episodeId?: string;
  providerId?: string;
  model?: string;
}

/** 单块子任务执行结果 */
export interface StoryboardChunkResult {
  index: number;
  taskId: string;
  shots: any[];
  error?: string;
}

/** 单块切分单元 */
interface StoryboardChunk {
  index: number;
  text: string;
}

/** 分块上限: 约 8k tokens(中文 1 token ≈ 1.5 字符, 保守取 12000 字符) */
const CHUNK_MAX_CHARS = 12000;
/** 并发池上限 */
const CHUNK_CONCURRENCY = 3;

@Injectable()
export class AgentOrchestrator {
  private readonly logger = new Logger(AgentOrchestrator.name);

  constructor(
    private readonly agentFactory: AgentFactory,
    private readonly taskService: AgentTaskService,
    private readonly prisma: PrismaService,
  ) {}

  async *orchestrate(
    artifactId: string,
    steps: OrchestrationStep[],
    userId: string,
  ): AsyncGenerator<AgentEvent> {
    let context = '';

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      this.logger.log(`编排步骤 ${i + 1}/${steps.length}: ${step.agentType}`);

      const agent = await this.agentFactory.create(
        step.agentType,
        artifactId,
        userId,
      );

      // 如果当前步骤没有指定输入,使用上一步的输出作为上下文
      const input = step.input || context;

      const generator = agent.execute(input, artifactId, userId);

      for await (const event of generator) {
        yield event;
        if (event.type === 'agent:complete') {
          const eventData = event.data as { output?: string } | null;
          context = eventData?.output || context;
        }
      }

      // 每完成一步,推送进度事件
      yield {
        type: 'agent:progress',
        data: {
          step: i + 1,
          totalSteps: steps.length,
          agentType: step.agentType,
          status: 'completed',
        },
        timestamp: Date.now(),
      };
    }
  }

  // ===== Plan#9: 分镜生成分块编排 =====

  /**
   * 分镜生成分块编排(父任务 taskType: storyboard_generate)
   *
   * 流程:
   * 1. 按段落切分剧本(每块 ≤12k 字符)
   * 2. 断点续跑: 查询该父任务下已有子任务,completed 块直接复用 output
   * 3. 每块创建/复用独立 AgentTask(storyboard_assistant, input 带 mode:'chunk' + parentTaskId)
   * 4. 并发池执行(≤3),逐块推送进度事件
   * 5. 汇总合并: JSON shots 解析 → number 全局重排 → sceneId 加块前缀去重
   * 6. 部分失败不中断整体: 失败块标记进 output.blocks.failed,可重试; 全部失败则推送 agent:error
   */
  async *orchestrateStoryboardGenerate(
    taskId: string,
    projectId: string,
    userId: string,
    input: StoryboardGenerateInput,
  ): AsyncGenerator<AgentEvent> {
    const startTime = Date.now();
    const scriptText = (input.scriptText ?? '').trim();

    if (!scriptText) {
      yield {
        type: 'agent:error',
        data: { agentType: 'storyboard_generate', error: '剧本内容为空' },
        timestamp: Date.now(),
      };
      return;
    }

    // 1. 切块
    const rawChunks = this.splitIntoChunks(scriptText);
    const chunks: StoryboardChunk[] = rawChunks.map((text, index) => ({ index, text }));
    this.logger.log(`分镜分块: ${taskId} 切分为 ${chunks.length} 块`);

    // 2. 断点续跑: 查询该父任务下已有子任务
    const existingChildren = await this.findChildTasks(taskId);
    const existingByIndex = new Map<number, any>();
    for (const child of existingChildren) {
      const idx = (child.input as any)?.chunkIndex;
      if (typeof idx === 'number') existingByIndex.set(idx, child);
    }

    // 3. 为每块确定子任务(completed 复用 / 其余重建)
    const plans: Array<{ chunk: StoryboardChunk; child: any; reuse: boolean }> = [];
    for (const chunk of chunks) {
      const existingChild = existingByIndex.get(chunk.index);
      if (existingChild && existingChild.status === 'completed' && existingChild.output) {
        // 断点续跑: 已完成块直接复用
        plans.push({ chunk, child: existingChild, reuse: true });
        continue;
      }
      const child = await this.taskService.createTask({
        userId,
        taskType: 'storyboard_assistant',
        projectId,
        input: {
          mode: 'chunk',
          chunkIndex: chunk.index,
          totalChunks: chunks.length,
          scriptChunk: chunk.text,
          parentTaskId: taskId,
          episodeId: input.episodeId,
          providerId: input.providerId,
          model: input.model,
        },
      });
      plans.push({ chunk, child, reuse: false });
    }

    // 4. 并发池执行
    const results: StoryboardChunkResult[] = [];
    const executing = new Map<number, Promise<StoryboardChunkResult>>();
    let nextIndex = 0;

    const runChunk = (plan: { chunk: StoryboardChunk; child: any; reuse: boolean }): Promise<StoryboardChunkResult> => (async () => {
      const { chunk, child, reuse } = plan;
      if (reuse) {
        try {
          const shots = this.parseShotsFromOutput((child.output as any)?.output ?? '');
          return { index: chunk.index, taskId: child.id, shots };
        } catch (err) {
          // 复用解析失败(旧输出格式不兼容): 降级为重新生成
          this.logger.warn(`子任务 ${child.id} 输出解析失败, 重新生成`, (err as Error).message);
        }
      }
      try {
        await this.taskService.updateTask(child.id, { status: 'running', progress: 0 });
        const output = await this.executeChildAgent(child, projectId, userId);
        const shots = this.parseShotsFromOutput(output);
        await this.taskService.updateTask(child.id, {
          status: 'completed',
          output: { output, shots },
          progress: 100,
          completedAt: new Date(),
        });
        return { index: chunk.index, taskId: child.id, shots };
      } catch (err) {
        const errorMessage = (err as Error).message || '未知错误';
        await this.taskService.updateTask(child.id, {
          status: 'failed',
          error: errorMessage,
          completedAt: new Date(),
        });
        return { index: chunk.index, taskId: child.id, shots: [], error: errorMessage };
      }
    })();

    // 调度循环: 启动并发窗口, 每完成一块 yield 一次进度
    while (results.length < plans.length) {
      while (executing.size < CHUNK_CONCURRENCY && nextIndex < plans.length) {
        const plan = plans[nextIndex++];
        yield {
          type: 'agent:step',
          data: {
            agentType: 'storyboard_generate',
            status: 'thinking',
            message: `正在生成分镜块 ${plan.chunk.index + 1}/${plans.length}...`,
          },
          timestamp: Date.now(),
        };
        executing.set(plan.chunk.index, runChunk(plan));
      }

      const [doneIndex, result] = await Promise.race(
        [...executing.entries()].map(async ([idx, p]) => [idx, await p] as const),
      );
      executing.delete(doneIndex);
      results.push(result);

      const doneCount = results.length;
      const failedCount = results.filter((r) => r.error).length;
      yield {
        type: 'agent:progress',
        data: {
          progress: Math.min(95, Math.round((doneCount / plans.length) * 95)),
          message: `分镜分块 ${doneCount}/${plans.length} 完成${failedCount ? `, ${failedCount} 块失败` : ''}`,
        },
        timestamp: Date.now(),
      };
    }

    // 5. 汇总合并
    const failedBlocks = results
      .filter((r) => r.error)
      .map((r) => ({ index: r.index, taskId: r.taskId, error: r.error }));

    // 全部失败: 推送 error,不产出空结果
    if (failedBlocks.length === plans.length) {
      yield {
        type: 'agent:error',
        data: {
          agentType: 'storyboard_generate',
          error: `分镜生成失败: ${plans.length} 块全部失败(可重试)`,
        },
        timestamp: Date.now(),
      };
      return;
    }

    // 合并: number 全局重排; sceneId 加块前缀去重(第 1 块保持原样, 避免块间 sceneId 重复)
    const mergedShots: any[] = [];
    for (const r of results) {
      if (r.error) continue;
      for (const raw of r.shots) {
        const sceneId = String(raw.sceneId ?? `${r.index + 1}-1`);
        mergedShots.push({
          ...raw,
          ...this.normalizeShotFields(raw),
          id: `shot-${Date.now()}-${mergedShots.length + 1}`,
          number: mergedShots.length + 1,
          sceneId: r.index === 0 ? sceneId : `${r.index + 1}-${sceneId}`,
        });
      }
    }

    this.logger.log(
      `分镜汇总: ${taskId} 共 ${mergedShots.length} 个镜头, 失败块 ${failedBlocks.length}/${plans.length}`,
    );

    yield {
      type: 'agent:complete',
      data: {
        agentType: 'storyboard_generate',
        output: {
          shots: mergedShots,
          blocks: {
            total: plans.length,
            done: plans.length - failedBlocks.length,
            failed: failedBlocks,
          },
        },
        iterations: plans.length,
        durationMs: Date.now() - startTime,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * 镜头字段归一化(T7 质量评估发现契约漂移):
   * LLM 分块输出自创字段(action/subject/timeOfDay/scene/location/composition),
   * 与 save_shots 契约(description/dayNight/environment)不一致,
   * 导致前端(读 shot.description)大量空列。此处补齐契约字段, 保留原始字段不删。
   */
  private normalizeShotFields(raw: any): Record<string, any> {
    const patch: Record<string, any> = {};
    if (!raw.description) {
      const desc = [raw.subject, raw.action].filter((v) => typeof v === 'string' && v.trim()).join('，');
      if (desc) patch.description = desc;
    }
    if (!raw.dayNight && raw.timeOfDay) patch.dayNight = raw.timeOfDay;
    if (!raw.environment) {
      const env = [raw.scene, raw.location, raw.composition]
        .filter((v) => typeof v === 'string' && v.trim())
        .join('，');
      if (env) patch.environment = env;
    }
    return patch;
  }

  // ===== 内部工具 =====

  /**
   * 按段落切分超长文本,每块 ≤ CHUNK_MAX_CHARS 字符
   * 段落优先(\n\n),超长段落按句子边界二次切分,兜底硬切
   */
  private splitIntoChunks(text: string): string[] {
    if (text.length <= CHUNK_MAX_CHARS) return [text];

    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    const chunks: string[] = [];
    let current = '';

    for (const para of paragraphs) {
      if (para.length > CHUNK_MAX_CHARS) {
        if (current) {
          chunks.push(current);
          current = '';
        }
        let rest = para;
        while (rest.length > CHUNK_MAX_CHARS) {
          const cut = this.cutAtSentenceBoundary(rest, CHUNK_MAX_CHARS);
          chunks.push(cut);
          rest = rest.slice(cut.length).trim();
        }
        current = rest;
        continue;
      }
      if (current.length + para.length + 2 > CHUNK_MAX_CHARS) {
        chunks.push(current);
        current = para;
      } else {
        current = current ? `${current}\n\n${para}` : para;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  /** 在 max 长度内找最近的句子边界(。！？!?…\n),找不到则硬切 */
  private cutAtSentenceBoundary(text: string, max: number): string {
    const head = text.slice(0, max);
    const boundaryChars = '。！？!?…\n';
    const searchStart = Math.max(0, head.length - 300);
    for (let i = head.length - 1; i >= searchStart; i--) {
      if (boundaryChars.includes(head[i])) {
        return head.slice(0, i + 1);
      }
    }
    return head;
  }

  /** 查询某父任务下已创建的子任务(断点续跑用) */
  private async findChildTasks(parentTaskId: string): Promise<any[]> {
    try {
      return await this.prisma.agentTask.findMany({
        where: {
          taskType: 'storyboard_assistant',
          input: { path: ['parentTaskId'], equals: parentTaskId },
        },
      });
    } catch (err) {
      // PostgreSQL Json path 过滤失败时降级为全量查询
      this.logger.warn(`子任务 Json 过滤失败: ${parentTaskId}`, (err as Error).message);
      try {
        const all = await this.prisma.agentTask.findMany({
          where: { taskType: 'storyboard_assistant' },
        });
        return all.filter((t) => (t.input as any)?.parentTaskId === parentTaskId);
      } catch {
        return [];
      }
    }
  }

  /** 执行单个子任务 Agent(不走 worker,避免循环依赖),返回最终输出文本 */
  private async executeChildAgent(child: any, projectId: string, userId: string): Promise<string> {
    const agent = await this.agentFactory.create('storyboard_assistant', projectId, userId);
    // 分块模式强指令置于 user 消息首位(比 system prompt 更近输出层,遵从度更高)
    const inputStr = [
      '【分块生成模式·必须遵守】',
      '1. 你是分块处理模式: 禁止调用任何工具,直接输出镜头 JSON 数组;',
      '2. 禁止任何解释、前言、总结或 Markdown 代码块;',
      '3. 输出第一行必须是 JSON 数组本身,sceneId 从 1 开始编号;',
      '4. 每个镜头对象必须包含以下字段(缺一不可):',
      '   id: 字符串唯一标识',
      '   number: 顺序号(从 1 递增)',
      '   sceneId: 场次编号(本块内从 1 开始, 如 1-1)',
      '   duration: 4-15 秒整数',
      '   shotType: 从[特写,近景,中景,中近景,中远景,远景,大全景,全景]选',
      '   cameraMovement: 从[固定,推,拉,摇,移,跟,升,降,推拉,环绕,航拍]选',
      '   description: 画面描述(主体位置+具体行为神态, 如"沈渔立于画面左侧, 转身望向江面"; 禁止"正要/准备/即将"等过渡态; 中景及以上必须含画面位置/朝向)',
      '   lighting: 光影(主光源方向+色温, 如"左侧45°逆光, 5500K"; 禁止"柔和光线"等抽象词)',
      '   promptText: 中文提示词(含[主体描述][场景与氛围][动作与情节][镜头语言]段落)',
      '   promptEn: 英文提示词(与 promptText 结构一致)',
      '   entities: 实体名数组(如["沈渔"])',
      '   dayNight: 日/夜/黄昏/黎明',
      '   environment: 环境描述(地点+时间+纵深层次)',
      '任务数据:',
      JSON.stringify(child.input ?? {}),
    ].join('\n');
    let output = '';

    for await (const event of agent.execute(inputStr, projectId, userId)) {
      if (event.type === 'agent:complete') {
        output = (event.data as any)?.output ?? '';
      } else if (event.type === 'agent:error') {
        throw new Error((event.data as any)?.error ?? '子任务执行失败');
      }
    }
    if (!output) throw new Error('子任务未返回内容');
    return output;
  }

  /** 从子任务输出文本解析镜头 JSON 数组(兼容前言文字 / ```json 围栏 / 对象包裹) */
  private parseShotsFromOutput(output: string): any[] {
    const trimmed = output.trim();
    // 1. 直接 parse(纯 JSON 数组)
    try {
      const direct = JSON.parse(trimmed);
      if (Array.isArray(direct)) return direct;
    } catch { /* 继续尝试 */ }
    // 2. 提取 ```json 围栏内容
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(output);
    if (fence) {
      try {
        const parsed = JSON.parse(fence[1].trim());
        if (Array.isArray(parsed)) return parsed;
      } catch { /* 继续尝试 */ }
    }
    // 3. 提取首个 [ 到最后一个 ](容忍前置文字)
    const arrStart = output.indexOf('[');
    const arrEnd = output.lastIndexOf(']');
    if (arrStart >= 0 && arrEnd > arrStart) {
      try {
        const parsed = JSON.parse(output.slice(arrStart, arrEnd + 1));
        if (Array.isArray(parsed)) return parsed;
      } catch { /* 继续尝试 */ }
    }
    // 4. 对象包裹(如 { shots: [...] })
    const objStart = output.indexOf('{');
    const objEnd = output.lastIndexOf('}');
    if (objStart >= 0 && objEnd > objStart) {
      try {
        const parsed = JSON.parse(output.slice(objStart, objEnd + 1));
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.shots)) return parsed.shots;
      } catch { /* 继续尝试 */ }
    }
    // 5. 截断检测: 有 [ 无闭合 ]
    if (output.includes('[') && !output.includes(']')) {
      throw new Error('分块输出不完整(疑似被 max_tokens 截断),请重试或调大 max_tokens');
    }
    throw new Error(`分块输出不是有效 JSON: ${output.slice(0, 120)}`);
  }
}
