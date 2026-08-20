import { IsEmail, IsIn } from 'class-validator';

export class AddOrgMemberDto {
  @IsEmail() email: string;
  @IsIn(['ADMIN', 'EDITOR', 'VIEWER']) role: 'ADMIN' | 'EDITOR' | 'VIEWER';
}
