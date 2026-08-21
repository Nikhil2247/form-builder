import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateFormDto } from './dto/create-form.dto';
import { UpdateFormDto } from './dto/update-form.dto';
import { customAlphabet } from 'nanoid';
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
import { compileRules, type FormRule } from '../../common/rules';
import { ChoiceListsService } from '../choice-lists/choice-lists.service';
import {
  normalizeFormStructure,
  normalizeNotifyEmails,
  normalizeTheme,
} from './form-structure';

/**
 * Generate a public form slug.
 *
 * NOT plain `nanoid()`. Its default alphabet is `A-Za-z0-9_-`, which produces
 * slugs like `V1StGXR8_Z`, and `CreateFormDto.slug` only accepts lowercase
 * letters, digits and hyphens. The builder loads a form, holds the server's
 * slug in `settings`, and echoes it back on every autosave — so a form created
 * with a default-alphabet slug 400'd on the *next save after creation* and kept
 * doing so forever, showing the author "slug must be lowercase..." against a
 * slug they never typed.
 *
 * 36^10 ≈ 3.6e15 keeps collision probability negligible, and P2002 on the
 * unique index is handled at the call sites that can hit it.
 */
export const publicSlug = customAlphabet(
  '0123456789abcdefghijklmnopqrstuvwxyz',
  10,
);

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

/**
 * The set of submissions an export is allowed to emit.
 *
 * A named predicate rather than an inline object because it is used in two
 * places — the row-count pre-flight that decides whether the export is even
 * permitted, and the keyset cursor that streams the rows — and those two must
 * agree exactly. Nothing here is org-scoped: `exportSubmissions` has already
 * proved the form belongs to the caller's organization before this is reached,
 * and a submission cannot belong to a different org than its form.
 */
/**
 * Row-level filters an export may narrow itself with.
 *
 * Structurally identical to `FrozenExportFilters` in
 * `modules/exports/export-filters.ts`, and declared here rather than imported
 * to keep the dependency pointing one way: ExportsModule already imports
 * FormsModule, and importing back would close the cycle. The shape is small,
 * stable, and covered by tests on both sides.
 */
export interface ExportRowFilters {
  /** Inclusive lower bound on `submittedAt`, ISO-8601 UTC. */
  from?: string;
  /** Exclusive upper bound on `submittedAt`, ISO-8601 UTC. */
  to?: string;
  /** Statuses to include. Absent means every non-deleted status. */
  statuses?: string[];
  /** Free-text match over the answer payload. */
  search?: string;
}

export function exportableSubmissions(
  formId: string,
  filters?: ExportRowFilters,
): Prisma.FormSubmissionWhereInput {
  const where: Prisma.FormSubmissionWhereInput = {
    formId,
    deletedAt: null,
    status: { not: 'DELETED' },
  };

  // A caller-supplied status list must never widen the predicate back out to
  // include DELETED — the soft-delete exclusion above is not negotiable, and an
  // export is the worst possible place to lose it. Intersect rather than
  // replace: `in` the requested statuses, and still `not` DELETED.
  if (filters?.statuses?.length) {
    const requested = filters.statuses.filter((s) => s !== 'DELETED');
    // Every requested status was DELETED, so the caller asked for exactly the
    // rows that may not be exported. An impossible predicate is the honest
    // answer — an empty file, not a full one.
    where.status = requested.length
      ? { in: requested as Prisma.EnumSubmissionStatusFilter['in'] }
      : { in: [] };
  }

  if (filters?.from || filters?.to) {
    where.submittedAt = {
      ...(filters.from ? { gte: new Date(filters.from) } : {}),
      // Exclusive upper bound, matching the doc comment on the filter shape.
      ...(filters.to ? { lt: new Date(filters.to) } : {}),
    };
  }

  if (filters?.search) {
    // The answers column is JSONB and the searchable text is user-defined per
    // form, so there is no column to match on. `string_contains` on the whole
    // document is the only predicate that works across arbitrary schemas.
    //
    // It cannot use the GIN index (that one is jsonb_path_ops, for containment,
    // not substring), so this is a scan. Acceptable precisely because it runs in
    // a background export job rather than on a request — which is the reason
    // filtered exports are async-only.
    where.answers = { string_contains: filters.search };
  }

  return where;
}

@Injectable()
export class FormsService {
  private readonly logger = new Logger(FormsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly choiceLists: ChoiceListsService,
  ) {}

  /**
   * Every `optionsSource` on the form must name a list this org can actually
   * see.
   *
   * `normalizeFormStructure` checks the SHAPE of the binding and the ordering
   * of the cascade, both of which are pure. Whether the slug resolves is a
   * database question, so it lives here — the same split as `compileRules`.
   *
   * Enforced on SAVE, not only on publish: a dropdown bound to a list that does
   * not exist renders permanently empty, and finding that out at publish time
   * means the author has already built the rest of the form around it.
   */
  private async assertOptionsSourcesResolve(
    orgId: string,
    questions: any[],
  ): Promise<void> {
    const slugs = new Set<string>();
    for (const question of questions) {
      const source = question?.optionsSource;
      if (
        source?.kind === 'CHOICE_LIST' &&
        typeof source.listSlug === 'string'
      ) {
        slugs.add(source.listSlug);
      }
    }
    if (slugs.size === 0) return;

    const available = new Set(await this.choiceLists.listSlugsFor(orgId));
    const missing = [...slugs].filter((slug) => !available.has(slug));
    if (missing.length > 0) {
      throw new BadRequestException(
        missing.length === 1
          ? `The list "${missing[0]}" does not exist, so a question cannot take its options from it.`
          : `These lists do not exist: ${missing.join(', ')}.`,
      );
    }
  }

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
      throw new ForbiddenException(
        'Organization form limit reached. Contact your admin.',
      );
    }

    const slug = dto.slug || publicSlug();

    let passwordHash = null;
    if (dto.isPasswordProtected && dto.password) {
      passwordHash = await argon2.hash(dto.password, {
        type: argon2.argon2id,
        timeCost: 3,
        memoryCost: 65536,
        parallelism: 4,
      });
    }

    // Repaired and bounded before it ever reaches JSONB. See form-structure.ts
    // for why this is not a nested DTO.
    const structure = normalizeFormStructure({
      pages: dto.pages,
      questions: dto.questions,
      logic: dto.logic,
    });

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
        maxSubmissions: dto.maxSubmissions ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        themeConfig: normalizeTheme(dto.themeConfig),
        notifyEmails: normalizeNotifyEmails(dto.notifyEmails),
        pagesJson: structure.pages,
        questionsJson: structure.questions,
        logicJson: structure.logic,
        rulesJson: structure.rules,
        layoutMode: dto.layoutMode || 'DOCUMENT',
        status: 'DRAFT',
      },
      select: formDetailSelect,
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
  async createFromTemplate(
    orgId: string,
    createdById: string,
    templateId: string,
  ) {
    // `isPublic` must be part of the lookup, not an afterthought: templates are
    // global rows with no organizationId, so a bare findUnique let any editor
    // clone a private template's full formData — and bump its usageCount — by
    // guessing an id. Mirrors the same filter in TemplatesService.getTemplateById.
    const template = await this.prisma.reader.formTemplate.findFirst({
      where: { id: templateId, isPublic: true },
    });
    if (!template) throw new NotFoundException('Template not found');

    const org = await this.prisma.reader.organization.findUnique({
      where: { id: orgId },
      select: { maxForms: true, _count: { select: { forms: true } } },
    });
    if (org && org._count.forms >= org.maxForms) {
      throw new ForbiddenException(
        'Organization form limit reached. Contact your admin.',
      );
    }

    const formData = (template.formData as any) || {};

    const form = await this.prisma.writer.form.create({
      data: {
        organizationId: orgId,
        createdById,
        slug: publicSlug(),
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
    const where: Prisma.FormWhereInput = {
      organizationId: orgId,
      deletedAt: null,
    };

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
    const sortBy = SORTABLE.has(options.sortBy ?? '')
      ? options.sortBy!
      : 'updatedAt';
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
      // An explicit select, not `include`. `include` returns every scalar on
      // the model — which on Form means `passwordHash`, the argon2 hash of the
      // form's access password, handed to anyone with VIEWER on the org and to
      // anything that could read the response. `formDetailSelect` is the
      // reviewed field list; the version stub is added for the builder, which
      // needs the last publish timestamp to tell whether the live form is
      // behind the draft.
      select: {
        ...formDetailSelect,
        versions: {
          orderBy: { version: 'desc' as const },
          take: 1,
          select: { id: true, version: true, publishedAt: true },
        },
      },
    });

    if (!form) throw new NotFoundException('Form not found');
    return form;
  }

  /**
   * Update form fields within an organization.
   *
   * This is the builder's autosave endpoint: it runs every couple of seconds
   * while someone is editing, with the entire form definition in the body.
   * Three things follow from that, and all three were previously wrong.
   *
   * 1. `undefined` and `null` are different instructions. A key the client did
   *    not send means "leave this alone"; a key sent as `null` means "clear
   *    it". The old implementation assigned `expiresAt: dto.expiresAt ? new
   *    Date(...) : null` unconditionally, so every single autosave from the
   *    builder — which never sent `expiresAt` — wiped the form's closing date.
   *    Setting a form to close on Friday and then editing a question label
   *    quietly reopened it forever.
   *
   * 2. Concurrent editors must not silently overwrite each other. See
   *    `expectedUpdatedAt` on UpdateFormDto.
   *
   * 3. Whatever lands in the JSON columns becomes the schema that grades and
   *    stores every future response, so it is normalised first rather than
   *    written through verbatim.
   */
  async updateForm(
    orgId: string,
    formId: string,
    dto: UpdateFormDto,
    userId?: string,
  ) {
    const form = await this.prisma.reader.form.findFirst({
      where: { id: formId, organizationId: orgId, deletedAt: null },
    });
    if (!form) throw new NotFoundException('Form not found');

    // ── Optimistic concurrency ───────────────────────────────────────────────
    // Second-resolution comparison: `updatedAt` round-trips through JSON as an
    // ISO string, and Postgres timestamps carry microseconds that do not
    // survive it. Comparing exact epoch milliseconds would 409 on every save.
    if (dto.expectedUpdatedAt) {
      const expected = new Date(dto.expectedUpdatedAt).getTime();
      const actual = form.updatedAt.getTime();
      if (Number.isFinite(expected) && Math.abs(actual - expected) > 1_000) {
        throw new ConflictException(
          'This form was changed somewhere else after you opened it. ' +
            'Reload to get the latest version — saving now would overwrite those changes.',
        );
      }
    }

    // ── Password ─────────────────────────────────────────────────────────────
    // Turning protection off must actually drop the hash. Leaving it behind
    // meant re-enabling the toggle silently restored a password nobody
    // remembered setting, and the form became unopenable.
    let passwordHash = form.passwordHash;
    if (dto.password) {
      passwordHash = await argon2.hash(dto.password, {
        type: argon2.argon2id,
        timeCost: 3,
        memoryCost: 65536,
        parallelism: 4,
      });
    }
    if (dto.isPasswordProtected === false) {
      passwordHash = null;
    }

    // Protection cannot be on without a password to check — the public form
    // would demand one that nothing could ever satisfy. Rather than reject the
    // save (this arrives from autosave the instant the toggle is flipped, well
    // before the author has typed anything) the flag is simply held back until
    // a password exists. The settings panel says as much next to the field.
    const isPasswordProtected =
      dto.isPasswordProtected === undefined
        ? undefined
        : dto.isPasswordProtected && !!passwordHash;

    // ── Structure ────────────────────────────────────────────────────────────
    // Cross-part checks run against the definition that will exist *after* this
    // write, so the currently persisted parts are supplied for anything the
    // client left out.
    const touchesStructure =
      dto.pages !== undefined ||
      dto.questions !== undefined ||
      dto.logic !== undefined ||
      dto.rules !== undefined;

    const structure = touchesStructure
      ? normalizeFormStructure(
          {
            pages: dto.pages,
            questions: dto.questions,
            logic: dto.logic,
            rules: dto.rules,
          },
          {
            pages: form.pagesJson,
            questions: form.questionsJson,
            logic: form.logicJson,
            rules: form.rulesJson,
          },
        )
      : null;

    // A binding to a list this org cannot see would render an empty dropdown
    // with nothing to explain it. Caught at save, while the author is looking
    // at the question they just configured.
    if (structure) {
      await this.assertOptionsSourcesResolve(orgId, structure.questions);
    }

    const data: Prisma.FormUpdateInput = {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.slug !== undefined && { slug: dto.slug }),
      ...(dto.isQuizMode !== undefined && { isQuizMode: dto.isQuizMode }),
      ...(isPasswordProtected !== undefined && { isPasswordProtected }),
      ...(passwordHash !== form.passwordHash && { passwordHash }),
      ...(dto.requireAuth !== undefined && { requireAuth: dto.requireAuth }),
      ...(dto.allowMultiple !== undefined && {
        allowMultiple: dto.allowMultiple,
      }),
      ...(dto.maxSubmissions !== undefined && {
        maxSubmissions: dto.maxSubmissions ?? null,
      }),
      ...(dto.expiresAt !== undefined && {
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      }),
      ...(dto.themeConfig !== undefined && {
        themeConfig: normalizeTheme(dto.themeConfig),
      }),
      ...(dto.notifyEmails !== undefined && {
        notifyEmails: normalizeNotifyEmails(dto.notifyEmails),
      }),
      ...(structure && {
        pagesJson: structure.pages,
        questionsJson: structure.questions,
        logicJson: structure.logic,
        rulesJson: structure.rules,
      }),
      ...(dto.layoutMode !== undefined && { layoutMode: dto.layoutMode }),
    };

    let updated;
    try {
      if (dto.expectedUpdatedAt) {
        // The check above compares against a value read a moment ago, which
        // leaves a window for another writer to land in between. Making the
        // write itself conditional on the row still carrying the `updatedAt` we
        // read closes it: whoever gets there second matches zero rows.
        //
        // The condition uses the *server's* Date, not the client's ISO string,
        // so the microsecond truncation that forces the coarse comparison above
        // is not a problem here.
        const { count } = await this.prisma.writer.form.updateMany({
          where: { id: formId, updatedAt: form.updatedAt },
          data,
        });

        if (count === 0) {
          throw new ConflictException(
            'This form was changed somewhere else while you were saving. ' +
              'Reload to get the latest version.',
          );
        }

        updated = await this.prisma.writer.form.findUniqueOrThrow({
          where: { id: formId },
          select: formDetailSelect,
        });
      } else {
        // Selected, not returned wholesale — the default payload carries
        // `passwordHash`, and this response goes back to the browser on every
        // autosave. See getFormById.
        updated = await this.prisma.writer.form.update({
          where: { id: formId },
          data,
          select: formDetailSelect,
        });
      }
    } catch (err: any) {
      // The slug is unique across the whole platform, so a clash here is a
      // user-correctable input error, not a server fault.
      if (err?.code === 'P2002') {
        throw new ConflictException(
          'That public link is already taken. Try a different one.',
        );
      }
      throw err;
    }

    // Invalidate under BOTH the old and new slug — a slug change would
    // otherwise leave the form reachable at its previous public URL.
    await this.invalidatePublicFormCache(form.slug, updated.slug);
    await this.invalidateIngestPolicy(formId);

    // Autosave fires every couple of seconds, so this logs on *changed values*,
    // not on the presence of a key — the builder sends every settings field on
    // every write, and keying off presence would bury the audit trail under a
    // record per keystroke. Only access and availability are tracked; those are
    // the ones anyone ever needs to reconstruct after the fact.
    const changedSettings = (
      [
        ['slug', form.slug, updated.slug],
        [
          'isPasswordProtected',
          form.isPasswordProtected,
          updated.isPasswordProtected,
        ],
        ['requireAuth', form.requireAuth, updated.requireAuth],
        ['allowMultiple', form.allowMultiple, updated.allowMultiple],
        ['maxSubmissions', form.maxSubmissions, updated.maxSubmissions],
        [
          'expiresAt',
          form.expiresAt?.getTime() ?? null,
          updated.expiresAt?.getTime() ?? null,
        ],
      ] as const
    )
      .filter(([, before, after]) => before !== after)
      .map(([key]) => key);

    if (changedSettings.length > 0) {
      this.audit.log({
        organizationId: orgId,
        userId,
        action: 'form.settings_updated',
        resource: 'form',
        resourceId: formId,
        metadata: { formTitle: updated.title, changed: changedSettings },
      });
    }

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
    rulesJson?: any,
  ) {
    // Fetched OUTSIDE the transaction, and deliberately so: it is a read of
    // slowly-changing catalogue data, and holding a Serializable transaction
    // open across it would widen the conflict window on every publish for no
    // benefit. A list created in the moments after this read simply cannot be
    // referenced until the next publish.
    const knownChoiceLists = await this.choiceLists.listSlugsFor(orgId);
    const knownChoiceListSet = new Set(knownChoiceLists);

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

          // A FormVersion is immutable and is the schema every response is
          // graded against forever, so it gets the same normalisation the draft
          // does — a snapshot is the worst possible place to discover a
          // duplicate question id or a dangling logic rule.
          const structure = normalizeFormStructure(
            {
              pages: pagesJson,
              questions: questionsJson,
              logic: logicJson,
              rules: rulesJson,
            },
            {
              pages: form.pagesJson,
              questions: form.questionsJson,
              logic: form.logicJson,
              rules: form.rulesJson,
            },
          );

          if (structure.questions.length === 0) {
            throw new BadRequestException(
              'Cannot publish a form with no questions. Add at least one field first.',
            );
          }

          // Re-checked here, not just on save: the version about to be frozen
          // is what every future respondent is served, and a list may have been
          // deleted since the draft was last written.
          const unresolved = structure.questions
            .map((q: any) => q?.optionsSource?.listSlug)
            .filter(
              (slug: unknown): slug is string =>
                typeof slug === 'string' && !knownChoiceListSet.has(slug),
            );
          if (unresolved.length > 0) {
            throw new BadRequestException(
              `Cannot publish: these option lists no longer exist — ${[...new Set(unresolved)].join(', ')}.`,
            );
          }

          // Publish is the last point at which a broken rule set can be stopped
          // cheaply. After this the version is immutable and every respondent
          // is evaluated against it, so unknown operators, dangling field
          // references and dependency cycles all fail here rather than becoming
          // a runtime surprise on the submit path.
          const compiled = compileRules(structure.rules as FormRule[], {
            knownKeys: structure.questions.map((q: any) => q.key),
            // Cross-form references need a subject to hang off. Until a form is
            // bound to a subject type they are rejected rather than silently
            // resolving to null.
            allowReferences: Boolean(form.subjectTypeId),
            // A lookup() naming a list this org cannot see would return null
            // for every respondent, forever, with nothing to indicate why.
            knownChoiceLists,
          });

          if (!compiled.ok) {
            throw new BadRequestException({
              message: 'This form has rule errors and cannot be published.',
              issues: compiled.errors.map((e) => ({
                ruleId: e.ruleId,
                message: e.message,
              })),
            });
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
              pagesJson: structure.pages,
              questionsJson: structure.questions,
              logicJson: structure.logic,
              themeJson: themeJson
                ? normalizeTheme(themeJson)
                : (form.themeConfig ?? {}),
              rulesJson: structure.rules,
              compiledRules: compiled.plan as any,
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
      metadata: {
        formTitle: result.form.title,
        version: result.version.version,
      },
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
  private async invalidatePublicFormCache(
    ...slugs: (string | null | undefined)[]
  ) {
    for (const slug of slugs) {
      if (!slug) continue;
      try {
        await this.redis.del(`public_form:${slug}`);
      } catch (e) {
        this.logger.warn(
          `Failed to invalidate public form cache for slug ${slug}`,
          e,
        );
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
      this.logger.warn(
        `Failed to invalidate ingest policy for form ${formId}`,
        e,
      );
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

    // `deletedAt: null` as well as the status filter — see the note on the same
    // pairing in SubmissionsService.listSubmissions for why both are kept.
    const where: Prisma.FormSubmissionWhereInput = {
      formId,
      deletedAt: null,
      status: { not: 'DELETED' },
    };

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
   * ═════════════════════════════════════════════════════════════════════════
   *
   * Returns an async generator of body chunks rather than one finished string.
   * The previous version loaded every matching row into an array and then built
   * a second array of formatted lines beside it, so peak memory was roughly
   * twice the export — and the whole thing was held until the last row was
   * formatted, which is also why the client saw nothing until then.
   *
   * Rows are now walked in batches with a keyset cursor and written out as they
   * arrive, so memory is bounded by BATCH_SIZE regardless of form size and the
   * download starts immediately.
   *
   * Validation happens eagerly, *before* the generator is returned: generators
   * are lazy, and a NotFoundException raised after the controller had already
   * written a 200 and a Content-Disposition would arrive as a corrupt file
   * rather than an error.
   */
  async exportSubmissions(
    orgId: string,
    formId: string,
    format: 'csv' | 'json',
    // ── Declared `filters?:` and NOT `filters = {}` — this matters ────────────
    // `rowSourceSupportsFilters()` in modules/exports/export-filters.ts probes
    // this function's arity to decide whether a filtered export can be honoured,
    // and fails closed when it cannot. A default value would drop
    // `Function.length` from 4 to 3, silently turning every filtered export
    // request back into a 400 while the code here looked perfectly capable of
    // serving it. An optional parameter keeps the arity at 4.
    filters?: ExportRowFilters,
  ): Promise<AsyncGenerator<string>> {
    const form = await this.prisma.reader.form.findFirst({
      where: { id: formId, organizationId: orgId, deletedAt: null },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!form) throw new NotFoundException('Form not found');

    /**
     * Still capped, but this is now a *policy* limit rather than a memory one:
     * streaming means a huge export no longer risks the pod, it just occupies a
     * request and a reader connection for a long time. Raising EXPORT_MAX_ROWS
     * is safe in a way it was not before.
     */
    const maxRows = parseInt(process.env.EXPORT_MAX_ROWS ?? '50000', 10);
    // The row-count pre-flight and the streaming cursor MUST use the same
    // predicate — `exportableSubmissions(formId)` is that predicate, defined
    // once at the bottom of this file. When they were two literals a deleted
    // response was counted here and then either included or skipped there, and
    // the export is the single worst place for a soft-deleted response to
    // reappear: it leaves the product entirely, into a spreadsheet on somebody's
    // laptop, after a customer was told the record was removed.
    const total = await this.prisma.reader.formSubmission.count({
      where: exportableSubmissions(formId, filters),
    });
    if (total > maxRows) {
      throw new BadRequestException(
        `This form has ${total} submissions, which exceeds the ${maxRows}-row synchronous export limit. ` +
          `Use the async export endpoint or narrow the date range.`,
      );
    }

    const questions = (form.versions[0]?.questionsJson as any[]) || [];
    return format === 'json'
      ? this.streamJsonExport(formId, maxRows, filters)
      : this.streamCsvExport(formId, maxRows, questions, filters);
  }

  /**
   * Walk a form's submissions oldest-cap-first in keyset batches.
   *
   * `submittedAt` alone is not unique — two responses landing in the same
   * millisecond would make an offset scan skip or repeat rows — so `id` is the
   * tiebreaker and the cursor, giving a total order that is stable even while
   * new submissions arrive mid-export.
   */
  private async *submissionBatches(
    formId: string,
    maxRows: number,
    filters?: ExportRowFilters,
  ) {
    const BATCH_SIZE = 1_000;
    let cursor: string | undefined;
    let emitted = 0;

    while (emitted < maxRows) {
      const batch = await this.prisma.reader.formSubmission.findMany({
        where: exportableSubmissions(formId, filters),
        orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
        take: Math.min(BATCH_SIZE, maxRows - emitted),
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (batch.length === 0) return;

      emitted += batch.length;
      cursor = batch[batch.length - 1].id;
      yield batch;
    }
  }

  private async *streamCsvExport(
    formId: string,
    maxRows: number,
    questions: any[],
    filters?: ExportRowFilters,
  ) {
    // Extract labels or IDs for headers. Prioritize labels if available.
    const questionHeaders = questions.map((q) => q.label || q.id);
    const headers = [
      'Submission ID',
      'Submitted At',
      'Status',
      'Country',
      ...questionHeaders,
    ];

    // CRLF is what Excel expects; a bare \n breaks multi-line cells there.
    yield headers.map((h) => csvCell(h)).join(',');

    for await (const batch of this.submissionBatches(
      formId,
      maxRows,
      filters,
    )) {
      const lines: string[] = [];
      for (const sub of batch) {
        const answers = (sub.answers as Record<string, any>) || {};
        lines.push(
          [
            csvCell(sub.id),
            csvCell(sub.submittedAt.toISOString()),
            csvCell(sub.status),
            csvCell(sub.country ?? ''),
            ...questions.map((q) => {
              const val = answers[q.id];
              if (val === undefined || val === null) return '';
              return csvCell(
                typeof val === 'object' ? JSON.stringify(val) : String(val),
              );
            }),
          ].join(','),
        );
      }
      // Leading CRLF terminates the previous chunk's final row, so no trailing
      // blank line is emitted at the end.
      yield `\r\n${lines.join('\r\n')}`;
    }
  }

  /** Same rows the non-streaming version returned, emitted as a JSON array. */
  private async *streamJsonExport(
    formId: string,
    maxRows: number,
    filters?: ExportRowFilters,
  ) {
    yield '[';
    let first = true;
    for await (const batch of this.submissionBatches(
      formId,
      maxRows,
      filters,
    )) {
      for (const sub of batch) {
        yield first ? JSON.stringify(sub) : `,${JSON.stringify(sub)}`;
        first = false;
      }
    }
    yield ']';
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
      throw new ForbiddenException(
        'Organization form limit reached. Contact your admin.',
      );
    }

    const cloned = await this.prisma.writer.form.create({
      data: {
        organizationId: orgId,
        createdById,
        slug: publicSlug(),
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
      },
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
        OR: [{ slug }, { id: slug.length === 36 ? slug : undefined }],
        deletedAt: null,
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

    if (!form || form.versions.length === 0) {
      throw new NotFoundException('Form not found or not published');
    }

    // CLOSED is not "missing". A form reaches it by hitting its own response
    // cap or by the author closing it — both of which mean the link was right
    // and the respondent simply arrived too late. Collapsing it into the 404
    // told them their link was wrong, so they went and asked for it again.
    if (form.status === 'CLOSED') {
      throw new ForbiddenException(
        'This form is no longer accepting responses.',
      );
    }

    if (form.status !== 'PUBLISHED') {
      throw new NotFoundException('Form not found or not published');
    }

    // Check if org is active
    if (!form.organization.isActive) {
      throw new ForbiddenException('This form is currently unavailable.');
    }

    if (form.expiresAt && form.expiresAt < new Date()) {
      throw new ForbiddenException(
        'This form has closed and is no longer accepting responses.',
      );
    }

    // Serve the version the Form actually points at, not simply the newest row.
    // These can differ mid-publish, and the respondent must fill against the
    // same version the submission will later be graded and stored against.
    const activeVersion =
      form.versions.find((v: any) => v.version === form.currentVersion) ??
      form.versions[0];

    // Strip everything the respondent must not see: the access password hash,
    // the draft columns (which may contain unpublished questions), and the
    // notification recipient list.
    const {
      passwordHash,
      pagesJson,
      questionsJson,
      logicJson,
      rulesJson,
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
      // The COMPILED plan, not the authored rules: the runner interprets it to
      // show calculated values live and hide irrelevant questions. Safe to
      // expose — it describes this form's own structure, which the respondent
      // is already looking at, and it is validated data rather than code.
      //
      // Client evaluation is for UX only. The server recomputes every
      // calculated value on submit and ignores whatever the client sent.
      //
      // NAMED `compiledRules`, not `rules`. `FormConfig.rules` is the AUTHORED
      // rule array everywhere else in the codebase — the builder edits one, the
      // publish endpoint accepts one. Serving a CompiledPlan under the same
      // name gave one field two incompatible shapes depending on which endpoint
      // produced it, which is a trap for anything that reads it generically.
      compiledRules: activeVersion.compiledRules ?? {},
      // Tell the client whether it must collect a password before submitting.
      isPasswordProtected: form.isPasswordProtected,
      requireAuth: form.requireAuth,
    };

    // 3. Store in cache for future requests (expire in 5 minutes)
    try {
      await this.redis.set(cacheKey, JSON.stringify(publicForm), 300);
    } catch (err) {
      this.logger.warn('Redis write failed for public form cache', err);
    }

    return publicForm;
  }
  /**
   * Save a partial submission draft.
   */
  async saveDraft(
    slug: string,
    data: {
      fingerprint: string;
      answers: any;
      lastFieldId?: string;
      progress?: number;
    },
  ) {
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
      await this.redis
        .getClient()
        .hincrby(`analytics:pending:${day}`, `${form}:${event}`, 1);
    } catch (e) {
      this.logger.warn('Failed to buffer analytics event', e);
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
      throw new BadRequestException(
        'Fingerprint query parameter (fp) is required.',
      );
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
