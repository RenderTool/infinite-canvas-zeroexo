import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 登录请求 DTO。
 * - email 必填
 * - password 必填
 */
export class LoginDto {
  @ApiProperty({
    required: true,
    example: 'user@example.com',
    description: '邮箱',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'StrongPass123', description: '密码' })
  @IsString()
  @MinLength(1)
  password!: string;
}
