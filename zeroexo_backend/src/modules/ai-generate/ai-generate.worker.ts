import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiGenerateService } from './ai-generate.service';
import { AiEventsService } from '../ai-events/ai-events.service';

@Injectable()
export class AiGenerateWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(AiGenerateWorker.name);
  /** 防并发标志 */
  private polling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiGenerateService: AiGenerateService,
    private readonly aiEventsService: AiEventsService,
  ) {}

  /** 启动时重置所有 stuck 在 running 状态的任务为 pending */
  async onApplicationBootstrap() {
    const { count } = await this.prisma.aiGeneration.updateMany({
      where: { status: 'running' },
      data: { status: 'pending' },
    });
    if (count > 0) {
      this.logger.warn(`重置了 ${count} 个异常中断的生成任务为 pending`);
    }
  }

  /** 每秒轮询，公平调度取出下一个 pending 任务 */
  @Interval(1000)
  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const taskId = await this.dequeueNextTask();
      if (taskId) {
        await this.processTask(taskId);
      }
    } finally {
      this.polling = false;
    }
  }

  /** 公平调度：同用户串行，不同用户轮转 */
  private async dequeueNextTask(): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows: Array<{ id: string }> = await tx.$queryRawUnsafe(`
        SELECT id FROM "AiGeneration"
        WHERE status = 'pending'
          AND "ownerId" NOT IN (
            SELECT "ownerId" FROM "AiGeneration" WHERE status = 'running'
          )
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);
      if (rows.length === 0) return null;
      const taskId = rows[0].id;
      await tx.aiGeneration.update({
        where: { id: taskId },
        data: { status: 'running' },
      });
      return taskId;
    });
  }

  /** 处理单个任务 + 推送 SSE 结果 */
  private async processTask(taskId: string) {
    try {
      // 先查一下记录拿到 ownerId（用于后面推送事件）
      const gen = await this.prisma.aiGeneration.findUnique({
        where: { id: taskId },
        select: { id: true, ownerId: true },
      });
      if (!gen) return;

      await this.aiGenerateService.processPendingTask(taskId);

      // 查询最终状态并推送对应事件
      const result = await this.prisma.aiGeneration.findUnique({
        where: { id: taskId },
      });
      if (!result) return;

      // cancelled 状态已由 cancelTask 广播 SSE 事件，此处不重复广播
      // 避免前端收到两次 cancelled（cancelTask 立即广播 + worker 完成后再次广播）
      if (result.status === 'cancelled') {
        this.logger.log(
          `任务 ${taskId} 已被取消，跳过 worker SSE 广播`,
        );
        return;
      }

      if (result.status === 'success') {
        this.aiEventsService.broadcast({
          type: 'ai_generation_completed',
          userId: result.ownerId,
          resourceId: taskId,
          timestamp: Date.now(),
          meta: {
            status: 'success',
            generationId: taskId,
            // url 等前端需要的数据在 result.params 的 _resultUrl 等字段中
            url: (result.params as Record<string, any>)?._resultUrl,
          },
        });
      } else if (result.status === 'failed') {
        this.aiEventsService.broadcast({
          type: 'ai_generation_completed',
          userId: result.ownerId,
          resourceId: taskId,
          timestamp: Date.now(),
          meta: {
            status: 'failed',
            generationId: taskId,
            errorMessage: result.errorMessage,
          },
        });
      }
    } catch (err) {
      this.logger.error(
        `处理任务 ${taskId} 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
      // processPendingTask 内部已经处理了 failed 状态更新
      // 这里再查一次记录推送失败事件
      const gen = await this.prisma.aiGeneration.findUnique({
        where: { id: taskId },
      });
      if (!gen) return;

      // cancelled 状态已由 cancelTask 广播，此处不重复
      if (gen.status === 'cancelled') {
        this.logger.log(
          `任务 ${taskId} 已被取消，跳过 worker SSE 广播`,
        );
        return;
      }

      this.aiEventsService.broadcast({
        type: 'ai_generation_completed',
        userId: gen.ownerId,
        resourceId: taskId,
        timestamp: Date.now(),
        meta: {
          status: 'failed',
          generationId: taskId,
          errorMessage: gen.errorMessage,
        },
      });
    }
  }
}
