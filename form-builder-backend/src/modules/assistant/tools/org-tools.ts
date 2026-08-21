import type Anthropic from '@anthropic-ai/sdk';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ClaudeClientService } from '../claude-client.service';
import type { IdeaService } from '../idea.service';
import type { AnalyticsService } from '../../analytics/analytics.service';
import { EXPLAIN_RULE_TOOL, explainRule } from './explain-rule.tool';
import { PROPOSE_RULE_TOOL, proposeRule } from './propose-rule.tool';
import {
  GET_FORM_ANALYTICS_TOOL,
  getFormAnalytics,
} from './get-form-analytics.tool';
import {
  QUERY_SUBMISSIONS_TOOL,
  querySubmissions,
} from './query-submissions.tool';
import {
  SUGGEST_TEMPLATES_TOOL,
  suggestTemplates,
} from './suggest-templates.tool';
import {
  PLAN_FORM_TOOL,
  PLAN_FORM_APP_TOOL,
  planForm,
  planFormApp,
} from './plan-form.tool';
import { CREATE_FROM_PLAN_TOOL, createFromPlan } from './create-from-plan.tool';
import { REVIEW_FORM_TOOL, reviewForm } from './review-form.tool';
import { ASK_CLARIFYING_QUESTION_TOOL } from './ask-clarifying-question.tool';
import { capToolResult } from './tool-result-cap';

/** Org role hierarchy, mirroring common/guards/role.guard.ts — kept local so this file has no dependency on the guards module. */
export type OrgRole = 'VIEWER' | 'EDITOR' | 'ADMIN';
const ROLE_LEVEL: Record<OrgRole, number> = { VIEWER: 1, EDITOR: 2, ADMIN: 3 };

/**
 * Every tool available to an org-scoped assistant turn, regardless of which
 * mode (help / insights / build) the user is nominally in — see
 * AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.1. This list is rendered into the
 * request in this exact order on every call; it must never be filtered per
 * user or per org, or the cached prefix forks and stops being reusable.
 * Per-user authorization instead happens inside runOrgTool, per §3.1's
 * "authorization moves into the tool handlers" design — see TOOL_MIN_ROLE
 * below and tool-authorization.spec.ts.
 *
 * search_help_docs is deliberately absent — the help corpus it used to fetch
 * is now inlined directly into the system prompt (see
 * system-prompts.ts#ORG_SYSTEM_PROMPT), which both removes a round trip and
 * is what pushes the prefix over Haiku 4.5's cacheable minimum (C1/C8).
 *
 * cross_org_query is deliberately absent — see tools/cross-org-query.tool.ts
 * and platform-insights.spec.ts, which assert it is wired only into
 * platform-insights.service.ts.
 */
export const ORG_TOOLS: Anthropic.Tool[] = [
  ASK_CLARIFYING_QUESTION_TOOL,
  EXPLAIN_RULE_TOOL,
  GET_FORM_ANALYTICS_TOOL,
  QUERY_SUBMISSIONS_TOOL,
  PROPOSE_RULE_TOOL,
  SUGGEST_TEMPLATES_TOOL,
  PLAN_FORM_TOOL,
  PLAN_FORM_APP_TOOL,
  CREATE_FROM_PLAN_TOOL,
  REVIEW_FORM_TOOL,
];

/**
 * Minimum org role to invoke each tool — the mechanism that keeps the
 * pre-existing EDITOR boundary on "build" actions even though the route
 * itself now admits VIEWER (see AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.1/§6.1
 * and this module's controller). Read/insight tools stay at VIEWER, exactly
 * where the old insights routes already were; every generation/build tool
 * requires EDITOR, exactly where the old help/idea routes already were —
 * this is a relocation of the existing boundary, not a widening of it.
 * ask_clarifying_question needs no elevated role: it creates nothing.
 *
 * A tool with no entry here defaults to VIEWER — see tool-authorization.spec.ts,
 * which asserts every tool has an explicit entry so that default is never
 * silently relied on.
 */
export const TOOL_MIN_ROLE: Record<string, OrgRole> = {
  [ASK_CLARIFYING_QUESTION_TOOL.name]: 'VIEWER',
  [EXPLAIN_RULE_TOOL.name]: 'VIEWER',
  [GET_FORM_ANALYTICS_TOOL.name]: 'VIEWER',
  [QUERY_SUBMISSIONS_TOOL.name]: 'VIEWER',
  [PROPOSE_RULE_TOOL.name]: 'EDITOR',
  [SUGGEST_TEMPLATES_TOOL.name]: 'EDITOR',
  [PLAN_FORM_TOOL.name]: 'EDITOR',
  [PLAN_FORM_APP_TOOL.name]: 'EDITOR',
  [CREATE_FROM_PLAN_TOOL.name]: 'EDITOR',
  [REVIEW_FORM_TOOL.name]: 'EDITOR',
};

function roleSatisfies(userRole: OrgRole, required: OrgRole): boolean {
  return ROLE_LEVEL[userRole] >= ROLE_LEVEL[required];
}

export interface OrgToolDeps {
  prisma: PrismaService;
  claude: ClaudeClientService;
  idea: IdeaService;
  analytics: AnalyticsService;
  orgId: string;
  userId: string;
  role: OrgRole;
  /** The form the user currently has open, if any — used when a tool call omits formId. */
  currentFormId?: string;
}

/**
 * Single dispatcher for every ORG_TOOLS name (other than
 * ask_clarifying_question, which agent-loop.service.ts intercepts before
 * dispatch — see that file), replacing the three near-identical `runTool`
 * switches that used to live on
 * HelpGuideService/OrgInsightsService/IdeaChatService.
 *
 * Errors are caught here and reduced to one fixed, user-safe string per tool
 * family — the raw error goes to the caller's logger only, never into the
 * model's context, where it could otherwise be quoted back to the user
 * verbatim (see AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.7, R7).
 */
export async function runOrgTool(
  deps: OrgToolDeps,
  name: string,
  rawInput: unknown,
  onLog: (error: unknown) => void,
): Promise<string> {
  const input = (rawInput ?? {}) as Record<string, unknown>;

  const requiredRole = TOOL_MIN_ROLE[name] ?? 'VIEWER';
  if (!roleSatisfies(deps.role, requiredRole)) {
    return `Doing this needs ${requiredRole === 'EDITOR' ? 'Editor' : 'Admin'} access on this organization — your role is Viewer. Ask an Editor or Admin on your team, or ask me something read-only instead.`;
  }

  try {
    return capToolResult(await dispatch(deps, name, input));
  } catch (error) {
    onLog(error);
    return "That didn't work — please try rephrasing the request, or ask something more specific.";
  }
}

async function dispatch(
  deps: OrgToolDeps,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case EXPLAIN_RULE_TOOL.name: {
      const formId = pickFormId(input, deps.currentFormId);
      if (!formId) return 'No form id was given and no form is currently open.';
      return await explainRule(deps.prisma, deps.orgId, formId);
    }

    case PROPOSE_RULE_TOOL.name: {
      const formId = pickFormId(input, deps.currentFormId);
      if (!formId) return 'No form id was given and no form is currently open.';
      const description =
        typeof input.description === 'string' ? input.description : '';
      const result = await proposeRule(
        deps.prisma,
        deps.claude,
        deps.orgId,
        formId,
        description,
      );
      return JSON.stringify(result);
    }

    case GET_FORM_ANALYTICS_TOOL.name:
      return await getFormAnalytics(deps.analytics, deps.orgId, input);

    case QUERY_SUBMISSIONS_TOOL.name:
      return await querySubmissions(deps.prisma, deps.orgId, input);

    case SUGGEST_TEMPLATES_TOOL.name:
      return await suggestTemplates(deps.prisma, input);

    case PLAN_FORM_TOOL.name:
      return await planForm(
        deps.idea,
        deps.prisma,
        deps.orgId,
        deps.userId,
        input,
      );

    case PLAN_FORM_APP_TOOL.name:
      return await planFormApp(
        deps.idea,
        deps.prisma,
        deps.orgId,
        deps.userId,
        input,
      );

    case CREATE_FROM_PLAN_TOOL.name:
      return await createFromPlan(
        deps.idea,
        deps.prisma,
        deps.orgId,
        deps.userId,
        input,
      );

    case REVIEW_FORM_TOOL.name: {
      const formId =
        typeof input.formId === 'string' ? input.formId : undefined;
      if (!formId) return 'A formId is required.';
      return await reviewForm(deps.prisma, deps.claude, deps.orgId, formId);
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

function pickFormId(
  input: Record<string, unknown>,
  currentFormId?: string,
): string | undefined {
  return typeof input.formId === 'string' && input.formId
    ? input.formId
    : currentFormId;
}
