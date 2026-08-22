import { Logger } from '@nestjs/common';
import { AssistantMode } from '@prisma/client';
import { PrismaService } from '../../../common/infra/prisma/prisma.service';
import { AnalyticsService } from '../../analytics/analytics.service';
import { ClaudeClientService } from '../core/claude-client.service';
import { IdeaService } from '../core/idea.service';
import type { FormPlanOutline, FormAppPlanOutline } from '../core/idea.service';
import { AgentLoopService, type AgentLoopResult } from '../core/agent-loop.service';
import { FaqCacheService } from '../core/faq-cache.service';
import { ORG_TOOLS, runOrgTool, type OrgRole } from '../tools/org-tools';
import { GET_FORM_ANALYTICS_TOOL } from '../tools/get-form-analytics.tool';
import { PLAN_FORM_TOOL, PLAN_FORM_APP_TOOL } from '../tools/plan-form.tool';
import { CREATE_FROM_PLAN_TOOL } from '../tools/create-from-plan.tool';
import type { GeneratedFormAppResult } from '../core/idea.service';
import { ORG_SYSTEM_PROMPT } from '../prompts/system-prompts';

export interface TimeseriesPoint {
  date: string;
  submissions: number;
  views: number;
  starts: number;
}

export interface PlanSummary {
  planId: string;
  kind: 'FORM' | 'FORM_APP';
  outline: FormPlanOutline | FormAppPlanOutline;
}

export type CreatedSummary =
  | { kind: 'FORM'; formId: string; title: string; questionCount: number }
  | ({ kind: 'FORM_APP' } & GeneratedFormAppResult);

export interface OrgChatParams {
  agentLoop: AgentLoopService;
  claude: ClaudeClientService;
  prisma: PrismaService;
  idea: IdeaService;
  analytics: AnalyticsService;
  faqCache: FaqCacheService;
  logger: Logger;
  orgId: string;
  userId: string;
  role: OrgRole;
  sessionId?: string;
  message: string;
  mode: AssistantMode;
  auditAction: string;
  /** The form the user currently has open, if any. */
  currentFormId?: string;
  /**
   * UI-only nudge from the frontend's mode toggler (Help/Insights/Build) — a
   * short line appended to the user turn, never a change to `tools` or
   * `system`. See AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.6: the chips must not
   * fork the cached prefix.
   */
  modeHint?: string;
}

export type OrgChatResult = AgentLoopResult & {
  /** The most recent get_form_analytics(view=timeseries) result this turn, if any. */
  chartData?: TimeseriesPoint[];
  /** The most recent plan_form/plan_form_app result this turn, if any — render as a "Create draft" card. */
  plan?: PlanSummary;
  /** The most recent create_from_plan result this turn, if any — render as a deep link into the builder. */
  created?: CreatedSummary;
};

/**
 * Shared body for every org-scoped assistant wrapper (help/insights/build/
 * auto) — all four now differ only in `mode`/`auditAction`, so this is the
 * one place the ORG_TOOLS/ORG_SYSTEM_PROMPT wiring, the per-request context
 * hint, and structured-result capture (chart data, plan outlines) live. See
 * AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.1.
 */
export async function runOrgChat(
  params: OrgChatParams,
): Promise<OrgChatResult> {
  let chartData: TimeseriesPoint[] | undefined;
  let plan: PlanSummary | undefined;
  let created: CreatedSummary | undefined;

  const hints = [
    params.currentFormId ? currentFormHint(params.currentFormId) : null,
    params.modeHint ?? null,
  ].filter((h): h is string => !!h);

  // Eligible for the FAQ cache only with no currentFormId — that hint is the
  // one per-request value that could otherwise leak into a "generic" answer.
  // See faq-cache.service.ts's doc comment for the rest of the eligibility
  // bar (enforced in agent-loop.service.ts: no tool called, clean stop).
  const faqCacheKey = params.currentFormId
    ? undefined
    : params.faqCache.buildKey(params.message, params.modeHint);

  const result = await params.agentLoop.run({
    orgId: params.orgId,
    userId: params.userId,
    sessionId: params.sessionId,
    mode: params.mode,
    message: params.message,
    system: ORG_SYSTEM_PROMPT,
    tools: ORG_TOOLS,
    contextHint: hints.length > 0 ? hints.join('; ') : undefined,
    faqCacheKey,
    onToolResult: (name, input, output) => {
      const typedInput = (input ?? {}) as Record<string, unknown>;
      if (
        name === GET_FORM_ANALYTICS_TOOL.name &&
        typedInput.view === 'timeseries'
      ) {
        chartData = parseJson<TimeseriesPoint[]>(output, Array.isArray);
      }
      if (name === PLAN_FORM_TOOL.name || name === PLAN_FORM_APP_TOOL.name) {
        plan = parseJson<PlanSummary>(
          output,
          (v): v is PlanSummary =>
            !!v && typeof (v as PlanSummary).planId === 'string',
        );
      }
      if (name === CREATE_FROM_PLAN_TOOL.name) {
        created = parseJson<CreatedSummary>(
          output,
          (v): v is CreatedSummary =>
            !!v &&
            ((v as CreatedSummary).kind === 'FORM' ||
              (v as CreatedSummary).kind === 'FORM_APP'),
        );
      }
    },
    runTool: (name, input) =>
      runOrgTool(
        {
          prisma: params.prisma,
          claude: params.claude,
          idea: params.idea,
          analytics: params.analytics,
          orgId: params.orgId,
          userId: params.userId,
          role: params.role,
          currentFormId: params.currentFormId,
        },
        name,
        input,
        (error) => params.logger.warn(`Tool "${name}" failed`, error as Error),
      ),
    auditAction: params.auditAction,
  });

  return { ...result, chartData, plan, created };
}

function currentFormHint(formId: string): string {
  return `the user currently has form ${formId} open — use it for explain_rule/propose_rule if the question is about "this form" and no other form id is implied`;
}

function parseJson<T>(
  raw: string,
  isValid: (value: unknown) => boolean,
): T | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? (parsed as T) : undefined;
  } catch {
    return undefined;
  }
}
