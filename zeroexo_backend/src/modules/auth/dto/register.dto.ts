import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 注册请求 DTO。
 * - email: 合法邮箱
 * - username: 3-32 位,仅允许字母/数字/下划线/连字符
 * - password: 至少 6 位
 */
export class RegisterDto {
  @ApiProperty({ example: 'user@example.com', description: '邮箱' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'alice', minLength: 3, maxLength: 32, description: '用户名' })
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: '用户名只能包含字母、数字、下划线和连字符',
  })
  username!: string;

  @ApiProperty({ example: 'StrongPass123', minLength: 6, description: '密码' })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: '123456', description: '邮箱验证码' })
  @IsString()
  @IsOptional()
  code?: string;
}
