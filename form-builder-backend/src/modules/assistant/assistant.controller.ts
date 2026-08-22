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
import { OrgMemberGuard } from '../../common/auth/org-member.guard';
import { RoleGuard } from '../../common/auth/role.guard';
import { RequiredRole } from '../../common/auth/roles.decorator';
import { OrgId } from '../../common/auth/org-id.decorator';
import { PaginationQueryDto } from '../../common/http/pagination/pagination-query.dto';
import { parsePagination } from '../../common/http/pagination/pagination';
import { AssistantChatService } from './chat/assistant-chat.service';
import { SessionService } from './chat/session.service';
import { UsageService } from './quota/usage.service';
import { AskAssistantDto } from './dto/ask-assistant.dto';
import type { OrgRole } from './tools/org-tools';

/**
 * Org-scoped assistant endpoints. The platform-level superadmin surface is a
 * later phase, on its own controller — see AI_ASSISTANT_PLAN.md §10.
 *
 * Class-level guard is VIEWER — see AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.1/§6.1:
 * the route no longer gates by mode (every mode now shares one tool registry
 * and system prompt, see org-chat.ts), so the EDITOR boundary that used to
 * sit on help/idea's routes moved into the tool handlers themselves
 * (tools/org-tools.ts#TOOL_MIN_ROLE, enforced in runOrgTool) — see
 * tool-authorization.spec.ts for the structural guard on that move.
 *
 * The three former per-mode routes (help/insights/idea) and their thin
 * wrapper services were deleted once Phase C's single AssistantPanel was
 * confirmed working — everything now goes through the one route below.
 */
@Controller('organizations/:orgId/assistant')
@UseGuards(JwtAuthGuard, OrgMemberGuard, RoleGuard)
@RequiredRole('VIEWER')
export class AssistantController {
  constructor(
    private readonly assistantChat: AssistantChatService,
    private readonly sessions: SessionService,
    private readonly usage: UsageService,
  ) {}

  /** The unified endpoint (§3.6's "Auto" mode): every ORG_TOOLS tool is available and the model routes itself. */
  @Post('messages')
  ask(
    @OrgId() orgId: string,
    @Req() req: Request,
    @Body() dto: AskAssistantDto,
  ) {
    const userId = (req.user as any).sub;
    return this.assistantChat.ask({
      orgId,
      userId,
      role: orgRole(req),
      sessionId: dto.sessionId,
      message: dto.message,
      currentFormId: dto.currentFormId,
      modeHint: dto.modeHint,
    });
  }

  @Get('sessions')
  listAutoSessions(
    @OrgId() orgId: string,
    @Req() req: Request,
    @Query() query: PaginationQueryDto,
  ) {
    const userId = (req.user as any).sub;
    return this.sessions.listSessions(
      orgId,
      userId,
      AssistantMode.AUTO,
      parsePagination(query),
    );
  }

  @Get('sessions/:id')
  getAutoSession(
    @OrgId() orgId: string,
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const userId = (req.user as any).sub;
    return this.sessions.getSession(orgId, userId, id);
  }

  /**
   * This org's own usage — §3.8. ADMIN-only (raised above the class's
   * VIEWER default): cost and token volume is org-management information,
   * not something every member needs to see.
   */
  @Get('usage')
  @RequiredRole('ADMIN')
  getUsage(@OrgId() orgId: string, @Query('days') days?: string) {
    const parsed = days ? parseInt(days, 10) : undefined;
    return this.usage
      .getUsageByOrg({
        organizationId: orgId,
        days:
          parsed && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
      })
      .then((rows) => rows[0] ?? null);
  }
}

/** OrgMemberGuard attaches this — see its doc comment. Read here rather than adding a new param decorator for one call site per method. */
function orgRole(req: Request): OrgRole {
  return ((req as any).orgMembership?.role ?? 'VIEWER') as OrgRole;
}
