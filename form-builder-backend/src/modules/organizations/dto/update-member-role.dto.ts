import { IsString, IsIn } from 'class-validator';

export class UpdateMemberRoleDto {
  @IsString() @IsIn(['ADMIN', 'EDITOR', 'VIEWER']) role: string;
}
