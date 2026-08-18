import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * AI 生成请求 DTO - P3.3
 * kind 取值: text | image | video | audio
 * providerId 取值: 用户已配置的渠道 id;若不传则使用默认渠道
 */
export class GenerateRequestDto {
  @ApiProperty({
    example: 'image',
    description: '生成类型: text | image | video | audio',
  })
  @IsString()
  @MinLength(1)
  kind!: string;

  @ApiProperty({ example: '一只在月球上散步的猫', description: '提示词' })
  @IsString()
  @MinLength(1)
  prompt!: string;

  @ApiPropertyOptional({ description: '反向提示词' })
  @IsOptional()
  @IsString()
  negativePrompt?: string;

  @ApiProperty({ example: 'dall-e-3', description: '模型名' })
  @IsString()
  @MinLength(1)
  model!: string;

  @ApiPropertyOptional({
    description: '指定渠道 id(不传则用默认渠道)',
  })
  @IsOptional()
  @IsString()
  providerId?: string;

  @ApiPropertyOptional({
    description: '生成参数:size/quality/steps/seed/seconds/voice 等',
    example: { size: '1024x1024', quality: 'standard' },
  })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '关联画布 id(可选,用于溯源)' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ type: [String], description: '生成产物标签' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '是否为测试生成(管理后台使用)', default: false })
  @IsOptional()
  isTest?: boolean;

  @ApiPropertyOptional({
    description: '用户语言(zh/en/ja),用于控制文本生成输出语言',
    default: 'zh',
  })
  @IsOptional()
  @IsString()
  locale?: string;
}
