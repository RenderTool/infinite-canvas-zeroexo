import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class FavoritePromptDto {
  @ApiProperty({ description: '公共提示词 ID' })
  @IsString()
  @IsNotEmpty()
  promptId!: string;
}