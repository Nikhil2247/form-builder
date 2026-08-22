import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';

import { FormAppSessionsService } from '../services/form-app-sessions.service';
import { JwtAuthGuard } from '../../../common/auth/jwt-auth.guard';
import { OrgMemberGuard } from '../../../common/auth/org-member.guard';
import { RoleGuard } from '../../../common/auth/role.guard';
import { RequiredRole } from '../../../common/auth/roles.decorator';
import { OrgId } from '../../../common/auth/org-id.decorator';

/**
 * What can be added to a record, right now.
 *
 * Lives in the form-apps module rather than alongside the other subject routes
 * because the answer is entirely a property of the APP — its steps, their
 * scopes, its reporting period. Subjects know nothing about any of that, and
 * putting the route there would make the subjects module depend on this one to
 * answer a question it cannot ask itself.
 *
 * VIEWER, matching the rest of record handling: reading a record and recording
 * against it is data entry, not configuration.
 */
@Controller('organizations/:orgId/subjects')
@UseGuards(JwtAuthGuard, OrgMemberGuard, RoleGuard)
export class SubjectEntriesController {
  constructor(private readonly sessions: FormAppSessionsService) {}

  @Get(':subjectId/entry-options')
  @RequiredRole('VIEWER')
  entryOptions(
    @OrgId() orgId: string,
    @Param('subjectId', new ParseUUIDPipe()) subjectId: string,
  ) {
    return this.sessions.entryOptionsForSubject(orgId, subjectId);
  }
}
