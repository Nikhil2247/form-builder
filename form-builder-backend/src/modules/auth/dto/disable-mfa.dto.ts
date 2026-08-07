import { IsString, MinLength } from 'class-validator';

export class DisableMfaDto {
  /**
   * Current account password. Required so that a hijacked session cannot
   * silently strip the second factor.
   */
  @IsString()
  @MinLength(8)
  currentPassword: string;
}
