import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreateFormDto } from './create-form.dto';

export class UpdateFormDto extends PartialType(CreateFormDto) {
  @IsOptional()
  @IsString()
  layoutMode?: string;
}
