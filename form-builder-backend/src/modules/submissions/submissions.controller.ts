import {
  Controller,
  Post,
  Get,
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
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { OrgId } from '../../common/decorators/org-id.decorator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { parsePagination } from '../../common/pagination/pagination';

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

    return this.submissionsService.submitForm(formId, dto, ip, userAgent, userId);
  }

  @Get('organizations/:orgId/submissions')
  @UseGuards(JwtAuthGuard, OrgMemberGuard)
  async listSubmissions(@OrgId() orgId: string, @Query() query: PaginationQueryDto) {
    return this.submissionsService.listSubmissions(
      orgId,
      parsePagination(query),
      query.search,
    );
  }
}
