import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsPhoneNumber, IsString } from 'class-validator';

export class SocialAuthDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsIn(['google', 'facebook', 'apple'])
  provider: 'google' | 'facebook' | 'apple';

  @IsOptional()
  @IsPhoneNumber()
  phone?: string;
}
