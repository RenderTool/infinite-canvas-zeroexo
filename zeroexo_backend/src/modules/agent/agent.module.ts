/**
 * agent.module - Agent 模块
 *
 * 提供 AI Agent 执行框架,包含 Agent 工厂、执行器、编排器、工具注册表。
 * 依赖:
 *   - AiEventsModule(用于 SSE 事件推送)
 *   - ApiProvidersModule(用于 LLM 调用)
 *   - AssetsModule(用于 ai_image / list_existing_assets 工具)
 *   - AiGenerateModule(用于 ai_image / ai_audio 工具的提交)
 */

import { Module } from '@nestjs/common';
import { AiEventsModule } from '../ai-events/ai-events.module';
import { ApiProvidersModule } from '../api-providers/api-providers.module';
import { AssetsModule } from '../assets/assets.module';
import { AiGenerateModule } from '../ai-generate/ai-generate.module';
import { AgentController } from './agent.controller';
import { AgentTaskController } from './agent-task.controller';
import { AgentFactory, LLM_SERVICE_TOKEN } from './agent-factory';
import { AgentOrchestrator } from './orchestrator';
import { AgentLlmService } from './agent-llm.service';
import { AgentTaskService } from './agent-task.service';
import { AgentSSEService } from './agent-sse.service';
import { AgentWorkerService } from './agent-worker.service';
import { CanvasOpExecutorService } from './canvas-op-executor.service';

@Module({
  imports: [
    AiEventsModule,
    ApiProvidersModule,
    AssetsModule,
    AiGenerateModule,
  ],
  controllers: [
    AgentController,
    AgentTaskController,
  ],
  providers: [
    AgentFactory,
    AgentOrchestrator,
    AgentLlmService,
    AgentTaskService,
    AgentSSEService,
    AgentWorkerService,
    CanvasOpExecutorService,
    { provide: LLM_SERVICE_TOKEN, useClass: AgentLlmService },
  ],
  exports: [
    AgentFactory,
    AgentOrchestrator,
    AgentTaskService,
    AgentSSEService,
    AgentWorkerService,
    CanvasOpExecutorService,
  ],
})
export class AgentModule {}
