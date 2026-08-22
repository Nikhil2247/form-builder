import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { SubjectsModule } from '../subjects/subjects.module';
import { FormAppsModule } from '../form-apps/form-apps.module';
import { AdminModule } from '../admin/admin.module';
import { ClaudeClientService } from './core/claude-client.service';
import { AgentLoopService } from './core/agent-loop.service';
import { IdeaService } from './core/idea.service';
import { AssistantChatService } from './chat/assistant-chat.service';
import { PlatformInsightsService } from './insights/platform-insights.service';
import { SessionService } from './chat/session.service';
import { QuotaService } from './quota/quota.service';
import { UsageService } from './quota/usage.service';
import { FaqCacheService } from './core/faq-cache.service';
import { AssistantController } from './assistant.controller';
import { PlatformAssistantController } from './platform-assistant.controller';

/**
 * AI assistant module.
 *
 * Phase 0 shipped the Claude client wrapper and the idea/generation service
 * behind `POST .../forms/generate`. Phase 1 added the help/guide bot, Phase 2
 * the org insights bot, Phase 3 expanded `IdeaService` to full Form App
 * generation and added the idea/suggestion chat surface. Phase 4 (this) adds
 * the platform-level superadmin surface — cross-org Q&A on its own controller
 * with no OrgMemberGuard, see AI_ASSISTANT_PLAN.md §10.
 *
 * SubjectsModule/FormAppsModule are imported so `IdeaService.generateFormApp()`
 * can call their creation methods directly rather than re-implementing
 * SubjectType/FormApp/FormAppStep creation (slug uniqueness, step limits,
 * cross-tenant checks) a second time. AdminModule is imported so
 * PlatformInsightsService can call `AdminService.getDashboard()` directly
 * rather than re-deriving the same platform-wide counts a second time —
 * AdminModule already exports it for exactly this kind of reuse.
 *
 * PrismaService, AuditService, and RedisService are provided by global
 * modules and intentionally not redeclared here — see the note in
 * forms.module.ts on why that would instantiate a second copy.
 */
@Module({
  imports: [AnalyticsModule, SubjectsModule, FormAppsModule, AdminModule],
  controllers: [AssistantController, PlatformAssistantController],
  providers: [
    ClaudeClientService,
    AgentLoopService,
    IdeaService,
    AssistantChatService,
    PlatformInsightsService,
    SessionService,
    QuotaService,
    UsageService,
    FaqCacheService,
  ],
  exports: [ClaudeClientService, IdeaService],
})
export class AssistantModule {}
