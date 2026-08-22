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
import { Allow, IsInt, IsObject, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentTaskService } from './agent-task.service';
import { AgentWorkerService } from './agent-worker.service';
import { AgentSSEService, AgentSSEEvent } from './agent-sse.service';
import { AgentConversationService } from './agent-conversation.service';

export class ExecuteAgentDto {
  /** 任务类型(script_writer | storyboard_assistant | canvas_agent | ...) */
  @IsString()
  @MinLength(1)
  taskType!: string;

  /** 任意结构化输入(JSON),全局 whitelist 下需 @Allow 保留 */
  @Allow()
  input?: any;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsOptional()
  @IsObject()
  config?: {
    model?: string;
    channel?: string;
  };
}

export class TaskListQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  taskType?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** 协议事件回执 DTO(Plan#33 D1) */
export class AnswerTaskDto {
  /** 用户对 step/question 的回答(选项值/自定义文本/空串=跳过) */
  @IsString()
  answer!: string;
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
    private readonly conversationService: AgentConversationService,
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

    // 1.5 会话内发起：把用户消息写入会话历史（刷新后前端可恢复上下文）
    if (dto.conversationId) {
      await this.conversationService.addMessage({
        conversationId: dto.conversationId,
        role: 'user',
        content: typeof dto.input === 'string' ? dto.input : JSON.stringify(dto.input ?? {}),
        taskId: task.id,
      }).catch((err) => {
        this.logger.warn(`会话消息写入失败: ${dto.conversationId}`, (err as Error).message);
      });
    }

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

  /**
   * 协议事件回执(Plan#33 D1)
   * POST /api/agents/tasks/:id/answer
   *
   * 前端对 step/question 契约事件的回答(选择/跳过/自定义输入)提交到此处,
   * 恢复挂起的 Agent 执行循环。taskId 由前端从 SSE 事件中获取。
   */
  @Post('tasks/:id/answer')
  async answerTask(
    @Param('id') id: string,
    @Body() dto: AnswerTaskDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ ok: boolean }> {
    const task = await this.taskService.getTask(id);
    // 权限校验：只能回执自己的任务
    if (task.userId !== user.id && user.role !== 'admin') {
      throw new Error('无权回执此任务');
    }

    const resumed = this.workerService.resumeExecutor(id, dto.answer);
    return { ok: resumed };
  }
}