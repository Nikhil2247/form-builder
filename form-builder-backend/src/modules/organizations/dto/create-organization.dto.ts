import { IsString, IsOptional, MaxLength, MinLength } from 'class-validator';

export class CreateOrganizationDto {
  @IsString() @MinLength(2) @MaxLength(255) name: string;
  @IsOptional() @IsString() @MaxLength(120) slug?: string;
}
