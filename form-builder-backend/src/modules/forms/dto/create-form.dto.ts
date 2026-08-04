import { IsString, IsOptional, IsBoolean, IsInt, IsDateString, Min, MaxLength, IsObject, Allow } from 'class-validator';

export class CreateFormDto {
  @IsString() @MaxLength(255) title: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() @MaxLength(120) slug?: string;
  @IsOptional() @IsBoolean() isQuizMode?: boolean;
  @IsOptional() @IsBoolean() isPasswordProtected?: boolean;
  @IsOptional() @IsString() password?: string;
  @IsOptional() @IsBoolean() requireAuth?: boolean;
  @IsOptional() @IsBoolean() allowMultiple?: boolean;
  @IsOptional() @IsInt() @Min(1) maxSubmissions?: number;
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsObject() themeConfig: Record<string, any>;
  @IsOptional() @Allow() notifyEmails?: string[];
  @IsOptional() @Allow() pages?: any;
  @IsOptional() @Allow() questions?: any;
  @IsOptional() @Allow() logic?: any;
  @IsOptional() @IsString() layoutMode?: string;
}
