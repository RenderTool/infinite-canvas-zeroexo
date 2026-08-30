import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * 视频提示词生成 - 单镜头输入 DTO
 */
export class EntityInputDto {
  @ApiProperty({ description: '主体名称' })
  @IsString()
  name!: string;

  @ApiProperty({ description: '主体类型: character | prop | scene' })
  @IsString()
  kind!: string;

  @ApiProperty({ description: '主体外观描述' })
  @IsString()
  description!: string;

  @ApiPropertyOptional({ description: '主体形象图存储 key' })
  @IsOptional()
  @IsString()
  imageKey?: string;

  @ApiPropertyOptional({ description: '身份锚点句(圣经不变量,逐字复用,优先于 description)' })
  @IsOptional()
  @IsString()
  anchorSentence?: string;

  @ApiPropertyOptional({ description: '当前引用状态名(主体状态细分,如 少年/白发/重伤)' })
  @IsOptional()
  @IsString()
  stateName?: string;
}

export class ShotInputDto {
  @ApiProperty({ description: '分镜画面描述' })
  @IsString()
  description!: string;

  @ApiProperty({ description: '镜头类型: 特写/中景/远景等' })
  @IsString()
  shotType!: string;

  @ApiProperty({ description: '运镜: 固定/推/拉/摇/移/跟等' })
  @IsString()
  cameraMovement!: string;

  @ApiPropertyOptional({ description: '台词', default: '' })
  @IsOptional()
  @IsString()
  dialogue?: string;

  @ApiPropertyOptional({ description: '旁白', default: '' })
  @IsOptional()
  @IsString()
  voiceoverText?: string;

  @ApiPropertyOptional({ description: '内心独白', default: '' })
  @IsOptional()
  @IsString()
  monologue?: string;

  @ApiPropertyOptional({ description: '音效', default: [] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sfx?: string[];

  @ApiProperty({ description: '情绪基调' })
  @IsString()
  emotion!: string;

  @ApiPropertyOptional({ description: '照明描述', default: '' })
  @IsOptional()
  @IsString()
  lighting?: string;

  @ApiPropertyOptional({ description: '环境描述', default: '' })
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiPropertyOptional({ description: '主体信息', default: [] })
  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  entities?: EntityInputDto[];

  @ApiProperty({ description: '镜头时长(秒)', example: 5 })
  @IsNumber()
  @Min(1)
  duration!: number;

  @ApiPropertyOptional({ description: '参考素材 storageKey 列表(生成时自动 @图片N 占位,顺序对应 referenceImages)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  referenceKeys?: string[];
}

/**
 * 视频提示词生成结果
 */
export class VideoPromptResultDto {
  @ApiProperty({ description: '图片生成提示词(用于首帧/尾帧/宫格图)' })
  imagePrompt!: string;

  @ApiProperty({ description: '视频生成提示词(用于图生视频/文生视频)' })
  videoPrompt!: string;

  @ApiProperty({ description: '负面提示词(约束模型避免生成不良画面)' })
  negativePrompt!: string;

  @ApiProperty({ description: '推荐画幅比(基于景别映射)', example: '16:9' })
  aspectRatio!: string;
}