import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AssistantMode } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { SuperAdminGuard } from '../../common/auth/super-admin.guard';
import { PaginationQueryDto } from '../../common/http/pagination/pagination-query.dto';
import { parsePagination } from '../../common/http/pagination/pagination';
import { PlatformInsightsService } from './insights/platform-insights.service';
import { SessionService } from './chat/session.service';
import { UsageService } from './quota/usage.service';
import { AskAssistantDto } from './dto/ask-assistant.dto';

/**
 * Platform-level assistant endpoints — mode 4, superadmin-only cross-org Q&A.
 * See AI_ASSISTANT_PLAN.md §4/§10 Phase 4.
 *
 * Deliberately no OrgMemberGuard/RoleGuard in the chain: this controller's
 * entire purpose is reading across the tenant boundary, gated only by
 * SuperAdminGuard (a different axis than the org RoleGuard — see
 * SuperAdminGuard's own doc comment). cross_org_query is only ever wired into
 * PlatformInsightsService, never AssistantController's tool lists — see
 * platform-insights.spec.ts.
 */
@Controller('admin/assistant')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class PlatformAssistantController {
  constructor(
    private readonly platformInsights: PlatformInsightsService,
    private readonly sessions: SessionService,
    private readonly usage: UsageService,
  ) {}

  /**
   * Cross-org usage — see AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.8 and §6
   * decision 3: visibility into who is using the most (tokens, queries,
   * cost, cache-hit rate), not a spend ceiling — the org explicitly declined
   * a quota for now.
   */
  @Get('usage')
  getUsage(@Query('days') days?: string) {
    const parsed = days ? parseInt(days, 10) : undefined;
    return this.usage.getUsageByOrg({
      days:
        parsed && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
    });
  }

  @Post('messages')
  ask(@Req() req: Request, @Body() dto: AskAssistantDto) {
    const userId = (req.user as any).sub;
    return this.platformInsights.ask({
      userId,
      sessionId: dto.sessionId,
      message: dto.message,
    });
  }

  @Get('sessions')
  listSessions(@Req() req: Request, @Query() query: PaginationQueryDto) {
    const userId = (req.user as any).sub;
    return this.sessions.listSessions(
      null,
      userId,
      AssistantMode.PLATFORM_INSIGHTS,
      parsePagination(query),
    );
  }

  @Get('sessions/:id')
  getSession(@Req() req: Request, @Param('id') id: string) {
    const userId = (req.user as any).sub;
    return this.sessions.getSession(null, userId, id);
  }
}
