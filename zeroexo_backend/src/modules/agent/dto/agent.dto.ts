import { IsString, MinLength, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 执行单个 Agent 的请求 */
export class ExecuteAgentDto {
  @ApiProperty({ example: 'researcher', description: 'Agent 类型' })
  @IsString()
  @MinLength(1)
  agentType!: string;

  @ApiProperty({ example: '分析剧本角色关系', description: '输入内容' })
  @IsString()
  input!: string;
}

/** 编排步骤定义 */
export class OrchestrationStepDto {
  @ApiProperty({ description: 'Agent 类型' })
  @IsString()
  @MinLength(1)
  agentType!: string;

  @ApiPropertyOptional({ description: '输入内容(留空则使用上一步输出)' })
  @IsOptional()
  @IsString()
  input?: string;
}

/** 编排请求 */
export class OrchestrateDto {
  @ApiProperty({ type: [OrchestrationStepDto], description: '编排步骤列表' })
  @IsArray()
  @ValidateNested({ each: true })
  steps!: OrchestrationStepDto[];
}

/** SSE Agent 事件负载 */
export interface AgentEvent {
  type: 'agent:step' | 'agent:tool_call' | 'agent:tool_result' | 'agent:progress' | 'agent:complete' | 'agent:error';
  data: unknown;
  timestamp: number;
}
