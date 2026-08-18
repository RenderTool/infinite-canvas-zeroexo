import { IsOptional, IsString, IsArray, IsIn, IsInt, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** 提示词图片角色枚举 */
export const PROMPT_IMAGE_ROLES = ['reference', 'output', 'cover'] as const;
export type PromptImageRole = (typeof PROMPT_IMAGE_ROLES)[number];

/** 添加单张图片 DTO */
export class AddPromptImageDto {
  @IsString()
  storageKey!: string;

  @IsOptional()
  @IsIn(PROMPT_IMAGE_ROLES as unknown as string[])
  role?: PromptImageRole;

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

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
