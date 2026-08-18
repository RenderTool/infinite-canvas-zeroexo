/**
 * agent-worker.standalone - 独立 Agent Worker 进程
 *
 * 独立进程入口，不与主进程共享内存。
 * 从任务队列拉取 pending 任务并执行，通过数据库实现进程间通信。
 *
 * 启动方式: npx ts-node src/modules/agent/agent-worker.standalone.ts
 * 或: node dist/modules/agent/agent-worker.standalone.js
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiEventsModule } from '../ai-events/ai-events.module';
import { ApiProvidersModule } from '../api-providers/api-providers.module';
import { AssetsModule } from '../assets/assets.module';
import { AiGenerateModule } from '../ai-generate/ai-generate.module';
import { AgentFactory, LLM_SERVICE_TOKEN } from './agent-factory';
import { AgentLlmService } from './agent-llm.service';
import { AgentTaskService } from './agent-task.service';
import { AgentSSEService } from './agent-sse.service';
import { AgentWorkerService } from './agent-worker.service';

const POLL_INTERVAL_MS = 5000;
const MAX_CONCURRENT_TASKS = 3;

@Module({
  imports: [
    AiEventsModule,
    ApiProvidersModule,
    AssetsModule,
    AiGenerateModule,
  ],
  providers: [
    PrismaService,
    AgentFactory,
    AgentLlmService,
    AgentTaskService,
    AgentSSEService,
    AgentWorkerService,
    { provide: LLM_SERVICE_TOKEN, useClass: AgentLlmService },
  ],
})
class StandaloneWorkerModule {}

async function bootstrap(): Promise<void> {
  const logger = new Logger('AgentWorkerStandalone');
  logger.log('独立 Agent Worker 进程启动');

  const app = await NestFactory.createApplicationContext(StandaloneWorkerModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  const workerService = app.get(AgentWorkerService);
  const prisma = app.get(PrismaService);

  let running = true;

  // 处理信号，优雅退出
  process.on('SIGINT', () => {
    logger.log('收到 SIGINT 信号，正在优雅退出...');
    running = false;
  });
  process.on('SIGTERM', () => {
    logger.log('收到 SIGTERM 信号，正在优雅退出...');
    running = false;
  });

  logger.log(`Worker 配置: 轮询间隔=${POLL_INTERVAL_MS}ms, 最大并发=${MAX_CONCURRENT_TASKS}`);

  // 主循环：轮询任务队列
  while (running) {
    try {
      const currentRunning = workerService.runningCount;

      if (currentRunning < MAX_CONCURRENT_TASKS) {
        const slotsAvailable = MAX_CONCURRENT_TASKS - currentRunning;

        // 查找 pending 任务（不跨进程共享内存，依赖数据库状态）
        const pendingTasks = await prisma.agentTask.findMany({
          where: { status: 'pending' },
          orderBy: { createdAt: 'asc' },
          take: slotsAvailable,
        });

        for (const task of pendingTasks) {
          logger.log(`拉取到待执行任务: ${task.id}, type=${task.taskType}`);

          // 异步执行，不阻塞轮询
          workerService.executeTask(task.id).catch((err) => {
            logger.error(`任务执行失败: ${task.id}`, err);
          });
        }
      }
    } catch (err) {
      logger.error('轮询任务队列异常', err);
    }

    // 等待轮询间隔
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  logger.log('Worker 进程退出');
  await app.close();
  process.exit(0);
}

bootstrap().catch((err) => {
  console.error('Worker 启动失败:', err);
  process.exit(1);
});