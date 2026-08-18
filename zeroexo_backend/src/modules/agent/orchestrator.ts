/**
 * orchestrator - Agent 编排器
 *
 * 按顺序执行一系列 Agent 步骤,每一步的输出作为下一步的上下文输入,
 * 通过 AsyncGenerator 向上层推送所有中间事件。
 */

import { Injectable, Logger } from '@nestjs/common';
import { AgentEvent } from './dto/agent.dto';
import { AgentFactory } from './agent-factory';

export interface OrchestrationStep {
  agentType: string;
  input?: string;
}

@Injectable()
export class AgentOrchestrator {
  private readonly logger = new Logger(AgentOrchestrator.name);

  constructor(private readonly agentFactory: AgentFactory) {}

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
}
