import { Controller, Post, Get, Query, Body, Param, Req, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SubmissionsService } from './submissions.service';
import { SubmitFormDto } from './dto/submit-form.dto';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { OrgId } from '../../common/decorators/org-id.decorator';

@Controller()
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('forms/:formId/submit')
  @HttpCode(HttpStatus.ACCEPTED)
  async submit(
    @Param('formId') formId: string,
    @Body() dto: SubmitFormDto,
    @Req() req: Request,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'];
    const userId = (req as any).user?.sub;

    return this.submissionsService.submitForm(formId, dto, ip, userAgent, userId);
  }

  @Get('organizations/:orgId/submissions')
  @UseGuards(JwtAuthGuard, OrgMemberGuard)
  async listSubmissions(
    @OrgId() orgId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.submissionsService.listSubmissions(
      orgId,
      parseInt(page ?? '1', 10),
      parseInt(limit ?? '50', 10),
      search
    );
  }
}

