import type Anthropic from '@anthropic-ai/sdk';
import type { AnalyticsService } from '../../analytics/analytics.service';

export const GET_FORM_ANALYTICS_TOOL: Anthropic.Tool = {
  name: 'get_form_analytics',
  description:
    'Get pre-aggregated analytics for this organization — an org-wide summary (forms by status, submission totals and trend, completion rate), a daily submissions/views/starts time series (org-wide or for one specific form), or the busiest forms by submission volume. Use this for any "how many", "trend", "top forms", or completion-rate question — this is faster and cheaper than query_submissions for anything these pre-aggregated numbers already answer.',
  input_schema: {
    type: 'object',
    properties: {
      view: {
        type: 'string',
        enum: ['summary', 'timeseries', 'top_forms'],
        description:
          'summary: org-wide headline numbers. timeseries: daily submissions/views/starts. top_forms: busiest forms by submissions.',
      },
      formId: {
        type: 'string',
        description:
          'Only for view=timeseries, when the question is about one specific form. Omit for the org-wide series.',
      },
      days: {
        type: 'number',
        description:
          'How many days back to look, for view=summary or view=timeseries. Default 30, max 365.',
      },
      limit: {
        type: 'number',
        description:
          'Only for view=top_forms — how many forms to return. Default 5, max 25.',
      },
    },
    required: ['view'],
  },
};

interface GetFormAnalyticsInput {
  view?: unknown;
  formId?: unknown;
  days?: unknown;
  limit?: unknown;
}

/** This tool never touches FormSubmission.answers — every view here is a pre-aggregated FormAnalytics rollup. */
export async function getFormAnalytics(
  analytics: AnalyticsService,
  orgId: string,
  rawInput: GetFormAnalyticsInput,
): Promise<string> {
  const days = typeof rawInput.days === 'number' ? rawInput.days : undefined;

  switch (rawInput.view) {
    case 'summary': {
      const summary = await analytics.getOrgSummary(orgId, days);
      return JSON.stringify(summary);
    }

    case 'timeseries': {
      const formId =
        typeof rawInput.formId === 'string' ? rawInput.formId : undefined;
      const series = formId
        ? await analytics.getFormAnalytics(orgId, formId, days)
        : await analytics.getGlobalAnalytics(orgId, days);
      return JSON.stringify(series);
    }

    case 'top_forms': {
      const limit =
        typeof rawInput.limit === 'number' ? rawInput.limit : undefined;
      const top = await analytics.getTopForms(orgId, limit);
      return JSON.stringify(top);
    }

    default:
      return 'Unknown view — must be one of "summary", "timeseries", "top_forms".';
  }
}
