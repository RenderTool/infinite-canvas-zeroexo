/**
 * agent-worker.service - Agent 工作线程服务
 *
 * 从任务队列取任务，调用 AgentFactory 创建 Agent，
 * 执行 Agent 并推送 SSE 事件，任务完成后更新状态。
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AgentFactory } from './agent-factory';
import { AgentTaskService } from './agent-task.service';
import { AgentSSEService } from './agent-sse.service';
import { AgentConversationService } from './agent-conversation.service';
import { AgentOrchestrator } from './orchestrator';
import { AgentExecutor } from './agent-executor';

@Injectable()
export class AgentWorkerService {
  private readonly logger = new Logger(AgentWorkerService.name);
  private runningTasks = new Map<string, boolean>();

  /** 活跃 AgentExecutor 实例(taskId → executor),用于协议事件(step/question)的前端回执恢复(Plan#33 D1) */
  private activeExecutors = new Map<string, AgentExecutor>();

  /** 任务级并发上限: 与 standalone worker(MAX_CONCURRENT_TASKS=3)对齐, 防多任务×分块并发打爆渠道 QPS(Plan#9 T7 评估落地) */
  private static readonly MAX_CONCURRENT_TASKS = 3;
  private static activeTaskCount = 0;
  private static taskWaiters: Array<() => void> = [];

  constructor(
    private readonly agentFactory: AgentFactory,
    private readonly taskService: AgentTaskService,
    private readonly sseService: AgentSSEService,
    private readonly prisma: PrismaService,
    private readonly conversationService: AgentConversationService,
    private readonly orchestrator: AgentOrchestrator,
  ) {}

  /**
   * 执行一个 Agent 任务
   * 1. 更新任务状态为 running
   * 2. 调用 AgentFactory 创建 Agent
   * 3. 执行 Agent 并推送 SSE 事件
   * 4. 更新任务状态为 completed/failed
   */
  async executeTask(taskId: string): Promise<void> {
    if (this.runningTasks.has(taskId)) {
      this.logger.warn(`任务 ${taskId} 正在执行中，跳过重复执行`);
      return;
    }

    const task = await this.taskService.getTask(taskId);
    if (task.status === 'cancelled') {
      this.logger.warn(`任务 ${taskId} 已取消，跳过执行`);
      return;
    }

    // 任务级并发信号量: 超过上限排队等待(不拒绝)。排队前先置 running,
    // 避免 pending 状态暴露给 standalone worker 轮询造成双进程重复领取
    await this.taskService.updateTask(taskId, { status: 'running', progress: 0 }).catch(() => undefined);
    await AgentWorkerService.acquireSlot();

    this.runningTasks.set(taskId, true);

    try {
      // 0. 分镜生成分块编排任务: 走 orchestrator 分块编排(Plan#9)
      if (task.taskType === 'storyboard_generate') {
        await this.executeStoryboardGenerate(task);
        return;
      }

      // 1. 更新为 running
      await this.taskService.updateTask(taskId, { status: 'running', progress: 0 });

      // 2. 推送开始事件
      this.sseService.emitThinking(taskId, `开始执行 ${task.taskType} 任务...`);

      // 3. 创建 Agent
      const agent = await this.agentFactory.create(
        task.taskType,
        task.projectId || '__no_project__',
        task.userId,
      );
      // 注册活跃 executor: 供协议事件(step/question)回执恢复
      this.activeExecutors.set(taskId, agent);

      // 4. 执行 Agent
      const inputStr = typeof task.input === 'string'
        ? task.input
        : JSON.stringify(task.input ?? {});

      const generator = agent.execute(
        inputStr,
        task.projectId || '__no_project__',
        task.userId,
      );

      let finalOutput = '';
      let iterationCount = 0;

      for await (const event of generator) {
        iterationCount++;

        // 将 AgentExecutor 的事件映射为 SSE 事件
        switch (event.type) {
          case 'agent:step':
            this.sseService.emitThinking(taskId, (event.data as any)?.message ?? '');
            break;
          case 'agent:message_delta':
            this.sseService.emitMessageDelta(taskId, (event.data as any)?.delta ?? '');
            break;
          case 'agent:thinking_delta':
            this.sseService.emitThinkingDelta(taskId, (event.data as any)?.delta ?? '');
            break;
          case 'agent:tool_call':
            this.sseService.emitToolCall(
              taskId,
              (event.data as any)?.toolName ?? '',
              (event.data as any)?.arguments ?? {},
            );
            // 会话内：写入工具调用消息
            if (task.conversationId) {
              void this.writeMessage(task, {
                role: 'assistant',
                content: `调用工具 ${(event.data as any)?.toolName ?? ''}`,
                toolName: (event.data as any)?.toolName ?? '',
                toolArguments: JSON.stringify((event.data as any)?.arguments ?? {}),
              });
            }
            break;
          case 'agent:tool_result': {
            const resultData = (event.data as any)?.result;
            // 死路径修复(Plan#33 D4): 工具返回的 canvasOps 逐个 emit,前端 onCanvasOp 真执行
            // 此前 agent-executor 只 yield tool_result,worker 从不消费 canvasOps → 前端画布操作从未生效
            const canvasOps = Array.isArray(resultData?.canvasOps) ? resultData.canvasOps : [];
            for (const cop of canvasOps) {
              if (cop && typeof cop.op === 'string') {
                this.sseService.emitCanvasOp(taskId, cop.op, cop.args ?? {});
              }
            }
            this.sseService.emitResult(taskId, event.data);
            break;
          }
          case 'agent:progress':
            this.sseService.emitProgress(
              taskId,
              Math.min(90, ((event.data as any)?.iteration ?? 5) * 10),
            );
            break;
          case 'agent:step_request':
            this.sseService.emitStepRequest(taskId, (event.data as any)?.step ?? event.data);
            break;
          case 'agent:question_request':
            this.sseService.emitQuestionRequest(taskId, (event.data as any)?.question ?? event.data);
            break;
          case 'agent:md':
            this.sseService.emitMd(taskId, (event.data as any)?.md ?? '');
            break;
          case 'agent:complete': {
            const completeData = event.data as any;
            finalOutput = completeData?.output ?? '';
            this.sseService.emitResult(taskId, completeData);
            // 会话内：写入最终回复
            if (task.conversationId) {
              void this.writeMessage(task, { role: 'assistant', content: finalOutput });
            }
            break;
          }
          case 'agent:error':
            this.sseService.emitError(taskId, (event.data as any)?.error ?? '未知错误');
            // 会话内：写入错误消息
            if (task.conversationId) {
              void this.writeMessage(task, {
                role: 'assistant',
                content: `执行出错：${(event.data as any)?.error ?? '未知错误'}`,
              });
            }
            break;
        }

        // 检查是否被取消
        const currentTask = await this.taskService.getTask(taskId);
        if (currentTask.status === 'cancelled') {
          this.sseService.emitError(taskId, '任务已被取消');
          return;
        }
      }

      // 5. 更新任务为 completed
      await this.taskService.updateTask(taskId, {
        status: 'completed',
        output: { output: finalOutput, iterations: iterationCount },
        progress: 100,
        completedAt: new Date(),
      });

      // 6. 推送 done 事件
      this.sseService.emitDone(taskId, { output: finalOutput, iterations: iterationCount });

      // 7. 持久化到 Project Memory（如果有关联项目）
      if (task.projectId) {
        await this.persistProjectMemory(task, finalOutput, iterationCount).catch((err) => {
          this.logger.warn(`Project Memory 持久化失败: ${task.projectId}`, err);
        });
      }

      // 8. 会话内任务收尾：触发记忆压缩（超预算时折叠历史）
      await this.conversationService.maybeCompact(task.conversationId);
    } catch (err) {
      const errorMessage = (err as Error).message;

      this.logger.error(`Agent 任务执行失败: ${taskId}`, (err as Error).stack);

      // 更新任务为 failed
      await this.taskService.updateTask(taskId, {
        status: 'failed',
        error: errorMessage,
        completedAt: new Date(),
      });

      // 推送 error 事件
      this.sseService.emitError(taskId, errorMessage);

      // 会话内任务失败也触发记忆压缩
      await this.conversationService.maybeCompact(task.conversationId);
    } finally {
      this.runningTasks.delete(taskId);
      this.activeExecutors.delete(taskId);
      this.sseService.close(taskId);
      AgentWorkerService.releaseSlot();
    }
  }

  /**
   * 协议事件回执恢复(Plan#33 D1): 前端对 step/question 的回答通过
   * POST /api/agents/tasks/:id/answer 提交,此处注入到挂起的 executor。
   * 返回 false 表示任务已结束或不存在(前端无需特殊处理)。
   */
  resumeExecutor(taskId: string, answer: string): boolean {
    const executor = this.activeExecutors.get(taskId);
    if (!executor) return false;
    return executor.resumeWithAnswer(answer);
  }

  /** 获取并发槽位: 未满直接占用, 已满入队等待 */
  private static acquireSlot(): Promise<void> {
    if (AgentWorkerService.activeTaskCount < AgentWorkerService.MAX_CONCURRENT_TASKS) {
      AgentWorkerService.activeTaskCount++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      AgentWorkerService.taskWaiters.push(() => {
        AgentWorkerService.activeTaskCount++;
        resolve();
      });
    });
  }

  /** 释放并发槽位: 唤醒下一个排队任务 */
  private static releaseSlot(): void {
    AgentWorkerService.activeTaskCount--;
    const next = AgentWorkerService.taskWaiters.shift();
    if (next) next();
  }

  /**
   * 分镜生成分块编排任务执行(Plan#9)
   *
   * 由 AgentOrchestrator 分块编排: 切块 → 每块独立子任务(并发) → 汇总合并。
   * 事件映射与 executeTask 一致, output 为 { shots, blocks } 对象。
   */
  private async executeStoryboardGenerate(task: any): Promise<void> {
    const taskId = task.id;
    const startTime = Date.now();

    try {
      await this.taskService.updateTask(taskId, { status: 'running', progress: 0 });
      this.sseService.emitThinking(taskId, '开始分镜分块生成...');

      const input = typeof task.input === 'string' ? JSON.parse(task.input) : (task.input ?? {});
      const generator = this.orchestrator.orchestrateStoryboardGenerate(
        taskId,
        task.projectId || '__no_project__',
        task.userId,
        input,
      );

      let finalOutput: any = null;
      let iterationCount = 0;

      for await (const event of generator) {
        iterationCount++;

        switch (event.type) {
          case 'agent:step':
            this.sseService.emitThinking(taskId, (event.data as any)?.message ?? '');
            break;
          case 'agent:message_delta':
            this.sseService.emitMessageDelta(taskId, (event.data as any)?.delta ?? '');
            break;
          case 'agent:thinking_delta':
            this.sseService.emitThinkingDelta(taskId, (event.data as any)?.delta ?? '');
            break;
          case 'agent:progress':
            this.sseService.emitProgress(
              taskId,
              (event.data as any)?.progress ?? 0,
              (event.data as any)?.message,
            );
            break;
          case 'agent:complete': {
            const completeData = event.data as any;
            finalOutput = completeData?.output ?? null;
            this.sseService.emitResult(taskId, completeData);
            break;
          }
          case 'agent:error':
            this.sseService.emitError(taskId, (event.data as any)?.error ?? '未知错误');
            break;
        }

        // 检查是否被取消
        const currentTask = await this.taskService.getTask(taskId);
        if (currentTask.status === 'cancelled') {
          this.sseService.emitError(taskId, '任务已被取消');
          return;
        }
      }

      // 未产出 finalOutput 视为失败(如全部块失败时编排器只推 error)
      if (!finalOutput) {
        await this.taskService.updateTask(taskId, {
          status: 'failed',
          error: '分镜分块生成失败',
          completedAt: new Date(),
        });
        return;
      }

      await this.taskService.updateTask(taskId, {
        status: 'completed',
        output: { output: finalOutput, iterations: iterationCount },
        progress: 100,
        completedAt: new Date(),
      });
      this.sseService.emitDone(taskId, { output: finalOutput, iterations: iterationCount });

      this.logger.log(
        `分镜分块任务完成: ${taskId}, ${finalOutput?.shots?.length ?? 0} 镜头, ${(finalOutput?.blocks?.failed ?? []).length} 失败块, 耗时 ${Date.now() - startTime}ms`,
      );
    } catch (err) {
      const errorMessage = (err as Error).message;
      this.logger.error(`分镜分块任务执行失败: ${taskId}`, (err as Error).stack);
      await this.taskService.updateTask(taskId, {
        status: 'failed',
        error: errorMessage,
        completedAt: new Date(),
      });
      this.sseService.emitError(taskId, errorMessage);
    } finally {
      this.sseService.close(taskId);
    }
  }

  /**
   * 是否正在执行某个任务
   */
  isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  /**
   * 获取当前运行中的任务数
   */
  get runningCount(): number {
    return this.runningTasks.size;
  }

  /**
   * 会话内写入消息（失败仅告警，不阻塞主流程）
   */
  private async writeMessage(
    task: any,
    input: { role: string; content: string; toolName?: string; toolArguments?: string },
  ): Promise<void> {
    try {
      await this.conversationService.addMessage({
        conversationId: task.conversationId,
        role: input.role,
        content: input.content,
        taskId: task.id,
        toolName: input.toolName,
        toolArguments: input.toolArguments,
      });
    } catch (err) {
      this.logger.warn(`会话消息写入失败: ${task.conversationId}`, (err as Error).message);
    }
  }

  /**
   * 将任务执行结果持久化到 Project Memory
   * 存储为 AgentTask 的 output 扩展字段，供后续同一项目的 Agent 调取历史记忆
   */
  private async persistProjectMemory(
    task: any,
    finalOutput: string,
    iterationCount: number,
  ): Promise<void> {
    if (!task.projectId) return;

    const memoryEntry = {
      type: 'agent_memory',
      taskId: task.id,
      taskType: task.taskType,
      input: task.input,
      output: finalOutput,
      iterations: iterationCount,
      status: 'completed',
      timestamp: new Date().toISOString(),
    };

    // 将记忆快照写入任务 output 的 _memory 字段
    await this.taskService.updateTask(task.id, {
      output: {
        output: finalOutput,
        iterations: iterationCount,
        _memory: memoryEntry,
      },
    });

    this.logger.log(`Project Memory 已持久化: projectId=${task.projectId}, taskType=${task.taskType}`);
  }

  /**
   * 获取指定项目的所有历史记忆
   * 用于 Agent 启动时注入上下文
   */
  async getProjectMemories(projectId: string): Promise<any[]> {
    const tasks = await this.prisma.agentTask.findMany({
      where: {
        projectId,
        status: 'completed',
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return tasks
      .filter((t) => {
        const output = t.output as any;
        return output?._memory != null;
      })
      .map((t) => {
        const output = t.output as any;
        return output._memory;
      });
  }
}