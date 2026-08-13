import {
  IsString,
  IsOptional,
  MaxLength,
  MinLength,
  IsInt,
  Min,
} from 'class-validator';

export class UpdateOrganizationDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(255) name?: string;
  @IsOptional() @IsString() @MaxLength(120) slug?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsInt() @Min(1) maxForms?: number;
  @IsOptional() @IsInt() @Min(1) maxSubmissionsMonth?: number;
  @IsOptional() @IsInt() @Min(1) maxMembers?: number;

  @IsOptional() @IsString() @MaxLength(100) minioBucket?: string;
  @IsOptional() @IsString() @MaxLength(100) s3Bucket?: string;
  @IsOptional() defaultStorageProvider?: 'MINIO' | 'S3';
}
