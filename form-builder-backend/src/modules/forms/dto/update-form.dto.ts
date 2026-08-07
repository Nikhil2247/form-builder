import { PartialType } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';
import { CreateFormDto } from './create-form.dto';

export class UpdateFormDto extends PartialType(CreateFormDto) {
  /**
   * The `updatedAt` the client last saw, for optimistic concurrency.
   *
   * Two people editing the same form — or the same person with the builder open
   * in two tabs — both autosave the *whole* definition every couple of seconds.
   * Without this the later write wins unconditionally and takes every question
   * the other session added with it, silently, with no error anywhere. When it
   * does not match, the service returns 409 and the client stops writing rather
   * than destroying the other copy.
   *
   * Omitted means "no check" — used by API clients that are not the builder.
   */
  @IsOptional()
  @IsDateString()
  expectedUpdatedAt?: string;
}
