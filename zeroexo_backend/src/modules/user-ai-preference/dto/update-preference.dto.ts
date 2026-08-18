import { IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 用户级 AI 配置 DTO
 * - 默认模型字段使用 providerId::modelId 格式
 * - 并发字段约束在 [1, 20]
 * - capabilityDefaults 形如 { text: {...}, image: {...}, video: {...}, audio: {...} }
 */
export class UpdateUserAiPreferenceDto {
  @ApiPropertyOptional({ example: 'claude-provider-uuid::claude-3-5-sonnet', description: '分析(LLM)默认模型' })
  @IsOptional()
  @IsString()
  analysisModel?: string;

  @ApiPropertyOptional({ example: 'gemini-provider-uuid::gemini-2.5-pro', description: '角色生成默认模型' })
  @IsOptional()
  @IsString()
  characterModel?: string;

  @ApiPropertyOptional({ example: 'gemini-provider-uuid::gemini-2.5-pro', description: '场景生成默认模型' })
  @IsOptional()
  @IsString()
  locationModel?: string;

  @ApiPropertyOptional({ example: 'veo-provider-uuid::veo-3.0', description: '视频生成默认模型' })
  @IsOptional()
  @IsString()
  videoModel?: string;

  @ApiPropertyOptional({ example: 'tts-provider-uuid::tts-1', description: '音频生成默认模型' })
  @IsOptional()
  @IsString()
  audioModel?: string;

  @ApiPropertyOptional({ example: 3, description: '分析任务并发数(1-20)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  analysisConcurrency?: number;

  @ApiPropertyOptional({ example: 2, description: '图片生成并发数(1-20)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  imageConcurrency?: number;

  @ApiPropertyOptional({ example: 1, description: '视频生成并发数(1-20)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  videoConcurrency?: number;

  @ApiPropertyOptional({
    example: { image: { resolution: '1024x1024' }, video: { duration: 5 } },
    description: '按能力类型的默认参数',
  })
  @IsOptional()
  @IsObject()
  capabilityDefaults?: Record<string, unknown>;
}
