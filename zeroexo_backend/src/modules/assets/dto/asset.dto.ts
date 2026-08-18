import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 预签名上传 DTO - 客户端请求一个可直接 PUT 的预签名 URL。
 */
export class PresignAssetDto {
  @ApiProperty({ example: 'photo.png', description: '原始文件名' })
  @IsString()
  @MinLength(1)
  filename!: string;

  @ApiProperty({ example: 'image/png', description: 'MIME 类型' })
  @IsString()
  mimeType!: string;

  @ApiProperty({ example: 102400, description: '文件大小(字节)' })
  @IsNumber()
  @Min(0)
  size!: number;

  @ApiPropertyOptional({
    example: 'a1b2c3...',
    description: 'SHA-256 内容哈希(提供时启用 CAS 去重,相同哈希跳过上传)',
  })
  @IsOptional()
  @IsString()
  contentHash?: string;

  @ApiPropertyOptional({
    description: '存储范围: private(默认) | public(仅管理员可上传公共资源)',
    example: 'private',
  })
  @IsOptional()
  @IsString()
  scope?: 'private' | 'public';
}

/**
 * 创建资产 DTO - 上传完成后写入资产元数据。
 * kind 取值:'text' | 'image' | 'video' | 'audio'。
 */
export class CreateAssetDto {
  @ApiProperty({ example: 'image', description: '资产类型' })
  @IsString()
  kind!: string;

  @ApiProperty({ example: 'photo.png', description: '展示文件名' })
  @IsString()
  @MinLength(1)
  filename!: string;

  @ApiProperty({ description: 'MinIO 对象 key(由 presign 接口返回)' })
  @IsString()
  storageKey!: string;

  @ApiProperty({ example: 'image/png', description: 'MIME 类型' })
  @IsString()
  mimeType!: string;

  @ApiProperty({ example: 102400, description: '文件大小(字节)' })
  @IsNumber()
  @Min(0)
  size!: number;

  @ApiPropertyOptional({ description: '宽度(像素,图片/视频)' })
  @IsOptional()
  @IsInt()
  width?: number;

  @ApiPropertyOptional({ description: '高度(像素,图片/视频)' })
  @IsOptional()
  @IsInt()
  height?: number;

  @ApiPropertyOptional({ description: '时长(秒,音视频)' })
  @IsOptional()
  @IsNumber()
  duration?: number;

  @ApiPropertyOptional({ description: '缩略图存储 key' })
  @IsOptional()
  @IsString()
  thumbnailKey?: string;

  @ApiPropertyOptional({ description: '文本内容(kind="text" 时使用)' })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({ type: [String], description: '标签列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '分类: user | ai-test | ai-generation', default: 'user' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: '所属文件夹 ID(资产/测试模块合并后,一个素材可归入一个文件夹)' })
  @IsOptional()
  @IsString()
  folderId?: string;
}

/**
 * 更新资产 DTO - 所有字段可选,仅传入的字段会被更新。
 * Asset 模型无 title 字段,展示名使用 filename。
 */
export class UpdateAssetDto {
  @ApiPropertyOptional({ description: '展示文件名' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  filename?: string;

  @ApiPropertyOptional({ type: [String], description: '标签列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '可见性(private | public)' })
  @IsOptional()
  @IsString()
  visibility?: string;

  @ApiPropertyOptional({ description: '缩略图存储 key' })
  @IsOptional()
  @IsString()
  thumbnailKey?: string;

  @ApiPropertyOptional({ description: '所属文件夹 ID' })
  @IsOptional()
  @IsString()
  folderId?: string;

  @ApiPropertyOptional({ description: '文本内容(kind="text"|"script" 时使用)' })
  @IsOptional()
  @IsString()
  text?: string;
}

/**
 * 上传 .zeroexo 结构化资产 DTO - 资产引擎产物。
 * kind 取值: zeroexo-text | zeroexo-entity | zeroexo-prompt
 * 分别对应 .zeroexo 文件中的 text/entity/prompt 类型数据。
 */
export class CreateZeroexoAssetDto {
  @ApiProperty({ example: 'zeroexo-text', description: '资产类型: zeroexo-text | zeroexo-entity | zeroexo-prompt' })
  @IsString()
  kind!: string;

  @ApiProperty({ example: 'script.zeroexo', description: '文件名' })
  @IsString()
  @MinLength(1)
  filename!: string;

  @ApiProperty({ description: 'MinIO 对象 key(由 presign 接口返回)' })
  @IsString()
  storageKey!: string;

  @ApiProperty({ example: 'application/zeroexo+json', description: 'MIME 类型' })
  @IsString()
  mimeType!: string;

  @ApiProperty({ example: 1024, description: '文件大小(字节)' })
  @IsNumber()
  @Min(0)
  size!: number;

  @ApiProperty({ description: '.zeroexo 结构化数据完整内容(JSON 序列化字符串)' })
  @IsString()
  text!: string;

  @ApiPropertyOptional({ type: [String], description: '标签列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '所属项目 ID' })
  @IsOptional()
  @IsString()
  projectId?: string;
}

/**
 * 更新 .zeroexo 结构化资产 DTO - 所有字段可选,仅传入的字段会被更新。
 * 用于 PATCH /resources/:id/zeroexo-content 端点。
 */
export class UpdateZeroexoAssetDto {
  @ApiPropertyOptional({ description: '展示文件名' })
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional({ type: [String], description: '标签列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '可见性(private | public)' })
  @IsOptional()
  @IsString()
  visibility?: string;

  @ApiPropertyOptional({ description: '.zeroexo 结构化数据完整内容(JSON 序列化字符串)' })
  @IsOptional()
  @IsString()
  text?: string;
}

/**
 * 创建零结构化资产 DTO - 用于创建 zeroexo-entity / zeroexo-prompt 资产。
 * 无需文件上传,直接由前端结构化数据持久化,storageKey 自动生成。
 */
export class CreateZeroexoStructuredDto {
  @ApiProperty({ example: 'zeroexo-entity', description: '资产类型: zeroexo-entity | zeroexo-prompt' })
  @IsString()
  kind!: string;

  @ApiProperty({ example: '角色张三', description: '资产名称' })
  @IsString()
  @MinLength(1)
  filename!: string;

  @ApiProperty({ description: '.zeroexo 结构化数据完整内容(JSON 序列化字符串)' })
  @IsString()
  text!: string;

  @ApiPropertyOptional({ type: [String], description: '标签列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

/**
 * 创建剧本资产 DTO - 剧本以 kind='script' 存储,text 字段保存剧集 JSON。
 * 无需文件上传,直接由导入结果持久化。
 */
export class CreateScriptAssetDto {
  @ApiProperty({ description: '剧本名称' })
  @IsString()
  @MinLength(1)
  filename!: string;

  @ApiProperty({ description: '剧本内容(剧集 JSON 序列化字符串)' })
  @IsString()
  text!: string;

  @ApiPropertyOptional({ type: [String], description: '标签列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
