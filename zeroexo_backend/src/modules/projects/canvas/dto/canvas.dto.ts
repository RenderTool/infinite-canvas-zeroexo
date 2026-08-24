import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 创建项目 DTO。
 * 同步场景下可携带 id(本地 nanoid)、graph 数据等字段。
 */
export class CreateProjectDto {
  @ApiPropertyOptional({ description: '项目 id(同步场景传入本地 id,不传则后端生成 UUID)' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: '我的画布', description: '项目标题' })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional({ description: '场景节点 JSON' })
  @IsOptional()
  scene?: unknown;

  @ApiPropertyOptional({ description: '连接 JSON' })
  @IsOptional()
  connections?: unknown;

  @ApiPropertyOptional({ description: '视口 JSON' })
  @IsOptional()
  viewport?: unknown;

  @ApiPropertyOptional({ description: '缩略图 URL' })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiPropertyOptional({ type: [String], description: '标签列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

/**
 * 更新项目 DTO - 所有字段可选,仅传入的字段会被更新。
 * scene / connections / viewport 为任意 JSON(前端画布数据)。
 */
export class UpdateProjectDto {
  @ApiPropertyOptional({ description: '项目标题' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional({ description: '场景节点 JSON' })
  @IsOptional()
  scene?: unknown;

  @ApiPropertyOptional({ description: '连接 JSON' })
  @IsOptional()
  connections?: unknown;

  @ApiPropertyOptional({ description: '视口 JSON' })
  @IsOptional()
  viewport?: unknown;

  @ApiPropertyOptional({ description: '背景模式' })
  @IsOptional()
  @IsString()
  backgroundMode?: string;

  @ApiPropertyOptional({ description: '是否显示图片信息' })
  @IsOptional()
  @IsBoolean()
  showImageInfo?: boolean;

  @ApiPropertyOptional({ description: '缩略图 URL' })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiPropertyOptional({ type: [String], description: '标签列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '是否公开' })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
