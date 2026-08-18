import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePublicPromptDto {
  @ApiProperty({ example: '摄影风格提示词', description: '提示词标题' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title!: string;

  @ApiProperty({ example: 'A cinematic photo of...', description: '提示词内容' })
  @IsString()
  @MinLength(1)
  @MaxLength(7000)
  content!: string;

  @ApiProperty({ example: 'style', description: '分类: role | scene | style | shot | other' })
  @IsString()
  category!: string;

  @ApiPropertyOptional({ type: [String], description: '标签列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '来源: image-prompt-library | manual' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  source?: string;

  @ApiPropertyOptional({ description: '原始 item id' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sourceId?: string;

  @ApiPropertyOptional({ description: '原始 cluster 名称' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  clusterName?: string;

  @ApiPropertyOptional({ description: '图片信息 [{storageKey, width, height, alt}]' })
  @IsOptional()
  images?: { storageKey: string; width?: number; height?: number; alt?: string }[];

  @ApiPropertyOptional({ description: '多语言标题 { en, zh_hans, zh_hant }' })
  @IsOptional()
  demoTitles?: Record<string, string>;

  @ApiPropertyOptional({ description: '来源项目名称' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sourceName?: string;

  @ApiPropertyOptional({ description: '原文链接' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceUrl?: string;

  @ApiPropertyOptional({ description: '许可证: CC0 | CC BY 4.0 | MIT' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  license?: string;
}

export class UpdatePublicPromptDto {
  @ApiPropertyOptional({ description: '提示词标题' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({ description: '提示词内容' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(7000)
  content?: string;

  @ApiPropertyOptional({ description: '分类' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ type: [String], description: '标签列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '来源' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  source?: string;

  @ApiPropertyOptional({ description: '图片信息' })
  @IsOptional()
  images?: { storageKey: string; width?: number; height?: number; alt?: string }[];

  @ApiPropertyOptional({ description: '多语言标题' })
  @IsOptional()
  demoTitles?: Record<string, string>;

  @ApiPropertyOptional({ description: '来源项目名称' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sourceName?: string;

  @ApiPropertyOptional({ description: '原文链接' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceUrl?: string;

  @ApiPropertyOptional({ description: '许可证' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  license?: string;
}

export class QueryPublicPromptDto {
  @ApiPropertyOptional({ description: '页码(从 1 开始,默认 1)' })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ description: '每页条数(默认 20,最大 1000)' })
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiPropertyOptional({ description: '按分类过滤' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: '关键词(模糊搜索标题)' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: '排序方式: random(种子随机,需配合 seed) | 默认 updatedAt desc' })
  @IsOptional()
  @IsString()
  order?: string;

  @ApiPropertyOptional({ description: '随机种子(与 order=random 配合,同一 seed 分页稳定不重复)' })
  @IsOptional()
  @IsString()
  seed?: string;
}

export class ImportPublicPromptDto {
  @ApiProperty({ type: [CreatePublicPromptDto], description: '批量导入的提示词列表' })
  @IsArray()
  items!: CreatePublicPromptDto[];
}