/**
 * agent.controller - Agent 执行与编排控制器
 *
 * 提供 RESTful 端点,通过 SSE 流式返回 Agent 执行过程事件。
 * 路由前缀: /api/artifacts/:artifactId/agents
 */

import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  Sse,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentFactory } from './agent-factory';
import { AgentOrchestrator } from './orchestrator';
import { ExecuteAgentDto, OrchestrateDto, AgentEvent } from './dto/agent.dto';

/**
 * SSE MessageEvent 结构
 */
interface SseMessageEvent {
  data: AgentEvent;
  type: string;
  id?: string;
}

@Controller('artifacts/:artifactId/agents')
@UseGuards(AuthGuard('jwt'))
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly agentFactory: AgentFactory,
    private readonly orchestrator: AgentOrchestrator,
  ) {}

  /**
   * 执行单个 Agent
   * POST /api/artifacts/:artifactId/agents/execute
   *
   * 返回 SSE 流,包含 agent:step / agent:tool_call / agent:tool_result / agent:complete / agent:error 事件
   */
  @Post('execute')
  @Sse()
  async execute(
    @Param('artifactId') artifactId: string,
    @Body() dto: ExecuteAgentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Observable<SseMessageEvent>> {
    this.logger.log(`执行 Agent: ${dto.agentType} (artifactId=${artifactId}, userId=${user.id})`);

    const agent = await this.agentFactory.create(
      dto.agentType,
      artifactId,
      user.id,
    );

    return new Observable<SseMessageEvent>((subscriber) => {
      const run = async () => {
        try {
          const generator = agent.execute(dto.input, artifactId, user.id);
          for await (const event of generator) {
            subscriber.next({
              data: event,
              type: event.type,
            });
          }
          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        }
      };
      run();
    });
  }

  /**
   * 执行 Agent 编排流水线
   * POST /api/artifacts/:artifactId/agents/orchestrate
   *
   * 按步骤顺序执行多个 Agent,返回 SSE 流
   */
  @Post('orchestrate')
  @Sse()
  async orchestrate(
    @Param('artifactId') artifactId: string,
    @Body() dto: OrchestrateDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Observable<SseMessageEvent>> {
    this.logger.log(
      `编排 Agent: ${dto.steps.map((s) => s.agentType).join(' -> ')} (artifactId=${artifactId})`,
    );

    return new Observable<SseMessageEvent>((subscriber) => {
      const run = async () => {
        try {
          const generator = this.orchestrator.orchestrate(
            artifactId,
            dto.steps,
            user.id,
          );
          for await (const event of generator) {
            subscriber.next({
              data: event,
              type: event.type,
            });
          }
          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        }
      };
      run();
    });
  }
}
