import type Anthropic from '@anthropic-ai/sdk';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { IdeaService } from '../idea.service';

export const CREATE_FROM_PLAN_TOOL: Anthropic.Tool = {
  name: 'create_from_plan',
  description:
    'Turn a previously planned form or Form App into real DRAFT rows — call this only after the user has confirmed a plan_form/plan_form_app outline. Nothing is created until this is called.',
  input_schema: {
    type: 'object',
    properties: {
      planId: {
        type: 'string',
        description: 'The plan id returned by plan_form or plan_form_app.',
      },
    },
    required: ['planId'],
  },
};

interface CreateFromPlanInput {
  planId?: unknown;
}

export async function createFromPlan(
  idea: IdeaService,
  prisma: PrismaService,
  orgId: string,
  userId: string,
  rawInput: CreateFromPlanInput,
): Promise<string> {
  const planId =
    typeof rawInput.planId === 'string' ? rawInput.planId : undefined;
  if (!planId) {
    return 'A planId is required — call plan_form or plan_form_app first.';
  }

  const plan = await prisma.reader.assistantPlan.findFirst({
    where: { id: planId, organizationId: orgId },
  });
  if (!plan) {
    return 'No plan with that id was found in this organization.';
  }
  if (plan.consumedAt) {
    return 'That plan was already used to create something — plan again if you want another one.';
  }
  if (plan.expiresAt.getTime() < Date.now()) {
    return 'That plan has expired — please ask me to plan it again.';
  }

  const consumed = await prisma.writer.assistantPlan.updateMany({
    where: { id: plan.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  // Someone else raced us to consume it (e.g. a duplicated tool call) — don't create twice.
  if (consumed.count === 0) {
    return 'That plan was already used to create something — plan again if you want another one.';
  }

  if (plan.kind === 'FORM') {
    const form = await idea.createFormFromData(
      orgId,
      userId,
      plan.payload as any,
    );
    return JSON.stringify({
      kind: 'FORM',
      formId: form.id,
      title: form.title,
      questionCount: Array.isArray(form.questionsJson)
        ? form.questionsJson.length
        : 0,
    });
  }

  const result = await idea.createFormAppFromData(
    orgId,
    userId,
    plan.payload as any,
  );
  return JSON.stringify({ kind: 'FORM_APP', ...result });
}
