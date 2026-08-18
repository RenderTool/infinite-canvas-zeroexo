import { IsOptional, IsString, IsInt, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePolicyVersionDto {
  @ApiProperty({ description: '标题(中文)' })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional({ description: '标题(英文)', default: '' })
  @IsOptional()
  @IsString()
  titleEn?: string;

  @ApiPropertyOptional({ description: '标题(日文)', default: '' })
  @IsOptional()
  @IsString()
  titleJa?: string;

  @ApiPropertyOptional({ description: '中文内容(Markdown)', default: '' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({ description: '英文内容(Markdown)', default: '' })
  @IsOptional()
  @IsString()
  contentEn?: string;

  @ApiPropertyOptional({ description: '日文内容(Markdown)', default: '' })
  @IsOptional()
  @IsString()
  contentJa?: string;

  @ApiPropertyOptional({ description: '类型: policy | announcement', default: 'policy' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: '版本说明(管理员可见)', default: '' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdatePolicyVersionDto {
  @ApiPropertyOptional({ description: '标题(中文)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional({ description: '标题(英文)' })
  @IsOptional()
  @IsString()
  titleEn?: string;

  @ApiPropertyOptional({ description: '标题(日文)' })
  @IsOptional()
  @IsString()
  titleJa?: string;

  @ApiPropertyOptional({ description: '中文内容(Markdown)' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({ description: '英文内容(Markdown)' })
  @IsOptional()
  @IsString()
  contentEn?: string;

  @ApiPropertyOptional({ description: '日文内容(Markdown)' })
  @IsOptional()
  @IsString()
  contentJa?: string;

  @ApiPropertyOptional({ description: '类型: policy | announcement' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: '版本说明' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class PublishVersionDto {
  @ApiProperty({ description: '要发布的版本号' })
  @IsInt()
  @Min(1)
  version!: number;
}