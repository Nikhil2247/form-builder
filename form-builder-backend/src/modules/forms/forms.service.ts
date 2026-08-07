import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateFormDto } from './dto/create-form.dto';
import { UpdateFormDto } from './dto/update-form.dto';
import { nanoid } from 'nanoid';
import * as argon2 from 'argon2';

import { RedisService } from '../../common/redis/redis.service';
import {
  parsePagination,
  paginated,
  type Pagination,
} from '../../common/pagination/pagination';
import {
  formListSelect,
  formTrashSelect,
  formDetailSelect,
  submissionGridSelect,
} from '../../common/prisma/selects';

/**
 * Escape a value for CSV, defending against CSV injection.
 *
 * A cell beginning with = + - @ (or tab/CR) is interpreted as a formula by
 * Excel/Sheets, so a respondent answering `=cmd|'/c calc'!A1` gets code
 * execution on whoever opens the export. Prefixing with a single quote
 * neutralises it while still displaying the original text.
 */
function csvCell(value: string): string {
  let v = value ?? '';
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

@Injectable()
export class FormsService {
  private readonly logger = new Logger(FormsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Create a new form within an organization.
   * Enforces the org's form quota.
   */
  async createForm(orgId: string, createdById: string, dto: CreateFormDto) {
    // Enforce org form quota
    const org = await this.prisma.reader.organization.findUnique({
      where: { id: orgId },
      select: { maxForms: true, _count: { select: { forms: true } } },
    });

    if (org && org._count.forms >= org.maxForms) {
      throw new ForbiddenException('Organization form limit reached. Contact your admin.');
    }

    const slug = dto.slug || nanoid(10);

    let passwordHash = null;
    if (dto.isPasswordProtected && dto.password) {
      passwordHash = await argon2.hash(dto.password, {
        type: argon2.argon2id,
        timeCost: 3,
        memoryCost: 65536,
        parallelism: 4,
      });
    }

    const form = await this.prisma.writer.form.create({
      data: {
        organizationId: orgId,
        createdById,
        slug,
        title: dto.title,
        description: dto.description,
        isQuizMode: dto.isQuizMode,
        isPasswordProtected: dto.isPasswordProtected,
        passwordHash,
        requireAuth: dto.requireAuth,
        allowMultiple: dto.allowMultiple,
        maxSubmissions: dto.maxSubmissions,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        themeConfig: dto.themeConfig || {},
        notifyEmails: dto.notifyEmails || [],
        pagesJson: dto.pages || [],
        questionsJson: dto.questions || [],
        logicJson: dto.logic || [],
        layoutMode: dto.layoutMode || 'DOCUMENT',
        status: 'DRAFT',
      },
    });

    // Audit log
    this.audit.log({
      organizationId: orgId,
      userId: createdById,
      action: 'form.created',
      resource: 'form',
      resourceId: form.id,
      metadata: { formTitle: form.title },
    });

    return form;
  }

  /**
   * Create a new form from an existing template.
   */
  async createFromTemplate(orgId: string, createdById: string, templateId: string) {
    const template = await this.prisma.reader.formTemplate.findUnique({
      where: { id: templateId }
    });
    if (!template) throw new NotFoundException('Template not found');

    const org = await this.prisma.reader.organization.findUnique({
      where: { id: orgId },
      select: { maxForms: true, _count: { select: { forms: true } } },
    });
    if (org && org._count.forms >= org.maxForms) {
      throw new ForbiddenException('Organization form limit reached. Contact your admin.');
    }

    const formData = (template.formData as any) || {};

    const form = await this.prisma.writer.form.create({
      data: {
        organizationId: orgId,
        createdById,
        slug: nanoid(10),
        title: template.name,
        description: template.description,
        pagesJson: formData.pages || [],
        questionsJson: formData.questions || [],
        logicJson: formData.logic || [],
        themeConfig: formData.theme || {},
        status: 'DRAFT',
      },
    });

    // Increment usage count
    await this.prisma.writer.formTemplate.update({
      where: { id: templateId },
      data: { usageCount: { increment: 1 } },
    });

    this.audit.log({
      organizationId: orgId,
      userId: createdById,
      action: 'form.created_from_template',
      resource: 'form',
      resourceId: form.id,
      metadata: { formTitle: form.title, templateId },
    });

    return form;
  }

  /**
   * Generate a form using Google Gemini AI based on a prompt.
   */
  async generateFormWithAI(orgId: string, createdById: string, prompt: string) {
    if (!process.env.GEMINI_API_KEY) {
      throw new BadRequestException('AI Generation is not configured on this server (missing GEMINI_API_KEY).');
    }

    try {
      // Dynamic import to avoid breaking if not installed properly or missing env vars at startup
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const systemInstruction = `You are an expert form builder AI. 
Generate a comprehensive form based on the user's prompt.
Respond ONLY with a valid JSON object matching this structure:
{
  "title": "Form Title",
  "description": "Form description",
  "questions": [
    {
      "id": "q1",
      "type": "SHORT_TEXT", // one of: SHORT_TEXT, LONG_TEXT, NUMBER, EMAIL, PHONE, URL, SINGLE_CHOICE, MULTI_CHOICE, DROPDOWN, STAR_RATING, NPS, SLIDER, DATE
      "label": "Question text",
      "required": true,
      "options": [] // required for SINGLE_CHOICE, MULTI_CHOICE, DROPDOWN (array of strings)
    }
  ]
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
        }
      });
      
      const rawText = response.text || "{}";
      const formData = JSON.parse(rawText);

      // Save it to the database
      const form = await this.prisma.writer.form.create({
        data: {
          organizationId: orgId,
          createdById,
          slug: (await import('nanoid')).nanoid(10),
          title: formData.title || 'AI Generated Form',
          description: formData.description || '',
          questionsJson: formData.questions || [],
          pagesJson: [],
          logicJson: [],
          themeConfig: {},
          status: 'DRAFT',
          layoutMode: 'DOCUMENT',
        }
      });
      
      this.audit.log({
        organizationId: orgId,
        userId: createdById,
        action: 'form.generated_ai',
        resource: 'form',
        resourceId: form.id,
        metadata: { formTitle: form.title, prompt },
      });

      return form;

    } catch (error) {
      console.error('AI Generation Error:', error);
      throw new BadRequestException('Failed to generate form using AI. Please try again.');
    }
  }

  /**
   * List forms for an organization, optionally filtered by status.
   */
  /**
   * List an organization's forms.
   *
   * Uses `formListSelect`, which omits `questionsJson`, `pagesJson`,
   * `logicJson`, `themeConfig`, `passwordHash`, and `notifyEmails`. The previous
   * `include` returned all of them: a page of 20 forms averaging 40 questions
   * each was several megabytes of JSONB to render a table of titles and counts.
   */
  async getForms(
    orgId: string,
    options: {
      status?: string;
      search?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    } = {},
    pagination: Pagination = parsePagination(),
  ) {
    const where: Prisma.FormWhereInput = { organizationId: orgId, deletedAt: null };

    if (options.status && options.status !== 'ALL') {
      where.status = options.status as any;
    }

    // Search is applied in the database. It used to be done client-side over
    // the loaded page, so a form on page 3 could not be found at all.
    const term = options.search?.trim();
    if (term) {
      where.OR = [
        { title: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        { slug: { contains: term, mode: 'insensitive' } },
      ];
    }

    // Allowlist: `sortBy` reaches Prisma as a key, so an unchecked value is a
    // way to probe columns and to sort on unindexed ones.
    const SORTABLE = new Set(['updatedAt', 'createdAt', 'title', 'status']);
    const sortBy = SORTABLE.has(options.sortBy ?? '') ? options.sortBy! : 'updatedAt';
    const sortOrder = options.sortOrder === 'asc' ? 'asc' : 'desc';

    const [forms, total] = await Promise.all([
      this.prisma.reader.form.findMany({
        where,
        // `id` breaks ties. Without a unique tiebreaker, rows sharing a sort
        // value can swap between pages and one is never shown.
        orderBy: [{ [sortBy]: sortOrder }, { id: 'asc' }],
        skip: pagination.skip,
        take: pagination.take,
        select: formListSelect,
      }),
      this.prisma.reader.form.count({ where }),
    ]);

    return paginated('forms', forms, pagination, total);
  }

  /**
   * Get a single form by ID within an organization.
   */
  async getFormById(orgId: string, formId: string) {
    const form = await this.prisma.reader.form.findFirst({
      where: { id: formId, organizationId: orgId, deletedAt: null },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        _count: {
          select: { submissions: true },
        },
      },
    });

    if (!form) throw new NotFoundException('Form not found');
    return form;
  }

  /**
   * Update form fields within an organization.
   */
  async updateForm(orgId: string, formId: string, dto: UpdateFormDto) {
    const form = await this.prisma.reader.form.findFirst({
      where: { id: formId, organizationId: orgId, deletedAt: null },
    });
    if (!form) throw new NotFoundException('Form not found');

    let passwordHash = form.passwordHash;
    if (dto.isPasswordProtected && dto.password) {
      passwordHash = await argon2.hash(dto.password, {
        type: argon2.argon2id,
        timeCost: 3,
        memoryCost: 65536,
        parallelism: 4,
      });
    }

    const updated = await this.prisma.writer.form.update({
      where: { id: formId },
      data: {
        title: dto.title,
        description: dto.description,
        slug: dto.slug,
        isQuizMode: dto.isQuizMode,
        isPasswordProtected: dto.isPasswordProtected,
        passwordHash,
        requireAuth: dto.requireAuth,
        allowMultiple: dto.allowMultiple,
        maxSubmissions: dto.maxSubmissions,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        themeConfig: dto.themeConfig,
        notifyEmails: dto.notifyEmails,
        pagesJson: dto.pages,
        questionsJson: dto.questions,
        logicJson: dto.logic,
        ...(dto.layoutMode && { layoutMode: dto.layoutMode }),
      },
    });

    // Invalidate under BOTH the old and new slug — a slug change would
    // otherwise leave the form reachable at its previous public URL.
    await this.invalidatePublicFormCache(form.slug, updated.slug);
    await this.invalidateIngestPolicy(formId);

    return updated;
  }

  /**
   * Delete a form (soft delete). Only ADMINs can do this.
   */
  async deleteForm(orgId: string, formId: string) {
    const form = await this.prisma.reader.form.findFirst({
      where: { id: formId, organizationId: orgId, deletedAt: null },
    });
    if (!form) throw new NotFoundException('Form not found');

    await this.prisma.writer.form.update({
      where: { id: formId },
      data: { deletedAt: new Date() },
    });

    await this.invalidatePublicFormCache(form.slug);
    await this.invalidateIngestPolicy(formId);

    this.audit.log({
      organizationId: orgId,
      action: 'form.deleted',
      resource: 'form',
      resourceId: formId,
      metadata: { formTitle: form.title },
    });

    return { message: 'Form deleted successfully' };
  }

  /**
   * Restore a soft-deleted form. Only ADMINs can do this.
   */
  async restoreForm(orgId: string, formId: string) {
    const form = await this.prisma.reader.form.findFirst({
      where: { id: formId, organizationId: orgId, deletedAt: { not: null } },
    });
    if (!form) throw new NotFoundException('Deleted form not found');

    await this.prisma.writer.form.update({
      where: { id: formId },
      data: { deletedAt: null },
    });

    await this.invalidatePublicFormCache(form.slug);
    await this.invalidateIngestPolicy(formId);

    this.audit.log({
      organizationId: orgId,
      action: 'form.restored',
      resource: 'form',
      resourceId: formId,
      metadata: { formTitle: form.title },
    });

    return { message: 'Form restored successfully' };
  }

  /**
   * Get soft-deleted forms.
   */
  async getTrashedForms(orgId: string) {
    return this.prisma.reader.form.findMany({
      where: { organizationId: orgId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      // Trash is retention-bounded, so it stays a single unpaginated list —
      // but it does not need the form definitions either.
      select: formTrashSelect,
    });
  }

  /**
   * Publish a form — creates an immutable FormVersion snapshot.
   */
  async publishForm(
    orgId: string,
    formId: string,
    pagesJson: any,
    questionsJson: any,
    logicJson: any,
    themeJson: any,
    userId?: string,
  ) {
    // The version number, the FormVersion row, and the Form pointer must move
    // together. Previously these were three separate statements computed from a
    // stale read: a failure between them left currentVersion pointing at a
    // version that did not exist, and two concurrent publishes both computed the
    // same number and one died on @@unique([formId, version]).
    //
    // Serializable isolation makes concurrent publishes conflict cleanly; we
    // retry once on a write conflict (Prisma P2034) before surfacing an error.
    const runPublish = () =>
      this.prisma.writer.$transaction(
        async (tx: any) => {
          const form = await tx.form.findFirst({
            where: { id: formId, organizationId: orgId, deletedAt: null },
          });
          if (!form) throw new NotFoundException('Form not found');

          const questions = questionsJson ?? form.questionsJson ?? [];
          if (!Array.isArray(questions) || questions.length === 0) {
            throw new BadRequestException(
              'Cannot publish a form with no questions. Add at least one field first.',
            );
          }

          // Derive the next version from what actually exists, not from a
          // possibly-stale currentVersion counter.
          const last = await tx.formVersion.aggregate({
            where: { formId },
            _max: { version: true },
          });
          const nextVersion = (last._max.version ?? 0) + 1;

          const version = await tx.formVersion.create({
            data: {
              formId,
              version: nextVersion,
              pagesJson: pagesJson ?? form.pagesJson ?? [],
              questionsJson: questions,
              logicJson: logicJson ?? form.logicJson ?? [],
              themeJson: themeJson ?? form.themeConfig ?? {},
            },
          });

          await tx.form.update({
            where: { id: formId },
            data: { status: 'PUBLISHED', currentVersion: nextVersion },
          });

          return { version, form };
        },
        { isolationLevel: 'Serializable' },
      );

    let result: { version: any; form: any };
    try {
      result = await runPublish();
    } catch (err: any) {
      if (err?.code === 'P2034' || err?.code === 'P2002') {
        // Write conflict with a concurrent publish — one retry resolves it.
        result = await runPublish();
      } else {
        throw err;
      }
    }

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'form.published',
      resource: 'form',
      resourceId: formId,
      metadata: { formTitle: result.form.title, version: result.version.version },
    });

    await this.invalidatePublicFormCache(result.form.slug);
    await this.invalidateIngestPolicy(formId);

    return result.version;
  }

  /**
   * Drop the cached public payload for a form.
   * Must be called on publish, update, slug change, delete, and restore —
   * otherwise a deleted or edited form stays publicly fillable for up to 5 min.
   */
  private async invalidatePublicFormCache(...slugs: (string | null | undefined)[]) {
    for (const slug of slugs) {
      if (!slug) continue;
      try {
        await this.redis.del(`public_form:${slug}`);
      } catch (e) {
        this.logger.warn(`Failed to invalidate public form cache for slug ${slug}`, e as any);
      }
    }
  }

  /**
   * Drop the cached ingest policy used by the submission hot path.
   * See SubmissionsService.loadIngestPolicy.
   */
  private async invalidateIngestPolicy(formId: string) {
    try {
      await this.redis.del(`ingest_policy:${formId}`);
    } catch (e) {
      this.logger.warn(`Failed to invalidate ingest policy for form ${formId}`, e as any);
    }
  }

  /**
   * Get submissions for a form within an organization (paginated).
   */
  async getSubmissions(
    orgId: string,
    formId: string,
    pagination: Pagination = parsePagination(),
  ) {
    // Verify form belongs to this org and is not deleted
    const form = await this.prisma.reader.form.findFirst({
      where: { id: formId, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
    if (!form) throw new NotFoundException('Form not found');

    const where: Prisma.FormSubmissionWhereInput = { formId, status: { not: 'DELETED' } };

    const [submissions, total] = await Promise.all([
      this.prisma.reader.formSubmission.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        // Matches the @@index([formId, submittedAt DESC]) exactly, so this is
        // an index scan rather than a sort of the whole partition.
        orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
        // The grid projection: answers included, but `userAgent` and
        // `respondentIpHash` are not — those were being returned to every
        // viewer with no consumer for them.
        select: submissionGridSelect,
      }),
      this.prisma.reader.formSubmission.count({ where }),
    ]);

    return paginated('submissions', submissions, pagination, total);
  }

  /**
   * Export submissions in CSV or JSON format.
   */
  async exportSubmissions(orgId: string, formId: string, format: 'csv' | 'json') {
    const form = await this.prisma.reader.form.findFirst({
      where: { id: formId, organizationId: orgId, deletedAt: null },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!form) throw new NotFoundException('Form not found');

    // HARD CAP: this builds the whole export in memory. A form with 500k
    // responses would OOM the pod. Anything above this must go through an async
    // export job that streams a cursor to object storage — see EXPORT_MAX_ROWS.
    const maxRows = parseInt(process.env.EXPORT_MAX_ROWS ?? '50000', 10);
    const total = await this.prisma.reader.formSubmission.count({ where: { formId } });
    if (total > maxRows) {
      throw new BadRequestException(
        `This form has ${total} submissions, which exceeds the ${maxRows}-row synchronous export limit. ` +
          `Use the async export endpoint or narrow the date range.`,
      );
    }

    const submissions = await this.prisma.reader.formSubmission.findMany({
      where: { formId },
      orderBy: { submittedAt: 'desc' },
      take: maxRows,
    });

    if (format === 'json') {
      return submissions;
    }

    // CSV format
    const questions = (form.versions[0]?.questionsJson as any[]) || [];
    // Extract labels or IDs for headers. Prioritize labels if available.
    const questionHeaders = questions.map((q) => q.label || q.id);
    const headers = ['Submission ID', 'Submitted At', 'Status', 'Country', ...questionHeaders];

    const csvRows = [headers.map((h) => csvCell(h)).join(',')];

    for (const sub of submissions) {
      const answers = (sub.answers as Record<string, any>) || {};
      const row = [
        csvCell(sub.id),
        csvCell(sub.submittedAt.toISOString()),
        csvCell(sub.status),
        csvCell(sub.country ?? ''),
        ...questions.map((q) => {
          const val = answers[q.id];
          if (val === undefined || val === null) return '';
          return csvCell(typeof val === 'object' ? JSON.stringify(val) : String(val));
        }),
      ];
      csvRows.push(row.join(','));
    }

    // CRLF is what Excel expects; a bare \n breaks multi-line cells there.
    return csvRows.join('\r\n');
  }

  /**
   * Deep clone an existing form (creates a new DRAFT form with the same schema).
   */
  async cloneForm(orgId: string, formId: string, createdById: string) {
    const original = await this.prisma.reader.form.findFirst({
      where: { id: formId, organizationId: orgId, deletedAt: null },
    });
    if (!original) throw new NotFoundException('Form not found');

    // Enforce quota
    const org = await this.prisma.reader.organization.findUnique({
      where: { id: orgId },
      select: { maxForms: true, _count: { select: { forms: true } } },
    });
    if (org && org._count.forms >= org.maxForms) {
      throw new ForbiddenException('Organization form limit reached. Contact your admin.');
    }

    const cloned = await this.prisma.writer.form.create({
      data: {
        organizationId: orgId,
        createdById,
        slug: nanoid(10),
        title: `${original.title} (Copy)`,
        description: original.description,
        isQuizMode: original.isQuizMode,
        isPasswordProtected: original.isPasswordProtected,
        passwordHash: original.passwordHash,
        requireAuth: original.requireAuth,
        allowMultiple: original.allowMultiple,
        maxSubmissions: original.maxSubmissions,
        expiresAt: original.expiresAt,
        themeConfig: original.themeConfig || {},
        notifyEmails: original.notifyEmails || [],
        pagesJson: original.pagesJson || [],
        questionsJson: original.questionsJson || [],
        logicJson: original.logicJson || [],
        status: 'DRAFT',
      }
    });

    this.audit.log({
      organizationId: orgId,
      userId: createdById,
      action: 'form.cloned',
      resource: 'form',
      resourceId: cloned.id,
      metadata: { originalFormId: formId },
    });

    return cloned;
  }

  /**
   * Get public form by slug — no authentication required.
   * Used by the public respondent form page.
   * Cached heavily since it receives the most traffic.
   */
  async getPublicForm(slug: string) {
    const cacheKey = `public_form:${slug}`;

    // 1. Try to get from cache first (very fast)
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      console.warn('Redis read failed for public form cache:', err);
    }

    // 2. Fallback to DB
    // We check both slug and id to be robust against legacy URLs or frontend passing id
    const form = await this.prisma.reader.form.findFirst({
      where: { 
        OR: [
          { slug },
          { id: slug.length === 36 ? slug : undefined }
        ],
        deletedAt: null 
      },
      include: {
        // Fetch a small window rather than only the newest row so we can select
        // the version the Form actually points at (currentVersion).
        versions: {
          orderBy: { version: 'desc' },
          take: 5,
        },
        organization: {
          select: { id: true, name: true, logoUrl: true, isActive: true },
        },
      },
    });

    if (!form || form.status !== 'PUBLISHED' || form.versions.length === 0) {
      throw new NotFoundException('Form not found or not published');
    }

    // Check if org is active
    if (!form.organization.isActive) {
      throw new ForbiddenException('This form is currently unavailable.');
    }

    if (form.expiresAt && form.expiresAt < new Date()) {
      throw new ForbiddenException('This form has expired');
    }

    // Serve the version the Form actually points at, not simply the newest row.
    // These can differ mid-publish, and the respondent must fill against the
    // same version the submission will later be graded and stored against.
    const activeVersion =
      form.versions.find((v: any) => v.version === form.currentVersion) ?? form.versions[0];

    // Strip everything the respondent must not see: the access password hash,
    // the draft columns (which may contain unpublished questions), and the
    // notification recipient list.
    const {
      passwordHash,
      pagesJson,
      questionsJson,
      logicJson,
      notifyEmails,
      versions,
      ...rest
    } = form as any;

    const publicForm = {
      ...rest,
      // Explicit contract for the client. The runner must echo formVersionId
      // back on submit so the answers bind to the exact structure shown.
      formVersionId: activeVersion.id,
      version: activeVersion.version,
      pages: activeVersion.pagesJson ?? [],
      questions: activeVersion.questionsJson ?? [],
      logic: activeVersion.logicJson ?? [],
      theme: activeVersion.themeJson ?? rest.themeConfig ?? {},
      // Tell the client whether it must collect a password before submitting.
      isPasswordProtected: form.isPasswordProtected,
      requireAuth: form.requireAuth,
    };

    // 3. Store in cache for future requests (expire in 5 minutes)
    try {
      await this.redis.set(cacheKey, JSON.stringify(publicForm), 300);
    } catch (err) {
      this.logger.warn('Redis write failed for public form cache', err as any);
    }

    return publicForm;
  }
  /**
   * Save a partial submission draft.
   */
  async saveDraft(slug: string, data: { fingerprint: string; answers: any; lastFieldId?: string; progress?: number }) {
    if (!data.fingerprint) {
      throw new BadRequestException('Fingerprint is required to save a draft.');
    }
    
    const form = await this.prisma.reader.form.findUnique({
      where: { slug, deletedAt: null },
      select: { id: true, status: true },
    });
    
    if (!form || form.status !== 'PUBLISHED') {
      throw new NotFoundException('Published form not found');
    }

    return this.prisma.writer.formDraft.upsert({
      where: {
        formId_fingerprint: {
          formId: form.id,
          fingerprint: data.fingerprint,
        },
      },
      update: {
        answers: data.answers,
        lastFieldId: data.lastFieldId,
        progress: data.progress || 0,
        updatedAt: new Date(),
      },
      create: {
        formId: form.id,
        fingerprint: data.fingerprint,
        answers: data.answers,
        lastFieldId: data.lastFieldId,
        progress: data.progress || 0,
      },
    });
  }

  /**
   * Remove a saved draft — called after a successful submission so the
   * respondent's progress does not reappear on their next visit.
   */
  async deleteDraft(slug: string, fingerprint: string) {
    if (!fingerprint) return;
    const form = await this.prisma.reader.form.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!form) return;

    await this.prisma.writer.formDraft
      .deleteMany({ where: { formId: form.id, fingerprint } })
      .catch(() => undefined);
  }

  /**
   * Increment a daily view/start counter.
   *
   * Buffered in Redis and flushed by AnalyticsFlushService rather than written
   * per request: at form-view volumes an UPSERT per page load would be the
   * heaviest write in the system, and these counters do not need to be exact
   * in real time.
   */
  async trackEvent(slug: string, event: 'view' | 'start') {
    if (event !== 'view' && event !== 'start') return;

    const form = await this.getPublicFormIdBySlug(slug);
    if (!form) return;

    const day = new Date().toISOString().slice(0, 10);
    try {
      await this.redis.getClient().hincrby(`analytics:pending:${day}`, `${form}:${event}`, 1);
    } catch (e) {
      this.logger.warn('Failed to buffer analytics event', e as any);
    }
  }

  /** Slug -> formId, cached; used by the high-traffic tracking endpoint. */
  private async getPublicFormIdBySlug(slug: string): Promise<string | null> {
    const key = `slug_to_id:${slug}`;
    try {
      const cached = await this.redis.get(key);
      if (cached) return cached;
    } catch {
      /* fall through to DB */
    }

    const form = await this.prisma.reader.form.findUnique({
      where: { slug },
      select: { id: true, status: true, deletedAt: true },
    });
    if (!form || form.deletedAt || form.status !== 'PUBLISHED') return null;

    await this.redis.set(key, form.id, 3600).catch(() => undefined);
    return form.id;
  }

  /**
   * Retrieve a saved draft for a form.
   */
  async getDraft(slug: string, fingerprint: string) {
    if (!fingerprint) {
      throw new BadRequestException('Fingerprint query parameter (fp) is required.');
    }

    const form = await this.prisma.reader.form.findUnique({
      where: { slug, deletedAt: null },
      select: { id: true },
    });
    
    if (!form) {
      throw new NotFoundException('Form not found');
    }

    const draft = await this.prisma.reader.formDraft.findUnique({
      where: {
        formId_fingerprint: {
          formId: form.id,
          fingerprint,
        },
      },
    });

    if (!draft) {
      throw new NotFoundException('No draft found');
    }

    return draft;
  }
}
