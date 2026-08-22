import type Anthropic from '@anthropic-ai/sdk';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../common/infra/prisma/prisma.service';
import { outlineForm, outlineFormApp, type IdeaService } from '../core/idea.service';

/** 24h — long enough to review and confirm in the same sitting, short enough that stale plans don't linger. */
const PLAN_TTL_MS = 24 * 60 * 60 * 1000;

export const PLAN_FORM_TOOL: Anthropic.Tool = {
  name: 'plan_form',
  description:
    'Generate a full new standalone form from a plain-language description and hold it for the user to confirm — this does NOT create anything yet. Returns a plan id and an outline (title, question count, question labels). Tell the user what you planned and that calling create_from_plan will make it real; use this for one standalone form, not a multi-step program (use plan_form_app for that).',
  input_schema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: "What the form should collect, in the user's own words.",
      },
    },
    required: ['description'],
  },
};

export const PLAN_FORM_APP_TOOL: Anthropic.Tool = {
  name: 'plan_form_app',
  description:
    "Generate a full new multi-step Form App (a subject type, an app, and one form per step) from a plain-language description and hold it for the user to confirm — this does NOT create anything yet. Returns a plan id and an outline (subject type, app name, each step's title and question count). Use this when the description implies tracking something over time across multiple visits or check-ins.",
  input_schema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description:
          "What the program should track and collect, in the user's own words.",
      },
    },
    required: ['description'],
  },
};

interface PlanInput {
  description?: unknown;
}

export async function planForm(
  idea: IdeaService,
  prisma: PrismaService,
  orgId: string,
  userId: string,
  rawInput: PlanInput,
): Promise<string> {
  const description =
    typeof rawInput.description === 'string' ? rawInput.description : '';
  if (!description) return 'A description is required.';

  const { data } = await idea.generateFormPreview(orgId, userId, description);
  const outline = outlineForm(data);

  const plan = await prisma.writer.assistantPlan.create({
    data: {
      organizationId: orgId,
      userId,
      kind: 'FORM',
      payload: data as unknown as Prisma.InputJsonValue,
      outline: outline as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + PLAN_TTL_MS),
    },
  });

  return JSON.stringify({ planId: plan.id, kind: 'FORM', outline });
}

export async function planFormApp(
  idea: IdeaService,
  prisma: PrismaService,
  orgId: string,
  userId: string,
  rawInput: PlanInput,
): Promise<string> {
  const description =
    typeof rawInput.description === 'string' ? rawInput.description : '';
  if (!description) return 'A description is required.';

  const { data } = await idea.generateFormAppPreview(
    orgId,
    userId,
    description,
  );
  const outline = outlineFormApp(data);

  const plan = await prisma.writer.assistantPlan.create({
    data: {
      organizationId: orgId,
      userId,
      kind: 'FORM_APP',
      payload: data as unknown as Prisma.InputJsonValue,
      outline: outline as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + PLAN_TTL_MS),
    },
  });

  return JSON.stringify({ planId: plan.id, kind: 'FORM_APP', outline });
}
