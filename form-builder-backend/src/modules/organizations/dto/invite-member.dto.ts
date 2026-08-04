import { IsEmail, IsOptional, IsString, IsIn } from 'class-validator';

export class InviteMemberDto {
  @IsEmail() email: string;
  @IsOptional() @IsString() @IsIn(['ADMIN', 'EDITOR', 'VIEWER']) role?: string;
}
