import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateFormDto } from './dto/create-form.dto';
import { UpdateFormDto } from './dto/update-form.dto';
import { nanoid } from 'nanoid';
import * as argon2 from 'argon2';

import { RedisService } from '../../common/redis/redis.service';

@Injectable()
export class FormsService {
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
  async getForms(orgId: string, status?: string, page = 1, limit = 20) {
    const where: any = { organizationId: orgId, deletedAt: null };
    if (status) where.status = status;

    const skip = (page - 1) * limit;

    const [forms, total] = await Promise.all([
      this.prisma.reader.form.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        include: {
          createdBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          _count: {
            select: { submissions: true },
          },
        },
      }),
      this.prisma.reader.form.count({ where }),
    ]);

    return {
      forms,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
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

    return this.prisma.writer.form.update({
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
      include: {
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  /**
   * Publish a form — creates an immutable FormVersion snapshot.
   */
  async publishForm(orgId: string, formId: string, pagesJson: any, questionsJson: any, logicJson: any, themeJson: any) {
    const form = await this.prisma.writer.form.findFirst({
      where: { id: formId, organizationId: orgId, deletedAt: null },
    });
    if (!form) throw new NotFoundException('Form not found');

    const nextVersion = form.currentVersion + (form.status === 'DRAFT' ? 0 : 1);

    const version = await this.prisma.writer.formVersion.create({
      data: {
        formId,
        version: nextVersion,
        pagesJson: pagesJson || form.pagesJson || [],
        questionsJson: questionsJson || form.questionsJson || [],
        logicJson: logicJson || form.logicJson || [],
        themeJson: themeJson || form.themeConfig || {},
      },
    });

    await this.prisma.writer.form.update({
      where: { id: formId },
      data: {
        status: 'PUBLISHED',
        currentVersion: nextVersion,
      },
    });

    this.audit.log({
      organizationId: orgId,
      action: 'form.published',
      resource: 'form',
      resourceId: formId,
      metadata: { formTitle: form.title, version: nextVersion },
    });

    try {
      await this.redis.del(`public_form:${form.slug}`);
    } catch (e) {
      console.warn('Failed to clear redis cache for form publish', e);
    }

    return version;
  }

  /**
   * Get submissions for a form within an organization (paginated).
   */
  async getSubmissions(orgId: string, formId: string, page = 1, limit = 50) {
    // Verify form belongs to this org and is not deleted
    const form = await this.prisma.reader.form.findFirst({
      where: { id: formId, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
    if (!form) throw new NotFoundException('Form not found');

    const skip = (page - 1) * limit;
    const [submissions, total] = await Promise.all([
      this.prisma.reader.formSubmission.findMany({
        where: { formId },
        skip,
        take: limit,
        orderBy: { submittedAt: 'desc' },
      }),
      this.prisma.reader.formSubmission.count({ where: { formId } }),
    ]);

    return {
      submissions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
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

    const submissions = await this.prisma.reader.formSubmission.findMany({
      where: { formId },
      orderBy: { submittedAt: 'desc' },
    });

    if (format === 'json') {
      return submissions;
    }

    // CSV format
    const questions = (form.versions[0]?.questionsJson as any[]) || [];
    // Extract labels or IDs for headers. Prioritize labels if available.
    const questionHeaders = questions.map(q => q.label || q.id);
    const headers = ['Submission ID', 'Submitted At', 'IP Address', ...questionHeaders];
    
    const csvRows = [headers.join(',')];

    for (const sub of submissions) {
      const answers = (sub.answers as Record<string, any>) || {};
      const row = [
        sub.id,
        sub.submittedAt.toISOString(),
        sub.ipAddress || '',
        ...questions.map(q => {
          const val = answers[q.id];
          if (val === undefined || val === null) return '';
          const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
          // Escape quotes for CSV
          return `"${str.replace(/"/g, '""')}"`;
        })
      ];
      csvRows.push(row.join(','));
    }

    return csvRows.join('\n');
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
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
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

    // Omit sensitive data like passwordHash
    const { passwordHash, ...publicForm } = form;

    // 3. Store in cache for future requests (expire in 5 minutes)
    try {
      await this.redis.set(cacheKey, JSON.stringify(publicForm), 300);
    } catch (err) {
      console.warn('Redis write failed for public form cache:', err);
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
