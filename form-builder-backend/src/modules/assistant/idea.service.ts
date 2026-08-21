import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
// Must be zod's v4 API (see claude-client.service.ts) for zodOutputFormat().
import { z } from 'zod/v4';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  ClaudeClientService,
  MODEL_SONNET,
  type UsageInfo,
} from './claude-client.service';
import { publicSlug } from '../forms/forms.service';
import { SubjectsService } from '../subjects/subjects.service';
import { FormAppsService } from '../form-apps/form-apps.service';

/**
 * Same subset of QuestionType the previous Gemini prompt generated from —
 * this is a provider swap, not a capability expansion. Widening this to the
 * rest of QuestionType (FILE_UPLOAD, MATRIX, REPEATING_SECTION, ...) is
 * Phase 3 (AI_ASSISTANT_PLAN.md §10).
 */
const GENERATABLE_QUESTION_TYPES = [
  'SHORT_TEXT',
  'LONG_TEXT',
  'NUMBER',
  'EMAIL',
  'PHONE',
  'URL',
  'SINGLE_CHOICE',
  'MULTI_CHOICE',
  'DROPDOWN',
  'STAR_RATING',
  'NPS',
  'SLIDER',
  'DATE',
] as const;

const GeneratedQuestionSchema = z.object({
  id: z.string().describe('A short stable id, e.g. "q1", "q2".'),
  type: z.enum(GENERATABLE_QUESTION_TYPES),
  label: z.string(),
  required: z.boolean(),
  options: z
    .array(z.string())
    .describe(
      'Choice options. Non-empty for SINGLE_CHOICE, MULTI_CHOICE, and DROPDOWN; an empty array for every other type.',
    ),
});

const GeneratedFormSchema = z.object({
  title: z.string(),
  description: z.string(),
  questions: z.array(GeneratedQuestionSchema),
});

const SYSTEM_PROMPT = `You are an expert form builder assistant for Vibha, an education-focused nonprofit. Generate a comprehensive, well-structured form based on the user's description.

Guidelines:
- Prefer the simplest question type that captures the data correctly.
- Mark a question required only when the form genuinely cannot be used without it.
- Order questions in the sequence a respondent would naturally answer them.
- Keep labels concise and unambiguous — forms are often filled out by program staff in the field, sometimes over a slow connection.`;

const GeneratedStepSchema = z.object({
  title: z.string(),
  description: z.string(),
  questions: z.array(GeneratedQuestionSchema),
});

const GeneratedFormAppSchema = z.object({
  subjectTypeName: z
    .string()
    .describe(
      'What kind of record this program tracks over time, e.g. "Student", "Household", "School".',
    ),
  appName: z.string(),
  appDescription: z.string(),
  steps: z
    .array(GeneratedStepSchema)
    .min(1)
    .max(10)
    .describe(
      'One form per step, in the order a data-collector fills them. The first step registers the record.',
    ),
});

const FORM_APP_SYSTEM_PROMPT = `You design multi-step data-collection programs ("Form Apps") for Vibha, an education-focused nonprofit. A Form App tracks one kind of record (a student, a household, a school) across multiple visits or check-ins, rather than one standalone form.

Guidelines:
- Name the kind of record being tracked (subjectTypeName) — this is what every step's data ultimately attaches to.
- The first step always registers a new record (e.g. "Student registration") — later steps add data to an already-registered record (e.g. "Monthly attendance check").
- Keep each step focused on one occasion or purpose; split a long list of unrelated questions into separate steps rather than one long form.
- Follow the same per-question guidance as single-form generation: simplest question type that fits, required only when genuinely necessary, concise labels.`;

export interface GeneratedFormAppResult {
  subjectType: { id: string; name: string };
  formApp: { id: string; name: string; slug: string };
  steps: Array<{ id: string; title: string; formId: string }>;
}

type GeneratedForm = z.infer<typeof GeneratedFormSchema>;
type GeneratedFormApp = z.infer<typeof GeneratedFormAppSchema>;

/** The compact summary shown to the model/user before a plan is turned into real rows — never the full payload. */
export interface FormPlanOutline {
  title: string;
  questionCount: number;
  questions: string[];
}

export interface FormAppPlanOutline {
  subjectTypeName: string;
  appName: string;
  steps: Array<{ title: string; questionCount: number }>;
}

export function outlineForm(data: GeneratedForm): FormPlanOutline {
  return {
    title: data.title || 'AI Generated Form',
    questionCount: data.questions.length,
    questions: data.questions.map((q) => q.label),
  };
}

export function outlineFormApp(data: GeneratedFormApp): FormAppPlanOutline {
  return {
    subjectTypeName: data.subjectTypeName,
    appName: data.appName,
    steps: data.steps.map((s) => ({
      title: s.title,
      questionCount: s.questions.length,
    })),
  };
}

/**
 * Generates forms from a plain-language description.
 *
 * Replaces the previous Gemini-backed FormsService#generateFormWithAI
 * one-for-one — same inputs, same DRAFT-form output shape, same audit action —
 * so `POST /organizations/:orgId/forms/generate` keeps working unchanged for
 * callers. See AI_ASSISTANT_PLAN.md §2 (provider cutover) and §10 (phasing).
 */
@Injectable()
export class IdeaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly claude: ClaudeClientService,
    private readonly subjects: SubjectsService,
    private readonly formApps: FormAppsService,
  ) {}

  /**
   * Generation only — no DB write. Used directly by the `POST .../forms/generate`
   * immediate-create path (via generateForm below) and by the assistant's
   * `plan_form` tool, which persists an AssistantPlan instead of a Form so the
   * user can confirm before anything real is created — see
   * AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.3(c).
   */
  async generateFormPreview(
    orgId: string,
    userId: string,
    prompt: string,
  ): Promise<{ data: GeneratedForm; usage: UsageInfo }> {
    if (!prompt || !prompt.trim()) {
      throw new BadRequestException('A prompt is required.');
    }

    const { data, usage } = await this.claude.structuredCompletion({
      model: MODEL_SONNET,
      system: SYSTEM_PROMPT,
      userMessage: prompt,
      schema: GeneratedFormSchema,
    });

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'form.plan_generated_ai',
      resource: 'form',
      metadata: {
        formTitle: data.title,
        prompt,
        model: MODEL_SONNET,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
    });

    return { data, usage };
  }

  /** The DB-write half of form generation, given already-generated data — see generateFormPreview above. */
  async createFormFromData(
    orgId: string,
    createdById: string,
    formData: GeneratedForm,
  ) {
    const form = await this.prisma.writer.form.create({
      data: {
        organizationId: orgId,
        createdById,
        slug: publicSlug(),
        title: formData.title || 'AI Generated Form',
        description: formData.description || '',
        questionsJson: formData.questions,
        pagesJson: [],
        logicJson: [],
        themeConfig: {},
        status: 'DRAFT',
        layoutMode: 'DOCUMENT',
      },
    });

    this.audit.log({
      organizationId: orgId,
      userId: createdById,
      action: 'form.generated_ai',
      resource: 'form',
      resourceId: form.id,
      metadata: { formTitle: form.title, model: MODEL_SONNET },
    });

    return form;
  }

  /** Generate-and-create in one call — the shape `POST .../forms/generate` (an immediate-create route, not the assistant chat) has always used. */
  async generateForm(orgId: string, createdById: string, prompt: string) {
    const { data } = await this.generateFormPreview(orgId, createdById, prompt);
    return this.createFormFromData(orgId, createdById, data);
  }

  /**
   * Generates a full multi-step Form App: a SubjectType, a FormApp, and one
   * DRAFT Form + FormAppStep per proposed step. Creation order and the
   * services called mirror `FormAppsService`/`SubjectsService`'s own
   * creation flow exactly (no `$transaction` there either) — see
   * AI_ASSISTANT_PLAN.md §10 Phase 3 for the research this was built from.
   *
   * Scope limit: only the first step is wired as the registration form
   * (`subjectRole: 'REGISTERS'`, via `SubjectsService#updateSubjectType` —
   * the only supported write path for that field today). Later steps are
   * left at the schema default (`NONE`) rather than asserting an `ATTACHES`
   * role the codebase has no existing write path for — that's a real gap in
   * today's Form Apps feature, not something this generator should paper
   * over by inventing state.
   */
  async generateFormAppPreview(
    orgId: string,
    userId: string,
    prompt: string,
  ): Promise<{ data: GeneratedFormApp; usage: UsageInfo }> {
    if (!prompt || !prompt.trim()) {
      throw new BadRequestException('A prompt is required.');
    }

    const { data, usage } = await this.claude.structuredCompletion({
      model: MODEL_SONNET,
      system: FORM_APP_SYSTEM_PROMPT,
      userMessage: prompt,
      schema: GeneratedFormAppSchema,
      maxTokens: 12000,
    });

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'form_app.plan_generated_ai',
      resource: 'form_app',
      metadata: {
        prompt,
        subjectType: data.subjectTypeName,
        stepCount: data.steps.length,
        model: MODEL_SONNET,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
    });

    return { data, usage };
  }

  /** The DB-write half of Form App generation, given already-generated data — see generateFormAppPreview above. */
  async createFormAppFromData(
    orgId: string,
    createdById: string,
    data: GeneratedFormApp,
  ): Promise<GeneratedFormAppResult> {
    const subjectType = await this.getOrCreateSubjectType(
      orgId,
      createdById,
      data.subjectTypeName,
    );
    const formApp = await this.createAppWithNameFallback(
      orgId,
      createdById,
      data.appName,
      subjectType.id,
      data.appDescription,
    );

    const steps: GeneratedFormAppResult['steps'] = [];
    for (const [index, step] of data.steps.entries()) {
      const form = await this.prisma.writer.form.create({
        data: {
          organizationId: orgId,
          createdById,
          slug: publicSlug(),
          title: step.title || `Step ${index + 1}`,
          description: step.description || '',
          questionsJson: step.questions,
          pagesJson: [],
          logicJson: [],
          themeConfig: {},
          status: 'DRAFT',
          layoutMode: 'DOCUMENT',
        },
      });

      if (index === 0) {
        await this.subjects.updateSubjectType(
          orgId,
          subjectType.id,
          { registrationFormId: form.id },
          createdById,
        );
      }

      const createdStep = await this.formApps.createStep(
        orgId,
        formApp.id,
        { formId: form.id, title: step.title },
        createdById,
      );
      steps.push({
        id: createdStep.id,
        title: createdStep.title,
        formId: form.id,
      });
    }

    this.audit.log({
      organizationId: orgId,
      userId: createdById,
      action: 'form_app.generated_ai',
      resource: 'form_app',
      resourceId: formApp.id,
      metadata: {
        subjectType: subjectType.name,
        stepCount: steps.length,
        model: MODEL_SONNET,
      },
    });

    return {
      subjectType: { id: subjectType.id, name: subjectType.name },
      formApp: { id: formApp.id, name: formApp.name, slug: formApp.slug },
      steps,
    };
  }

  /** Generate-and-create in one call — the shape `POST .../forms/generate`-style immediate-create callers use. */
  async generateFormApp(
    orgId: string,
    createdById: string,
    prompt: string,
  ): Promise<GeneratedFormAppResult> {
    const { data } = await this.generateFormAppPreview(
      orgId,
      createdById,
      prompt,
    );
    return this.createFormAppFromData(orgId, createdById, data);
  }

  /** Reuses an existing subject type of the same name rather than failing when the AI proposes one that already exists. */
  private async getOrCreateSubjectType(
    orgId: string,
    createdById: string,
    name: string,
  ) {
    try {
      return await this.subjects.createSubjectType(
        orgId,
        { name },
        createdById,
      );
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      const existing = await this.prisma.reader.subjectType.findFirst({
        where: {
          organizationId: orgId,
          name: { equals: name, mode: 'insensitive' },
          deletedAt: null,
        },
      });
      if (!existing) throw error;
      return existing;
    }
  }

  /** Disambiguates the app name on a slug collision rather than failing the whole generation over a naming clash. */
  private async createAppWithNameFallback(
    orgId: string,
    createdById: string,
    name: string,
    subjectTypeId: string,
    description: string,
  ) {
    try {
      return await this.formApps.createApp(
        orgId,
        { name, subjectTypeId, description },
        createdById,
      );
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      return this.formApps.createApp(
        orgId,
        {
          name: `${name} (${Date.now().toString(36)})`,
          subjectTypeId,
          description,
        },
        createdById,
      );
    }
  }
}
