import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 格式化章节请求 DTO
 */
export class FormatChaptersDto {
  @ApiProperty({ description: 'zeroexo-text 资产 ID' })
  @IsString()
  @MinLength(1)
  zeroexoTextAssetId!: string;

  @ApiProperty({ description: 'AI 模型 ID' })
  @IsString()
  @MinLength(1)
  modelId!: string;

  @ApiPropertyOptional({ description: '并发数(默认 5, 最大 10)', default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  concurrency?: number;

  @ApiProperty({ description: '选中的单元索引列表', example: [0, 1, 2] })
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  unitIndices!: number[];
}

/**
 * 格式化章节重试请求 DTO
 */
export class FormatChaptersRetryDto {
  @ApiProperty({ description: '原 format-chapters 的 generation ID' })
  @IsString()
  @MinLength(1)
  generationId!: string;

  @ApiPropertyOptional({ description: '要重试的单元索引列表(不传则重试全部失败单元)' })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  unitIndices?: number[];
}

/**
 * 章节单元结果
 */
export interface ChapterUnitResult {
  unitIndex: number;
  title: string;
  content: string;
  cached: boolean;
  costTokens?: number;
  error?: string;
}

/**
 * 格式化章节响应
 */
export interface FormatChaptersResult {
  generationId: string;
  status: 'running' | 'success' | 'partial' | 'failed';
  scriptAssetId?: string;
  totalUnits: number;
  completedUnits: number;
  failedUnits: number;
  results: ChapterUnitResult[];
  costTokens: number;
  createdAt: string;
  updatedAt: string;
}