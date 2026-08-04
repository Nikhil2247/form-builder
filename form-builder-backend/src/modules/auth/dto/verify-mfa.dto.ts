import { IsNotEmpty, IsString, Length } from 'class-validator';

export class VerifyMfaDto {
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  code: string;
}

export class VerifyMfaLoginDto extends VerifyMfaDto {
  @IsString()
  @IsNotEmpty()
  mfaToken: string;
}
