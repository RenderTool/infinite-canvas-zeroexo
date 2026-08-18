import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';

export class VerifyResetCodeDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @Length(6, 6)
  @IsNotEmpty()
  code!: string;
}
