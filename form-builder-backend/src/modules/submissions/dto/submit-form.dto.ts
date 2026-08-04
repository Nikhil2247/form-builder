import { IsObject, IsInt, IsOptional, Min } from 'class-validator';

export class SubmitFormDto {
  @IsObject() answers: Record<string, any>;
  @IsOptional() @IsInt() @Min(0) completionTimeMs?: number;
  @IsOptional() captchaToken?: string;
  @IsOptional() honeypot?: string;
}
