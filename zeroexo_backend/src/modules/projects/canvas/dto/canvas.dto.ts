import {
  IsArray,
  IsBoolean,
  IsInt,
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

  @ApiPropertyOptional({
    description: '期望的云端版本号(乐观锁),小于当前云端版本时返回 409',
  })
  @IsOptional()
  @IsInt()
  expectedVersion?: number;

  /**
   * 增量更新的节点 ID 列表。
   * 当此字段存在时,scene 不再是全量替换,而是与当前云端 scene 合并:
   * - scene 中在 changedNodeIds 列表内的节点 → 替换为新版本
   * - scene 中不在 changedNodeIds 列表内的节点 → 保留云端现有版本
   * - 被标记为 "__deleted__" 类型的节点 → 从云端 scene 中移除
   * 此字段为 [] 时表示 scene 没有任何变化(仅更新项目属性)。
   * 不传此字段时保持原有全量替换行为(向后兼容)。
   */
  @ApiPropertyOptional({ type: [String], description: '增量更新的节点 ID 列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  changedNodeIds?: string[];
}
