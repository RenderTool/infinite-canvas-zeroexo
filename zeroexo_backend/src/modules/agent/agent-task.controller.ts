/**
 * agent-task.controller - 统一 Agent API 控制器
 *
 * 提供统一的任务执行入口和 SSE 流式推送端点。
 * 路由前缀: /api/agents
 *
 * 端点:
 *   POST /api/agents/execute  - 提交 Agent 任务
 *   GET  /api/agents/stream/:taskId - SSE 事件流
 *   GET  /api/agents/tasks    - 查询任务列表
 *   GET  /api/agents/tasks/:id - 查询单个任务
 *   POST /api/agents/tasks/:id/cancel - 取消任务
 */

import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  Sse,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentTaskService } from './agent-task.service';
import { AgentWorkerService } from './agent-worker.service';
import { AgentSSEService, AgentSSEEvent } from './agent-sse.service';

export class ExecuteAgentDto {
  taskType!: string;
  input!: any;
  projectId?: string;
  conversationId?: string;
  config?: {
    model?: string;
    channel?: string;
  };
}

export class TaskListQueryDto {
  status?: string;
  taskType?: string;
  projectId?: string;
  limit?: number;
  offset?: number;
}

/** SSE MessageEvent 结构 */
interface SseMessageEvent {
  data: AgentSSEEvent;
  type: string;
  id?: string;
}

@Controller('agents')
@UseGuards(AuthGuard('jwt'))
export class AgentTaskController {
  private readonly logger = new Logger(AgentTaskController.name);

  constructor(
    private readonly taskService: AgentTaskService,
    private readonly workerService: AgentWorkerService,
    private readonly sseService: AgentSSEService,
  ) {}

  /**
   * 提交 Agent 任务
   * POST /api/agents/execute
   *
   * 创建任务记录，异步执行 Agent，返回 taskId 和 streamUrl 供前端连接 SSE
   */
  @Post('execute')
  async execute(
    @Body() dto: ExecuteAgentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ taskId: string; streamUrl: string }> {
    this.logger.log(`提交 Agent 任务: type=${dto.taskType}, userId=${user.id}`);

    // 1. 创建任务记录
    const task = await this.taskService.createTask({
      userId: user.id,
      taskType: dto.taskType,
      input: dto.input,
      projectId: dto.projectId,
      conversationId: dto.conversationId,
    });

    // 2. 异步执行任务（不 await）
    this.workerService.executeTask(task.id).catch((err) => {
      this.logger.error(`异步任务执行失败: ${task.id}`, err);
    });

    // 3. 返回 taskId 和 streamUrl
    const streamUrl = `/api/agents/stream/${task.id}`;

    return { taskId: task.id, streamUrl };
  }

  /**
   * SSE 事件流
   * GET /api/agents/stream/:taskId
   *
   * 前端通过 EventSource 连接此端点，接收 agent:thinking / agent:tool_call / agent:result 等事件
   */
  @Get('stream/:taskId')
  @Sse()
  stream(
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthUser,
  ): Observable<SseMessageEvent> {
    this.logger.log(`SSE 连接: taskId=${taskId}, userId=${user.id}`);

    const observable = this.sseService.subscribe(taskId);

    return observable.pipe(
      map((event: AgentSSEEvent) => ({
        data: event,
        type: event.type,
        id: event.taskId,
      })),
    );
  }

  /**
   * 查询任务列表
   * GET /api/agents/tasks
   */
  @Get('tasks')
  async listTasks(
    @Query() query: TaskListQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.taskService.listTasks(user.id, {
      status: query.status,
      taskType: query.taskType,
      projectId: query.projectId,
      limit: query.limit,
      offset: query.offset,
    });
  }

  /**
   * 查询单个任务
   * GET /api/agents/tasks/:id
   */
  @Get('tasks/:id')
  async getTask(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    const task = await this.taskService.getTask(id);
    // 权限校验：只能查看自己的任务
    if (task.userId !== user.id && user.role !== 'admin') {
      throw new Error('无权查看此任务');
    }
    return task;
  }

  /**
   * 取消任务
   * POST /api/agents/tasks/:id/cancel
   */
  @Post('tasks/:id/cancel')
  async cancelTask(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    const task = await this.taskService.getTask(id);
    // 权限校验：只能取消自己的任务
    if (task.userId !== user.id && user.role !== 'admin') {
      throw new Error('无权取消此任务');
    }

    return this.taskService.cancelTask(id);
  }
}