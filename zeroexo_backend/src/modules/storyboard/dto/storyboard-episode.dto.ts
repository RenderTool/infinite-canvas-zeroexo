import {
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 分镜按集生成请求 DTO - Phase 4
 */
export class StoryboardEpisodeDto {
  @ApiProperty({ description: '单集剧本内容(纯文本或 HTML)' })
  @IsString()
  @MinLength(1)
  episodeContent!: string;

  @ApiProperty({ example: 1, description: '集号' })
  @IsNumber()
  @Min(1)
  episodeNumber!: number;

  @ApiProperty({ example: '第一集', description: '集标题' })
  @IsString()
  @MinLength(1)
  episodeTitle!: string;

  @ApiPropertyOptional({ description: '提示词模板 ID(从 zeroexo-prompt 加载)' })
  @IsOptional()
  @IsString()
  templateId?: string;

  @ApiPropertyOptional({ description: 'AI 渠道 ID(不传则用默认渠道)' })
  @IsOptional()
  @IsString()
  providerId?: string;

  @ApiPropertyOptional({ example: 'gpt-4o', description: '模型名' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({
    description: '额外生成参数',
    example: { temperature: 0.7, maxTokens: 16384 },
  })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}

/** 分镜镜头响应中的单镜头 */
export class ShotResponse {
  id!: string;
  number!: number;
  sceneId!: string;
  dayNight!: string;
  duration!: number;
  description!: string;
  shotType!: string;
  cameraMovement!: string;
  dialogue!: string;
  voiceoverText!: string;
  monologue!: string;
  sfx!: string[];
  entities!: Array<{ entityId: string; mention: string }>;
  emotion!: string;
  lighting!: { keyLight: string; colorTemp: string; mood: string };
  environment!: { location: string; time: string; weather: string };
  continuity!: { transition: string };
  prompt!: string;

  /** 视频提示词生成 - 图片生成提示词(用于首帧/尾帧/宫格图) */
  imagePrompt?: string;

  /** 视频提示词生成 - 视频生成提示词(用于图生视频/文生视频) */
  videoPrompt?: string;
}

/** 分镜按集生成响应 */
export class StoryboardEpisodeResponse {
  episodeNumber!: number;
  episodeTitle!: string;
  shots!: ShotResponse[];
  usage!: {
    costTokens?: number;
    costMs?: number;
    model: string;
  };
}