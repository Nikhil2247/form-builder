import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Query,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SubmissionsService } from './submissions.service';
import { SubmitFormDto } from './dto/submit-form.dto';
import { ReviewSubmissionDto } from './dto/review-submission.dto';
import { BulkSubmissionsDto } from './dto/bulk-submissions.dto';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
// Added alongside JwtAuthGuard rather than replacing it: the mutation routes on
// this controller are bearer-only by design, and only the org-wide list is
// reachable with an API key.
import { ApiKeyOrJwtGuard } from '../../common/auth/api-key-or-jwt.guard';
import { RequiredScope } from '../../common/auth/scopes.decorator';
import { OrgMemberGuard } from '../../common/auth/org-member.guard';
import { RoleGuard } from '../../common/auth/role.guard';
import { OptionalJwtAuthGuard } from '../../common/auth/optional-jwt-auth.guard';
import { RequiredRole } from '../../common/auth/roles.decorator';
import { OrgId } from '../../common/auth/org-id.decorator';
import { PaginationQueryDto } from '../../common/http/pagination/pagination-query.dto';
import { parsePagination } from '../../common/http/pagination/pagination';

/**
 * Guards are attached per route rather than on the class, because this
 * controller carries the one genuinely public endpoint in the org-scoped half
 * of the API — `POST forms/:formId/submit` — alongside routes that must be
 * authenticated and role-gated. A class-level `@UseGuards(JwtAuthGuard, ...)`
 * would close the public submit path, and there is no @Public escape hatch here.
 *
 * Role requirements on the org-scoped routes mirror FormsController:
 *   VIEWER — read a response, list responses
 *   EDITOR — annotate, re-status, delete (ADMIN inherits via the role hierarchy)
 */
@Controller()
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  /**
   * Public submission endpoint.
   *
   * OptionalJwtAuthGuard populates req.user when a valid bearer token is present
   * but does NOT reject anonymous callers — required so that forms with
   * requireAuth=true can identify the respondent while public forms stay open.
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseGuards(OptionalJwtAuthGuard)
  @Post('forms/:formId/submit')
  @HttpCode(HttpStatus.ACCEPTED)
  async submit(
    @Param('formId', new ParseUUIDPipe()) formId: string,
    @Body() dto: SubmitFormDto,
    @Req() req: Request,
  ) {
    // req.ips is populated from X-Forwarded-For because main.ts sets
    // `trust proxy`. Reading the header manually would let a client spoof it.
    const ip = req.ips?.[0] ?? req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const userAgent = req.headers['user-agent'];
    const userId = (req as any).user?.sub;

    // Allow the form password to arrive via header as well as body, so it
    // never lands in a URL or a proxy access log.
    const headerPassword = req.headers['x-form-password'];
    if (!dto.formPassword && typeof headerPassword === 'string') {
      dto.formPassword = headerPassword;
    }

    return this.submissionsService.submitForm(
      formId,
      dto,
      ip,
      userAgent,
      userId,
    );
  }

  /**
   * Org-wide submission list.
   *
   * Accepts EITHER a bearer token or an `X-API-Key` carrying the
   * `submissions:read` scope. ApiKeyOrJwtGuard dispatches on the presence of the
   * header — it never demands both — and refuses a key outright on any handler
   * that has no @RequiredScope, so adding the decorator here opens exactly this
   * route and nothing else.
   *
   * The rest of the chain is unchanged on the key path: ApiKeyGuard sets
   * request.user to the key's OWNER, so OrgMemberGuard still re-checks that that
   * person is a member of :orgId (offboarding a user kills their keys) and
   * RoleGuard still applies their role.
   */
  @Get('organizations/:orgId/submissions')
  @UseGuards(ApiKeyOrJwtGuard, OrgMemberGuard, RoleGuard)
  @RequiredRole('VIEWER')
  @RequiredScope('submissions:read')
  async listSubmissions(
    @OrgId() orgId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.submissionsService.listSubmissions(
      orgId,
      parsePagination(query),
      query.search,
    );
  }

  /**
   * POST /organizations/:orgId/submissions/bulk
   *
   * Declared BEFORE the `:id` routes. Nest matches routes in declaration order,
   * so with `:id` first a POST to /submissions/bulk would be handled as an id of
   * "bulk" — which ParseUUIDPipe would reject with a confusing 400 rather than
   * reaching this handler at all.
   *
   * POST rather than PATCH because it is not idempotent in the HTTP sense: the
   * body names a set of rows and an action, and it is the closest thing the API
   * has to an RPC.
   */
  @Post('organizations/:orgId/submissions/bulk')
  @UseGuards(JwtAuthGuard, OrgMemberGuard, RoleGuard)
  @RequiredRole('EDITOR')
  @HttpCode(HttpStatus.OK)
  async bulkUpdateSubmissions(
    @OrgId() orgId: string,
    @Body() dto: BulkSubmissionsDto,
    @Req() req: Request,
  ) {
    return this.submissionsService.bulkUpdateSubmissions(
      orgId,
      dto,
      (req.user as any).sub,
      actorIp(req),
    );
  }

  /**
   * GET /organizations/:orgId/submissions/:id — one response, fully resolved
   * against the form version it was actually filled against.
   */
  @Get('organizations/:orgId/submissions/:id')
  @UseGuards(JwtAuthGuard, OrgMemberGuard, RoleGuard)
  @RequiredRole('VIEWER')
  async getSubmission(
    @OrgId() orgId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.submissionsService.getSubmissionDetail(orgId, id);
  }

  /**
   * PATCH /organizations/:orgId/submissions/:id — annotate and/or re-status.
   */
  @Patch('organizations/:orgId/submissions/:id')
  @UseGuards(JwtAuthGuard, OrgMemberGuard, RoleGuard)
  @RequiredRole('EDITOR')
  async reviewSubmission(
    @OrgId() orgId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReviewSubmissionDto,
    @Req() req: Request,
  ) {
    return this.submissionsService.reviewSubmission(
      orgId,
      id,
      dto,
      (req.user as any).sub,
      actorIp(req),
    );
  }

  /**
   * DELETE /organizations/:orgId/submissions/:id — soft delete.
   *
   * Returns 200 with a body rather than 204, because the caller wants the
   * `deletedAt` stamp back to render "deleted just now" without a refetch.
   */
  @Delete('organizations/:orgId/submissions/:id')
  @UseGuards(JwtAuthGuard, OrgMemberGuard, RoleGuard)
  @RequiredRole('EDITOR')
  async deleteSubmission(
    @OrgId() orgId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return this.submissionsService.deleteSubmission(
      orgId,
      id,
      (req.user as any).sub,
      actorIp(req),
    );
  }
}

/**
 * The actor's IP for the audit trail.
 *
 * Reads `req.ips` (populated from X-Forwarded-For only because main.ts sets
 * `trust proxy`) before `req.ip`, for the same reason the submit handler does:
 * reading the header directly would let the caller write whatever address they
 * like into their own audit entries.
 */
function actorIp(req: Request): string | undefined {
  return req.ips?.[0] ?? req.ip ?? undefined;
}
