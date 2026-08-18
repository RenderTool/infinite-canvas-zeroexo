import {
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 创建源素材 DTO - 记录前端上传的原始素材经过资产引擎处理后的关联信息。
 */
export class CreateSourceMaterialDto {
  @ApiProperty({ description: '所属项目 ID' })
  @IsString()
  @MinLength(1)
  projectId!: string;

  @ApiProperty({ description: '处理完成后生成的资产 ID' })
  @IsString()
  @MinLength(1)
  processedAssetId!: string;

  @ApiProperty({ description: '上传用户 ID' })
  @IsString()
  @MinLength(1)
  userId!: string;
}

/**
 * 更新处理状态 DTO
 */
export class UpdateSourceMaterialStatusDto {
  @ApiProperty({ description: '处理状态: pending | processing | completed | failed' })
  @IsString()
  processingStatus!: string;

  @ApiPropertyOptional({ description: '关联的脚本 ID' })
  @IsOptional()
  @IsString()
  scriptId?: string;
}

/**
 * 查询源素材列表 DTO
 */
export class QuerySourceMaterialDto {
  @ApiProperty({ description: '项目 ID' })
  @IsString()
  @MinLength(1)
  projectId!: string;
}