import { Injectable, Logger } from '@nestjs/common';
import { AssistantMode } from '@prisma/client';
import { PrismaService } from '../../common/infra/prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { ClaudeClientService } from './claude-client.service';
import { IdeaService } from './idea.service';
import { AgentLoopService } from './agent-loop.service';
import { QuotaService } from './quota.service';
import { FaqCacheService } from './faq-cache.service';
import { runOrgChat, type OrgChatResult } from './org-chat';
import type { OrgRole } from './tools/org-tools';

export interface AskAssistantParams {
  orgId: string;
  userId: string;
  role: OrgRole;
  sessionId?: string;
  message: string;
  currentFormId?: string;
  /** UI-only nudge from the frontend's mode toggler — see org-chat.ts#OrgChatParams.modeHint. */
  modeHint?: string;
}

export type AskAssistantResult = OrgChatResult;

/**
 * Backs the single unified `POST .../assistant/messages` route
 * (AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.1/§3.6/§5) — the "Auto" mode that has
 * every org tool available and routes itself, rather than the user picking a
 * bot up front. Sessions are labeled AssistantMode.AUTO; everything else
 * (tools, system prompt, per-tool role checks) is built by the shared
 * runOrgChat in org-chat.ts — see that file's doc comment.
 */
@Injectable()
export class AssistantChatService {
  private readonly logger = new Logger(AssistantChatService.name);

  constructor(
    private readonly agentLoop: AgentLoopService,
    private readonly claude: ClaudeClientService,
    private readonly prisma: PrismaService,
    private readonly idea: IdeaService,
    private readonly analytics: AnalyticsService,
    private readonly quota: QuotaService,
    private readonly faqCache: FaqCacheService,
  ) {}

  async ask(params: AskAssistantParams): Promise<AskAssistantResult> {
    await this.quota.assertWithinMonthlyQuota(params.orgId);

    return runOrgChat({
      agentLoop: this.agentLoop,
      claude: this.claude,
      prisma: this.prisma,
      idea: this.idea,
      analytics: this.analytics,
      faqCache: this.faqCache,
      logger: this.logger,
      orgId: params.orgId,
      userId: params.userId,
      role: params.role,
      sessionId: params.sessionId,
      message: params.message,
      mode: AssistantMode.AUTO,
      currentFormId: params.currentFormId,
      modeHint: params.modeHint,
      auditAction: 'assistant.auto.message',
    });
  }
}
