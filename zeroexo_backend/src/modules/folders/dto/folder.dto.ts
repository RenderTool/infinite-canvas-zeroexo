import { IsOptional, IsString, IsBoolean, IsInt, Min } from 'class-validator';

/** 创建文件夹 DTO */
export class CreateFolderDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;
}

/** 更新文件夹 DTO(重命名 / 移动 / 排序) */
export class UpdateFolderDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/** 查询文件夹 DTO */
export class QueryFolderDto {
  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsBoolean()
  systemOnly?: boolean;
}
