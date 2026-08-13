import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RoleGuard } from '../../common/guards/role.guard';
import { RequiredRole } from '../../common/decorators/roles.decorator';
import { OrgId } from '../../common/decorators/org-id.decorator';
import { parsePagination } from '../../common/pagination/pagination';
import { ExportsService } from './exports.service';
import { CreateExportDto } from './dto/create-export.dto';
import { ListExportsQueryDto } from './dto/list-exports-query.dto';

/**
 * Asynchronous export jobs.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The synchronous `GET /forms/:formId/export` still exists and is still the
 * right answer for a few thousand rows: one request, one file, no polling. It
 * is not the right answer past that, because it holds a connection, a Node slot
 * and a database cursor open for the whole export, and a load balancer with a
 * 60-second idle timeout truncates it — producing a CSV that opens cleanly and
 * is missing half its rows. These routes are the escape from that: the request
 * returns an id, a worker does the work, and the result is fetched from object
 * storage directly.
 *
 * TENANCY: every route carries :orgId, every guard runs in order (auth →
 * membership → role), and every read is filtered by organizationId in the
 * query itself. A job id from org A is a 404 in org B — not a 403, which would
 * confirm the id exists.
 *
 * ROLES: VIEWER can create, list and download. Export is a read of data the
 * viewer can already page through in the dashboard; requiring EDITOR would mean
 * the people who actually analyse responses cannot get them out. Creation and
 * download are both audit-logged, which is the control that matters for a bulk
 * extraction of personal data.
 */
@Controller('organizations/:orgId/exports')
@UseGuards(JwtAuthGuard, OrgMemberGuard, RoleGuard)
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  /**
   * POST /organizations/:orgId/exports
   *
   * 202, not 201. Nothing downloadable exists yet — the response describes an
   * accepted intention, and a client that treats 201 as "the resource is ready"
   * would go straight to the download route and get a 404.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredRole('VIEWER')
  createExport(
    @OrgId() orgId: string,
    @Req() req: Request,
    @Body() dto: CreateExportDto,
  ) {
    const userId = (req.user as any).sub;
    return this.exportsService.createExport(orgId, userId, dto, req.ip);
  }

  /** GET /organizations/:orgId/exports — newest first. */
  @Get()
  @RequiredRole('VIEWER')
  listExports(@OrgId() orgId: string, @Query() query: ListExportsQueryDto) {
    return this.exportsService.listExports(
      orgId,
      query,
      parsePagination(query),
    );
  }

  /** GET /organizations/:orgId/exports/:id — status and progress. */
  @Get(':id')
  @RequiredRole('VIEWER')
  getExport(
    @OrgId() orgId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.exportsService.getExport(orgId, id);
  }

  /**
   * GET /organizations/:orgId/exports/:id/download
   *
   * Returns a presigned URL rather than the bytes. Proxying the file through
   * this process would reintroduce the long-lived request the async path exists
   * to eliminate — and would do it on an API pod rather than a worker.
   */
  @Get(':id/download')
  @RequiredRole('VIEWER')
  downloadExport(
    @OrgId() orgId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    const userId = (req.user as any).sub;
    return this.exportsService.downloadExport(orgId, id, userId, req.ip);
  }
}
