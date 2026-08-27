import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 创建提示词 DTO。
 * 同步场景下可携带 id(本地 id),不传则后端生成 UUID。
 */
export class CreatePromptDto {
  @ApiPropertyOptional({
    description: '提示词 id(同步场景传入本地 id,不传则后端生成 UUID)',
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: '周报生成提示词', description: '提示词标题' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title!: string;

  @ApiProperty({ example: '请帮我生成一份周报...', description: '提示词内容' })
  @IsString()
  @MinLength(1)
  @MaxLength(7000)
  content!: string;

  @ApiPropertyOptional({ description: '英文提示词内容' })
  @IsOptional()
  @IsString()
  contentEn?: string;

  @ApiPropertyOptional({ description: '日文提示词内容' })
  @IsOptional()
  @IsString()
  contentJa?: string;

  @ApiPropertyOptional({ example: '适用于周报场景...', description: '备注/说明' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({ example: 'writing', description: '分类' })
  @IsString()
  category!: string;

  @ApiPropertyOptional({ type: [String], description: '标签列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '是否收藏' })
  @IsOptional()
  @IsBoolean()
  favorite?: boolean;

  @ApiPropertyOptional({ description: '所属文件夹 ID' })
  @IsOptional()
  @IsString()
  folderId?: string;

  @ApiPropertyOptional({ description: '来源(public-import 等)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  source?: string;

  @ApiPropertyOptional({ description: '来源仓库(原始公共提示词 sourceId)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sourceRepo?: string;

  @ApiPropertyOptional({
    type: [String],
    description: '参考图 storageKey 列表(从资产库选择或新上传)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageKeys?: string[];

  @ApiPropertyOptional({
    enum: ['txt2img', 'img2img'],
    description: '生成模式(征集 #79):文生图/图生图,缺省文生图',
  })
  @IsOptional()
  @IsIn(['txt2img', 'img2img'])
  generationMode?: 'txt2img' | 'img2img';
}

/**
 * 更新提示词 DTO - 所有字段可选,仅传入的字段会被更新。
 */
export class UpdatePromptDto {
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

  @ApiPropertyOptional({ description: '英文提示词内容' })
  @IsOptional()
  @IsString()
  contentEn?: string;

  @ApiPropertyOptional({ description: '日文提示词内容' })
  @IsOptional()
  @IsString()
  contentJa?: string;

  @ApiPropertyOptional({ description: '备注/说明' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ description: '分类' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ type: [String], description: '标签列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '来源(local | github 等)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  source?: string;

  @ApiPropertyOptional({ description: '来源仓库' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sourceRepo?: string;

  @ApiPropertyOptional({ description: '是否收藏' })
  @IsOptional()
  @IsBoolean()
  favorite?: boolean;

  @ApiPropertyOptional({ description: '所属文件夹 ID' })
  @IsOptional()
  @IsString()
  folderId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: '参考图 storageKey 列表(整体替换)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageKeys?: string[];

  @ApiPropertyOptional({
    enum: ['txt2img', 'img2img'],
    description: '生成模式(征集 #79):文生图/图生图',
  })
  @IsOptional()
  @IsIn(['txt2img', 'img2img'])
  generationMode?: 'txt2img' | 'img2img';
}

/**
 * 查询提示词 DTO - 游标分页与过滤参数。
 */
export class QueryPromptDto {
  @ApiPropertyOptional({ description: '游标(上一页最后一条 id)' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: '每页条数(默认 20,最大 100)' })
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

  @ApiPropertyOptional({ description: '按文件夹 ID 过滤' })
  @IsOptional()
  @IsString()
  folderId?: string;

  @ApiPropertyOptional({ required: false, enum: ['own', 'all'], description: '查询类型: own=自有, all=自有+收藏' })
  @IsOptional()
  @IsString()
  type?: string;
}
