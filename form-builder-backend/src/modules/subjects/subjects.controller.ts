import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request } from 'express';

import { SubjectsService, type IdentityConfig } from './subjects.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/auth/org-member.guard';
import { RoleGuard } from '../../common/auth/role.guard';
import { RequiredRole } from '../../common/auth/roles.decorator';
import { OrgId } from '../../common/auth/org-id.decorator';
import { PaginationQueryDto } from '../../common/http/pagination/pagination-query.dto';
import { parsePagination } from '../../common/http/pagination/pagination';

/**
 * Subject types and subjects.
 *
 * Role split follows plan.md §9.3 — no new role was introduced:
 *   • configuring subject TYPES is a structural change  → EDITOR
 *   • reading and recording against SUBJECTS is data entry → VIEWER
 */
@Controller('organizations/:orgId')
@UseGuards(JwtAuthGuard, OrgMemberGuard, RoleGuard)
export class SubjectsController {
  constructor(private readonly subjects: SubjectsService) {}

  // ── Subject types ─────────────────────────────────────────────────────────

  @Get('subject-types')
  @RequiredRole('VIEWER')
  listSubjectTypes(@OrgId() orgId: string) {
    return this.subjects.listSubjectTypes(orgId);
  }

  @Post('subject-types')
  @RequiredRole('EDITOR')
  createSubjectType(
    @OrgId() orgId: string,
    @Body()
    body: {
      name: string;
      slug?: string;
      icon?: string;
      identityConfig?: IdentityConfig;
    },
    @Req() req: Request,
  ) {
    return this.subjects.createSubjectType(orgId, body, (req.user as any)?.sub);
  }

  @Patch('subject-types/:subjectTypeId')
  @RequiredRole('EDITOR')
  updateSubjectType(
    @OrgId() orgId: string,
    @Param('subjectTypeId', new ParseUUIDPipe()) subjectTypeId: string,
    @Body()
    body: {
      name?: string;
      icon?: string;
      identityConfig?: IdentityConfig;
      registrationFormId?: string | null;
    },
    @Req() req: Request,
  ) {
    return this.subjects.updateSubjectType(
      orgId,
      subjectTypeId,
      body,
      (req.user as any)?.sub,
    );
  }

  @Delete('subject-types/:subjectTypeId')
  @RequiredRole('ADMIN')
  deleteSubjectType(
    @OrgId() orgId: string,
    @Param('subjectTypeId', new ParseUUIDPipe()) subjectTypeId: string,
    @Req() req: Request,
  ) {
    return this.subjects.deleteSubjectType(
      orgId,
      subjectTypeId,
      (req.user as any)?.sub,
    );
  }

  // ── Subjects ──────────────────────────────────────────────────────────────

  @Get('subjects')
  @RequiredRole('VIEWER')
  listSubjects(
    @OrgId() orgId: string,
    @Query()
    query: PaginationQueryDto & { subjectTypeId?: string; search?: string },
  ) {
    return this.subjects.listSubjects(
      orgId,
      { subjectTypeId: query.subjectTypeId, search: query.search },
      parsePagination(query),
    );
  }

  /**
   * Possible duplicates for a record about to be registered.
   *
   * Advisory only — the caller decides whether to open the existing record or
   * create a new one. Never blocks and never auto-merges.
   */
  @Get('subjects/duplicates')
  @RequiredRole('VIEWER')
  findDuplicates(
    @OrgId() orgId: string,
    @Query()
    query: { subjectTypeId: string; displayName?: string; externalId?: string },
  ) {
    return this.subjects.findPossibleDuplicates(orgId, query.subjectTypeId, {
      displayName: query.displayName,
      externalId: query.externalId,
    });
  }

  @Get('subjects/:subjectId')
  @RequiredRole('VIEWER')
  getSubject(
    @OrgId() orgId: string,
    @Param('subjectId', new ParseUUIDPipe()) subjectId: string,
  ) {
    return this.subjects.getSubject(orgId, subjectId);
  }

  @Get('subjects/:subjectId/timeline')
  @RequiredRole('VIEWER')
  getTimeline(
    @OrgId() orgId: string,
    @Param('subjectId', new ParseUUIDPipe()) subjectId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.subjects.getSubjectTimeline(
      orgId,
      subjectId,
      parsePagination(query),
    );
  }

  @Delete('subjects/:subjectId')
  @RequiredRole('EDITOR')
  deleteSubject(
    @OrgId() orgId: string,
    @Param('subjectId', new ParseUUIDPipe()) subjectId: string,
    @Req() req: Request,
  ) {
    return this.subjects.deleteSubject(
      orgId,
      subjectId,
      (req.user as any)?.sub,
    );
  }
}
