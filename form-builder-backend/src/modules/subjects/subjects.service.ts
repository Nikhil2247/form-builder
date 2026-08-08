import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { parsePagination, paginated, type Pagination } from '../../common/pagination/pagination';
import { refKey, type RuleValue, type CompiledPlan } from '../../common/rules';

/**
 * Subjects — the longitudinal record.
 *
 * A subject is created by a REGISTERS form and added to by ATTACHES forms.
 * That is the whole model; there are no programs, enrolments or encounter
 * types (see plan.md §1.1 for why).
 */

export interface IdentityConfig {
  /** Question keys concatenated into Subject.displayName. */
  displayName?: string[];
  /** Question keys promoted onto Subject.attributes for search and prefill. */
  attributes?: string[];
  /** Question key holding a caller-supplied stable id. */
  externalId?: string;
}

@Injectable()
export class SubjectsService {
  private readonly logger = new Logger(SubjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // SUBJECT TYPES
  // ══════════════════════════════════════════════════════════════════════════

  async listSubjectTypes(orgId: string) {
    return this.prisma.reader.subjectType.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { subjects: true, forms: true } },
      },
    });
  }

  async createSubjectType(
    orgId: string,
    dto: { name: string; slug?: string; icon?: string; identityConfig?: IdentityConfig },
    userId?: string,
  ) {
    const slug = normalizeSlug(dto.slug || dto.name);
    if (!slug) throw new BadRequestException('A subject type needs a name.');

    const existing = await this.prisma.reader.subjectType.findUnique({
      where: { organizationId_slug: { organizationId: orgId, slug } },
    });
    if (existing) {
      throw new ConflictException(`A subject type with the id "${slug}" already exists.`);
    }

    const subjectType = await this.prisma.writer.subjectType.create({
      data: {
        organizationId: orgId,
        name: dto.name,
        slug,
        icon: dto.icon ?? null,
        identityConfig: (dto.identityConfig ?? {}) as any,
      },
    });

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'SUBJECT_TYPE_CREATED',
      resource: 'SubjectType',
      resourceId: subjectType.id,
      metadata: { name: subjectType.name },
    });

    return subjectType;
  }

  async updateSubjectType(
    orgId: string,
    subjectTypeId: string,
    dto: {
      name?: string;
      icon?: string;
      identityConfig?: IdentityConfig;
      registrationFormId?: string | null;
    },
    userId?: string,
  ) {
    await this.assertSubjectType(orgId, subjectTypeId);

    // A registration form must belong to this tenant. Without the check an
    // admin could bind another org's form id and leak its structure through
    // the app shell.
    if (dto.registrationFormId) {
      const form = await this.prisma.reader.form.findFirst({
        where: { id: dto.registrationFormId, organizationId: orgId, deletedAt: null },
        select: { id: true },
      });
      if (!form) throw new NotFoundException('Registration form not found.');
    }

    const updated = await this.prisma.writer.subjectType.update({
      where: { id: subjectTypeId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.identityConfig !== undefined && { identityConfig: dto.identityConfig as any }),
        ...(dto.registrationFormId !== undefined && {
          registrationFormId: dto.registrationFormId,
        }),
      },
    });

    // Binding the registration form also marks the form itself, so the builder
    // and the submission worker can both see the relationship without a join.
    if (dto.registrationFormId) {
      await this.prisma.writer.form.update({
        where: { id: dto.registrationFormId },
        data: { subjectTypeId, subjectRole: 'REGISTERS' },
      });
    }

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'SUBJECT_TYPE_UPDATED',
      resource: 'SubjectType',
      resourceId: subjectTypeId,
    });

    return updated;
  }

  async deleteSubjectType(orgId: string, subjectTypeId: string, userId?: string) {
    await this.assertSubjectType(orgId, subjectTypeId);

    const subjectCount = await this.prisma.reader.subject.count({
      where: { subjectTypeId, deletedAt: null },
    });
    if (subjectCount > 0) {
      // Soft-deleting a type whose records still exist would orphan them in the
      // UI while leaving the rows behind. Make the operator deal with the data.
      throw new ConflictException(
        `This subject type still has ${subjectCount} record(s). Delete or migrate them first.`,
      );
    }

    await this.prisma.writer.subjectType.update({
      where: { id: subjectTypeId },
      data: { deletedAt: new Date() },
    });

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'SUBJECT_TYPE_DELETED',
      resource: 'SubjectType',
      resourceId: subjectTypeId,
    });

    return { message: 'Subject type deleted.' };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SUBJECTS
  // ══════════════════════════════════════════════════════════════════════════

  async listSubjects(
    orgId: string,
    query: { subjectTypeId?: string; search?: string },
    pagination: Pagination = parsePagination(),
  ) {
    const where: any = { organizationId: orgId, deletedAt: null };
    if (query.subjectTypeId) where.subjectTypeId = query.subjectTypeId;

    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { displayName: { contains: term, mode: 'insensitive' } },
        { externalId: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.reader.subject.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
        include: { subjectType: { select: { id: true, name: true, slug: true, icon: true } } },
      }),
      this.prisma.reader.subject.count({ where }),
    ]);

    return paginated('subjects', items, pagination, total);
  }

  async getSubject(orgId: string, subjectId: string) {
    const subject = await this.prisma.reader.subject.findFirst({
      where: { id: subjectId, organizationId: orgId, deletedAt: null },
      include: { subjectType: true },
    });
    if (!subject) throw new NotFoundException('Record not found.');
    return subject;
  }

  /**
   * The subject's timeline — every submission attached to it, newest first.
   */
  async getSubjectTimeline(
    orgId: string,
    subjectId: string,
    pagination: Pagination = parsePagination(),
  ) {
    await this.getSubject(orgId, subjectId);

    const where = { subjectId, status: { not: 'DELETED' as const } };

    const [items, total] = await Promise.all([
      this.prisma.reader.formSubmission.findMany({
        where,
        orderBy: { submittedAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
        select: {
          id: true,
          formId: true,
          submittedAt: true,
          answers: true,
          status: true,
          form: { select: { id: true, title: true } },
        },
      }),
      this.prisma.reader.formSubmission.count({ where }),
    ]);

    return paginated('entries', items, pagination, total);
  }

  /**
   * Possible duplicates for a would-be registration.
   *
   * Exact matching only, on external id and display name. Fuzzy/probabilistic
   * matching is deliberately not attempted: it needs thresholds that cannot be
   * tuned before seeing real data, plus merge tooling and a way back from a
   * false merge. An exact-match warning catches the common double-entry case,
   * and the operator decides what to do — we never block or auto-merge.
   */
  async findPossibleDuplicates(
    orgId: string,
    subjectTypeId: string,
    candidate: { displayName?: string; externalId?: string },
  ) {
    const clauses: any[] = [];
    if (candidate.externalId?.trim()) clauses.push({ externalId: candidate.externalId.trim() });
    if (candidate.displayName?.trim()) {
      clauses.push({ displayName: { equals: candidate.displayName.trim(), mode: 'insensitive' } });
    }
    if (clauses.length === 0) return [];

    return this.prisma.reader.subject.findMany({
      where: { organizationId: orgId, subjectTypeId, deletedAt: null, OR: clauses },
      take: 5,
      select: { id: true, displayName: true, externalId: true, createdAt: true, attributes: true },
    });
  }

  async deleteSubject(orgId: string, subjectId: string, userId?: string) {
    await this.getSubject(orgId, subjectId);

    // Soft delete only. The submissions stay — their FK is ON DELETE SET NULL
    // precisely so removing a record never destroys collected responses.
    await this.prisma.writer.subject.update({
      where: { id: subjectId },
      data: { deletedAt: new Date() },
    });

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'SUBJECT_DELETED',
      resource: 'Subject',
      resourceId: subjectId,
    });

    return { message: 'Record deleted.' };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PROMOTION — turning a registration submission into a Subject
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Project the identity fields out of a submission.
   *
   * `identityConfig` names question KEYS while answers are stored by question
   * ID, so the version's questions are needed to translate. Keys are used
   * because a form can be re-published with new question ids for the same
   * logical field, and this config must survive that.
   */
  buildIdentity(
    identityConfig: IdentityConfig,
    questions: any[],
    answers: Record<string, any>,
  ): { displayName: string; attributes: Record<string, any>; externalId: string | null } {
    const idByKey = new Map<string, string>();
    for (const question of questions) {
      if (!question || typeof question.id !== 'string') continue;
      const key = typeof question.key === 'string' && question.key ? question.key : question.id;
      if (!idByKey.has(key)) idByKey.set(key, question.id);
    }

    const valueOf = (key: string): any => {
      const id = idByKey.get(key);
      return id ? answers[id] : undefined;
    };

    const nameParts = (identityConfig.displayName ?? [])
      .map(valueOf)
      .filter((v) => v !== undefined && v !== null && v !== '')
      .map((v) => (Array.isArray(v) ? v.join(' ') : String(v)));

    const attributes: Record<string, any> = {};
    for (const key of identityConfig.attributes ?? []) {
      const value = valueOf(key);
      if (value !== undefined) attributes[key] = value;
    }

    const rawExternal = identityConfig.externalId ? valueOf(identityConfig.externalId) : undefined;

    return {
      // A record with no name is unusable in a search list, so fall back to
      // something stable rather than storing an empty string.
      displayName: nameParts.join(' ').trim().slice(0, 200) || 'Unnamed record',
      attributes,
      externalId:
        rawExternal === undefined || rawExternal === null || rawExternal === ''
          ? null
          : String(rawExternal).slice(0, 100),
    };
  }

  private async assertSubjectType(orgId: string, subjectTypeId: string) {
    const subjectType = await this.prisma.reader.subjectType.findFirst({
      where: { id: subjectTypeId, organizationId: orgId, deletedAt: null },
    });
    if (!subjectType) throw new NotFoundException('Subject type not found.');
    return subjectType;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CROSS-FORM REFERENCE RESOLUTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Resolve a compiled plan's cross-form references into a plain value bag.
 *
 * Called before evaluation so the interpreter stays pure and performs no I/O.
 * The reachable set is fixed at publish time — `plan.references` is the
 * complete list — so a rule cannot widen its own reach at runtime, and we can
 * batch one query per referenced form instead of one per rule.
 *
 * A subject with no prior submission of a referenced form yields `null`, which
 * is a legitimate answer rather than an error.
 */
export async function resolveReferences(
  prisma: PrismaService,
  plan: CompiledPlan,
  subjectId: string | null,
): Promise<Record<string, RuleValue>> {
  const bag: Record<string, RuleValue> = {};
  if (!subjectId || plan.references.length === 0) return bag;

  // Group by (form, when) so several questions read from the same submission
  // cost one query between them.
  const groups = new Map<string, { form: string; when: string; questions: string[] }>();
  for (const ref of plan.references) {
    const groupKey = `${ref.form}::${ref.when}`;
    const group = groups.get(groupKey) ?? { form: ref.form, when: ref.when, questions: [] };
    group.questions.push(ref.question);
    groups.set(groupKey, group);
  }

  await Promise.all(
    [...groups.values()].map(async (group) => {
      const submission = await prisma.reader.formSubmission.findFirst({
        where: {
          subjectId,
          formId: group.form,
          status: { not: 'DELETED' },
          // REGISTRATION means the entry that created the record, which is
          // exactly the one the subject points at.
          ...(group.when === 'REGISTRATION'
            ? { subject: { registrationSubmissionId: { not: null } } }
            : {}),
        },
        orderBy: { submittedAt: group.when === 'FIRST' ? 'asc' : 'desc' },
        select: {
          answers: true,
          formVersion: { select: { questionsJson: true } },
        },
      });

      if (!submission) return;

      const answers = (submission.answers ?? {}) as Record<string, RuleValue>;
      const questions = Array.isArray(submission.formVersion?.questionsJson)
        ? (submission.formVersion.questionsJson as any[])
        : [];

      const idByKey = new Map<string, string>();
      for (const question of questions) {
        if (!question || typeof question.id !== 'string') continue;
        const key = typeof question.key === 'string' && question.key ? question.key : question.id;
        if (!idByKey.has(key)) idByKey.set(key, question.id);
      }

      for (const questionKey of group.questions) {
        const id = idByKey.get(questionKey);
        const value = id ? answers[id] : undefined;
        bag[refKey({ form: group.form, question: questionKey, when: group.when as any })] =
          value === undefined ? null : value;
      }
    }),
  );

  return bag;
}

function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
