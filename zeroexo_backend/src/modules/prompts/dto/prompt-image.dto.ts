import { IsBoolean, IsOptional, IsString, IsArray, IsIn, IsInt, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** 提示词图片角色枚举(2026-08-29:封面不再用 role 表达,改为独立 isCover 布尔) */
export const PROMPT_IMAGE_ROLES = ['reference', 'output'] as const;
export type PromptImageRole = (typeof PROMPT_IMAGE_ROLES)[number];

/** 添加单张图片 DTO */
export class AddPromptImageDto {
  @IsString()
  storageKey!: string;

  @IsOptional()
  @IsIn(PROMPT_IMAGE_ROLES as unknown as string[])
  role?: PromptImageRole;

  /** 封面标记(独立布尔,不改变 reference/output 角色) */
  @IsOptional()
  @IsBoolean()
  isCover?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/** 批量设置图片 DTO(覆盖式,先删后插) */
export class SetPromptImagesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SetPromptImageItemDto)
  images!: SetPromptImageItemDto[];
}

export class SetPromptImageItemDto {
  @IsString()
  storageKey!: string;

  @IsOptional()
  @IsIn(PROMPT_IMAGE_ROLES as unknown as string[])
  role?: PromptImageRole;

  /** 封面标记(独立布尔,不改变 reference/output 角色) */
  @IsOptional()
  @IsBoolean()
  isCover?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
