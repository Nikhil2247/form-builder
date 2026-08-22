import { Injectable, Logger } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { AssistantMode } from '@prisma/client';
import { PrismaService } from '../../common/infra/prisma/prisma.service';
import { AdminService } from '../admin/admin.service';
import { AgentLoopService } from './agent-loop.service';
import { QuotaService } from './quota.service';
import {
  CROSS_ORG_QUERY_TOOL,
  crossOrgQuery,
} from './tools/cross-org-query.tool';

const SYSTEM_PROMPT = `You are the platform insights assistant for Vibha's form-builder platform, used only by platform superadmins. You answer cross-organization questions — comparing PMUs, adoption trends, quota utilization, org health — using aggregated numbers only, across the tenant boundary that every other part of this platform enforces.

Each PMU (program management unit) is one Organization in this system — there is no separate program/geography hierarchy yet, so "compare PMUs" and "compare organizations" mean the same query today. Say so plainly if a question assumes a hierarchy finer than organization (e.g. "compare across states within a PMU") — that data does not exist yet.

Call cross_org_query for every question. Use view=platform_summary for headline totals, org_breakdown to compare organizations side by side, quota_watch for "who's close to their limit", and adoption_trend for usage-over-time questions. You never see or report any individual respondent's answers — only counts, rates, and organization-level aggregates.

Answer style: lead with the number, in one or two sentences, then at most four bullets of detail. Plain language, no internal ids.`;

/**
 * Deliberately its own tool registry and system prompt — see
 * cross-org-query.tool.ts and platform-insights.spec.ts, which assert
 * cross_org_query is wired only here, never into ORG_TOOLS. Every
 * session/audit call below passes `orgId = null`: there is no tenant, by
 * design, for the one surface allowed to read across the org boundary.
 */
const PLATFORM_TOOLS: Anthropic.Tool[] = [CROSS_ORG_QUERY_TOOL];

export interface AskPlatformInsightsParams {
  userId: string;
  sessionId?: string;
  message: string;
}

export interface AskPlatformInsightsResult {
  sessionId: string;
  reply: string;
}

/**
 * Thin wrapper over AgentLoopService for the superadmin-only cross-org
 * surface — kept separate from AssistantChatService because it has no
 * organization in scope and wires in the cross-org query tool (see
 * platform-insights.spec.ts), despite sharing the same loop implementation.
 */
@Injectable()
export class PlatformInsightsService {
  private readonly logger = new Logger(PlatformInsightsService.name);

  constructor(
    private readonly agentLoop: AgentLoopService,
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
    private readonly quota: QuotaService,
  ) {}

  async ask(
    params: AskPlatformInsightsParams,
  ): Promise<AskPlatformInsightsResult> {
    await this.quota.assertWithinPlatformMonthlyQuota();

    return this.agentLoop.run({
      orgId: null,
      userId: params.userId,
      sessionId: params.sessionId,
      mode: AssistantMode.PLATFORM_INSIGHTS,
      message: params.message,
      system: SYSTEM_PROMPT,
      tools: PLATFORM_TOOLS,
      runTool: async (name, rawInput) => {
        const input = (rawInput ?? {}) as Record<string, unknown>;
        try {
          switch (name) {
            case CROSS_ORG_QUERY_TOOL.name:
              return await crossOrgQuery(this.prisma, this.admin, input);
            default:
              return `Unknown tool: ${name}`;
          }
        } catch (error) {
          this.logger.warn(`Tool "${name}" failed`, error as Error);
          return "That didn't work — please try rephrasing the request, or ask something more specific.";
        }
      },
      auditAction: 'assistant.platform_insights.message',
    });
  }
}
