import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ShotInputDto } from './generate-video-prompt.dto';

/**
 * 视频提示词生成 - 批量输入 DTO
 */
export class GenerateVideoPromptBatchDto {
  @ApiProperty({ type: [ShotInputDto], description: '分镜数组' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShotInputDto)
  shots!: ShotInputDto[];
}