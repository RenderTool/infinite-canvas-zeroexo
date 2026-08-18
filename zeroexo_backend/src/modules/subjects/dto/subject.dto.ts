import { IsOptional, IsString, IsIn, IsArray } from 'class-validator';

/** 主体类型枚举 */
export const SUBJECT_TYPES = ['character', 'scene', 'prop'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

/** 状态枚举 */
export const SUBJECT_STATUSES = ['ok', 'warn', 'err'] as const;
export type SubjectStatus = (typeof SUBJECT_STATUSES)[number];

/** 创建主体 DTO */
export class CreateSubjectDto {
  @IsIn(SUBJECT_TYPES as unknown as string[])
  type!: SubjectType;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  aliases?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  avatarKey?: string;

  @IsOptional()
  @IsString()
  avatarEmoji?: string;

  @IsOptional()
  @IsIn(SUBJECT_STATUSES as unknown as string[])
  status?: SubjectStatus;

  @IsOptional()
  @IsString()
  consistency?: string;

  @IsOptional()
  fields?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageKeys?: string[];

  @IsOptional()
  @IsString()
  folderId?: string;
}

/** 更新主体 DTO */
export class UpdateSubjectDto {
  @IsOptional()
  @IsIn(SUBJECT_TYPES as unknown as string[])
  type?: SubjectType;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  aliases?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  avatarKey?: string;

  @IsOptional()
  @IsString()
  avatarEmoji?: string;

  @IsOptional()
  @IsIn(SUBJECT_STATUSES as unknown as string[])
  status?: SubjectStatus;

  @IsOptional()
  @IsString()
  consistency?: string;

  @IsOptional()
  fields?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageKeys?: string[];

  @IsOptional()
  @IsString()
  folderId?: string;
}

/** 查询主体 DTO */
export class QuerySubjectDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  limit?: number;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  folderId?: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}
