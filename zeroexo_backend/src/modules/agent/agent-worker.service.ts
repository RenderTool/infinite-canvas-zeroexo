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

@Injectable()
export class AgentWorkerService {
  private readonly logger = new Logger(AgentWorkerService.name);
  private runningTasks = new Map<string, boolean>();

  constructor(
    private readonly agentFactory: AgentFactory,
    private readonly taskService: AgentTaskService,
    private readonly sseService: AgentSSEService,
    private readonly prisma: PrismaService,
    private readonly conversationService: AgentConversationService,
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

    this.runningTasks.set(taskId, true);

    try {
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
          case 'agent:tool_result':
            this.sseService.emitResult(taskId, event.data);
            break;
          case 'agent:progress':
            this.sseService.emitProgress(
              taskId,
              Math.min(90, ((event.data as any)?.iteration ?? 5) * 10),
            );
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