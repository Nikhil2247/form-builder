import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { normalizeTheme } from '../forms/form-structure';
import { AuditService } from '../audit/audit.service';

/**
 * Form Apps — a data-entry surface over one subject type.
 *
 * The app is configuration, not code. `config` holds an ordered list of form
 * ids and a set of dashboard cards, where each card is a DECLARATIVE FILTER.
 * Avni's equivalent is arbitrary JavaScript per card, and their own docs concede
 * the filters are not even auto-applied — every card re-implements them. A
 * filter object covers the real cases and can never become a security or
 * performance incident.
 */

/** Closed set of card sources. Anything else is rejected at save time. */
const CARD_SOURCES = new Set(['subjects', 'submissions']);

/** Ceilings, independent of what an author configures. */
export const APP_LIMITS = {
  MAX_STEPS: 30,
  MAX_PERIODS: 60,
  MAX_ENTRIES_PER_STEP: 100,
} as const;

export interface DashboardCard {
  title: string;
  source: 'subjects' | 'submissions';
  filter?: {
    /** Records created in the last N days. */
    createdWithinDays?: number;
    /** Submissions of one specific form. */
    formId?: string;
  };
}

export interface FormAppConfig {
  /** Forms available in the app, in display order. */
  formIds?: string[];
  dashboardCards?: DashboardCard[];
}

@Injectable()
export class FormAppsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listApps(orgId: string) {
    return this.prisma.reader.formApp.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: {
        subjectType: { select: { id: true, name: true, slug: true, icon: true } },
      },
    });
  }

  async getApp(orgId: string, appId: string) {
    const app = await this.prisma.reader.formApp.findFirst({
      where: { id: appId, organizationId: orgId, deletedAt: null },
      include: {
        subjectType: true,
        periods: { orderBy: { startsAt: 'desc' } },
        steps: {
          orderBy: { order: 'asc' },
          include: {
            form: {
              select: {
                id: true,
                title: true,
                slug: true,
                status: true,
                subjectRole: true,
                subjectTypeId: true,
                deletedAt: true,
                currentVersion: true,
              },
            },
          },
        },
      },
    });
    if (!app) throw new NotFoundException('App not found.');

    return {
      ...app,
      steps: app.steps.map((step) => ({
        ...step,
        // Surfaced rather than hidden: a step whose form was unpublished or
        // deleted still shows in the builder, flagged, because the author needs
        // to see why a step vanished for respondents.
        isUsable: step.form.status === 'PUBLISHED' && !step.form.deletedAt,
      })),
      // Kept for the existing app screen, which lists the forms an app covers.
      forms: app.steps
        .filter((step) => step.form.status === 'PUBLISHED' && !step.form.deletedAt)
        .map((step) => step.form),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEPS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Add a step.
   *
   * Two checks that are not optional. The form must belong to THIS organization
   * — a step is later resolved and served to respondents without re-checking
   * ownership, so an unchecked id here is a cross-tenant leak. And the form must
   * be bound to the app's subject type (or to none), because every entry in a
   * session is attached to the subject the app registers; a form belonging to a
   * different subject type would produce submissions filed against a record
   * they have nothing to do with.
   */
  async createStep(
    orgId: string,
    appId: string,
    dto: {
      formId: string;
      title?: string;
      key?: string;
      description?: string;
      icon?: string;
      mode?: 'SINGLE' | 'REPEATABLE';
      minEntries?: number;
      maxEntries?: number | null;
      isOptional?: boolean;
      uniqueBy?: string[];
      showWhen?: unknown;
    },
    userId?: string,
  ) {
    const app = await this.assertApp(orgId, appId);

    const count = await this.prisma.reader.formAppStep.count({ where: { appId } });
    if (count >= APP_LIMITS.MAX_STEPS) {
      throw new BadRequestException(`An app may have at most ${APP_LIMITS.MAX_STEPS} steps.`);
    }

    const form = await this.prisma.reader.form.findFirst({
      where: { id: dto.formId, organizationId: orgId, deletedAt: null },
      select: { id: true, title: true, subjectTypeId: true, subjectRole: true },
    });
    if (!form) throw new NotFoundException('Form not found.');

    if (form.subjectTypeId && form.subjectTypeId !== app.subjectTypeId) {
      throw new BadRequestException(
        'That form belongs to a different record type, so it cannot be a step of this app.',
      );
    }

    const key = await this.uniqueStepKey(appId, dto.key || dto.title || form.title);
    const shape = this.normalizeStepShape(dto);

    const step = await this.prisma.writer.formAppStep.create({
      data: {
        appId,
        formId: form.id,
        key,
        order: count,
        title: (dto.title || form.title).slice(0, 200),
        description: dto.description?.slice(0, 500) ?? null,
        icon: dto.icon?.slice(0, 16) ?? null,
        ...shape,
      },
    });

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'FORM_APP_STEP_CREATED',
      resource: 'FormAppStep',
      resourceId: step.id,
      metadata: { appId, key, formId: form.id },
    });

    return step;
  }

  async updateStep(
    orgId: string,
    appId: string,
    stepId: string,
    dto: {
      title?: string;
      description?: string | null;
      icon?: string | null;
      mode?: 'SINGLE' | 'REPEATABLE';
      minEntries?: number;
      maxEntries?: number | null;
      isOptional?: boolean;
      uniqueBy?: string[];
      showWhen?: unknown;
    },
    userId?: string,
  ) {
    await this.assertApp(orgId, appId);
    const step = await this.prisma.reader.formAppStep.findFirst({
      where: { id: stepId, appId },
      select: { id: true },
    });
    if (!step) throw new NotFoundException('Step not found.');

    const shape = this.normalizeStepShape(dto);

    const updated = await this.prisma.writer.formAppStep.update({
      where: { id: stepId },
      data: {
        ...(dto.title !== undefined && { title: dto.title.slice(0, 200) }),
        ...(dto.description !== undefined && {
          description: dto.description?.slice(0, 500) ?? null,
        }),
        ...(dto.icon !== undefined && { icon: dto.icon?.slice(0, 16) ?? null }),
        ...shape,
      },
    });

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'FORM_APP_STEP_UPDATED',
      resource: 'FormAppStep',
      resourceId: stepId,
      metadata: { appId },
    });

    return updated;
  }

  async deleteStep(orgId: string, appId: string, stepId: string, userId?: string) {
    await this.assertApp(orgId, appId);

    await this.prisma.writer.$transaction(async (tx) => {
      const step = await tx.formAppStep.findFirst({
        where: { id: stepId, appId },
        select: { id: true, order: true, key: true },
      });
      if (!step) throw new NotFoundException('Step not found.');

      // A step referenced by another step's condition cannot go: the condition
      // would read a field that no longer exists and, failing closed, would
      // hide the dependent step for everyone with nothing to explain why.
      const dependents = await tx.formAppStep.findMany({
        where: { appId, id: { not: stepId }, showWhen: { not: Prisma.DbNull } },
        select: { title: true, showWhen: true },
      });
      const referencedBy = dependents.filter((other) =>
        JSON.stringify(other.showWhen ?? {}).includes(`"${step.key}.`),
      );
      if (referencedBy.length > 0) {
        throw new ConflictException(
          `"${referencedBy[0].title}" only appears based on this step. Change that condition first.`,
        );
      }

      await tx.formAppStep.delete({ where: { id: stepId } });

      // Close the gap so `order` stays dense — a hole would make the next
      // insert collide on @@unique([appId, order]).
      const after = await tx.formAppStep.findMany({
        where: { appId, order: { gt: step.order } },
        orderBy: { order: 'asc' },
        select: { id: true, order: true },
      });
      for (const other of after) {
        await tx.formAppStep.update({ where: { id: other.id }, data: { order: other.order - 1 } });
      }
    });

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'FORM_APP_STEP_DELETED',
      resource: 'FormAppStep',
      resourceId: stepId,
      metadata: { appId },
    });

    return { message: 'Step removed.' };
  }

  /**
   * Reorder in one transaction, via a temporary negative range.
   *
   * `@@unique([appId, order])` means a naive one-by-one rewrite collides the
   * moment two steps momentarily share a position. Parking every row in a
   * range that cannot clash, then writing the final values, avoids needing a
   * deferrable constraint.
   */
  async reorderSteps(orgId: string, appId: string, stepIds: string[], userId?: string) {
    await this.assertApp(orgId, appId);

    const steps = await this.prisma.reader.formAppStep.findMany({
      where: { appId },
      select: { id: true },
    });
    const known = new Set(steps.map((step) => step.id));

    if (stepIds.length !== steps.length || stepIds.some((id) => !known.has(id))) {
      throw new BadRequestException('The new order must list every step of this app exactly once.');
    }
    if (new Set(stepIds).size !== stepIds.length) {
      throw new BadRequestException('The new order lists a step more than once.');
    }

    await this.prisma.writer.$transaction(async (tx) => {
      for (const [index, id] of stepIds.entries()) {
        await tx.formAppStep.update({ where: { id }, data: { order: -(index + 1) } });
      }
      for (const [index, id] of stepIds.entries()) {
        await tx.formAppStep.update({ where: { id }, data: { order: index } });
      }
    });

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'FORM_APP_STEPS_REORDERED',
      resource: 'FormApp',
      resourceId: appId,
    });

    return { message: 'Order saved.' };
  }

  /** Shared shape-normalisation for create and update. */
  private normalizeStepShape(dto: {
    mode?: 'SINGLE' | 'REPEATABLE';
    minEntries?: number;
    maxEntries?: number | null;
    isOptional?: boolean;
    uniqueBy?: string[];
    showWhen?: unknown;
  }) {
    const out: Record<string, any> = {};

    if (dto.mode !== undefined) {
      if (dto.mode !== 'SINGLE' && dto.mode !== 'REPEATABLE') {
        throw new BadRequestException('A step is either filled once or repeatable.');
      }
      out.mode = dto.mode;
      // A step filled once has exactly one entry; carrying a stale maximum from
      // when it was repeatable would reject that entry.
      if (dto.mode === 'SINGLE') {
        out.minEntries = 1;
        out.maxEntries = 1;
      }
    }

    if (out.mode !== 'SINGLE') {
      if (dto.minEntries !== undefined) {
        out.minEntries = Math.min(
          Math.max(Math.trunc(Number(dto.minEntries) || 0), 0),
          APP_LIMITS.MAX_ENTRIES_PER_STEP,
        );
      }
      if (dto.maxEntries !== undefined) {
        out.maxEntries =
          dto.maxEntries === null
            ? null
            : Math.min(
                Math.max(Math.trunc(Number(dto.maxEntries) || 1), 1),
                APP_LIMITS.MAX_ENTRIES_PER_STEP,
              );
      }
    }

    if (
      out.minEntries !== undefined &&
      out.maxEntries !== undefined &&
      out.maxEntries !== null &&
      out.minEntries > out.maxEntries
    ) {
      throw new BadRequestException('A step cannot require more entries than it allows.');
    }

    if (dto.isOptional !== undefined) out.isOptional = !!dto.isOptional;

    if (dto.uniqueBy !== undefined) {
      out.uniqueBy = Array.isArray(dto.uniqueBy)
        ? dto.uniqueBy.filter((key): key is string => typeof key === 'string').slice(0, 10)
        : [];
    }

    if (dto.showWhen !== undefined) {
      out.showWhen =
        dto.showWhen === null || dto.showWhen === undefined ? Prisma.DbNull : (dto.showWhen as any);
    }

    return out;
  }

  private async uniqueStepKey(appId: string, basis: string): Promise<string> {
    const base =
      basis
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 50) || 'step';

    const taken = new Set(
      (
        await this.prisma.reader.formAppStep.findMany({
          where: { appId },
          select: { key: true },
        })
      ).map((step) => step.key),
    );

    if (!taken.has(base)) return base;
    let suffix = 2;
    while (taken.has(`${base}_${suffix}`)) suffix += 1;
    return `${base}_${suffix}`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PERIODS
  // ══════════════════════════════════════════════════════════════════════════

  async createPeriod(
    orgId: string,
    appId: string,
    dto: { label: string; startsAt: string; endsAt: string; isActive?: boolean },
    userId?: string,
  ) {
    await this.assertApp(orgId, appId);

    const count = await this.prisma.reader.formAppPeriod.count({ where: { appId } });
    if (count >= APP_LIMITS.MAX_PERIODS) {
      throw new BadRequestException(`An app may have at most ${APP_LIMITS.MAX_PERIODS} periods.`);
    }

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('A period needs a valid start and end date.');
    }
    if (endsAt <= startsAt) {
      throw new BadRequestException('A period must end after it starts.');
    }

    const period = await this.prisma.writer.formAppPeriod.create({
      data: {
        appId,
        label: dto.label.slice(0, 120),
        startsAt,
        endsAt,
        isActive: dto.isActive ?? true,
      },
    });

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'FORM_APP_PERIOD_CREATED',
      resource: 'FormAppPeriod',
      resourceId: period.id,
      metadata: { appId, label: period.label },
    });

    return period;
  }

  async updatePeriod(
    orgId: string,
    appId: string,
    periodId: string,
    dto: { label?: string; startsAt?: string; endsAt?: string; isActive?: boolean },
  ) {
    await this.assertApp(orgId, appId);
    const period = await this.prisma.reader.formAppPeriod.findFirst({
      where: { id: periodId, appId },
      select: { id: true, startsAt: true, endsAt: true },
    });
    if (!period) throw new NotFoundException('Period not found.');

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : period.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : period.endsAt;
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      throw new BadRequestException('A period must end after it starts.');
    }

    return this.prisma.writer.formAppPeriod.update({
      where: { id: periodId },
      data: {
        ...(dto.label !== undefined && { label: dto.label.slice(0, 120) }),
        startsAt,
        endsAt,
        ...(dto.isActive !== undefined && { isActive: !!dto.isActive }),
      },
    });
  }

  async deletePeriod(orgId: string, appId: string, periodId: string) {
    await this.assertApp(orgId, appId);
    // Sessions keep their period via ON DELETE SET NULL rather than blocking
    // the delete — a retired window should not pin an app's configuration
    // forever, and a submitted report's own timestamps still place it.
    await this.prisma.writer.formAppPeriod.deleteMany({ where: { id: periodId, appId } });
    return { message: 'Period removed.' };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SETTINGS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Theme, branding and access — the app equivalent of the form settings panel.
   */
  async updateSettings(
    orgId: string,
    appId: string,
    dto: {
      themeConfig?: unknown;
      branding?: unknown;
      publicSlug?: string | null;
      requireAuth?: boolean;
      allowDrafts?: boolean;
      isPublished?: boolean;
    },
    userId?: string,
  ) {
    await this.assertApp(orgId, appId);

    let publicSlug: string | null | undefined;
    if (dto.publicSlug !== undefined) {
      publicSlug = dto.publicSlug === null ? null : normalizeSlug(dto.publicSlug);
      if (publicSlug === '') publicSlug = null;
    }

    try {
      const updated = await this.prisma.writer.formApp.update({
        where: { id: appId },
        data: {
          ...(dto.themeConfig !== undefined && {
            themeConfig: normalizeTheme(dto.themeConfig) as any,
          }),
          ...(dto.branding !== undefined && { branding: normalizeBranding(dto.branding) as any }),
          ...(publicSlug !== undefined && { publicSlug }),
          ...(dto.requireAuth !== undefined && { requireAuth: !!dto.requireAuth }),
          ...(dto.allowDrafts !== undefined && { allowDrafts: !!dto.allowDrafts }),
          ...(dto.isPublished !== undefined && { isPublished: !!dto.isPublished }),
        },
      });

      this.audit.log({
        organizationId: orgId,
        userId,
        action: 'FORM_APP_SETTINGS_UPDATED',
        resource: 'FormApp',
        resourceId: appId,
      });

      return updated;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException('That public link is already taken. Try a different one.');
      }
      throw err;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * The app as a respondent sees it.
   *
   * Addressed by `publicSlug`, which is null until an author deliberately
   * publishes a link — an app is not reachable from the internet by default,
   * and retiring a link is setting this back to null rather than deleting
   * anything.
   */
  async getPublicApp(publicSlug: string) {
    const app = await this.prisma.reader.formApp.findFirst({
      where: { publicSlug, deletedAt: null, isPublished: true },
      include: {
        organization: { select: { id: true, name: true, logoUrl: true, isActive: true } },
        subjectType: { select: { id: true, name: true, slug: true } },
        periods: { where: { isActive: true }, orderBy: { startsAt: 'desc' } },
      },
    });
    if (!app) throw new NotFoundException('App not found.');
    if (!app.organization.isActive) {
      throw new ForbiddenException('This app is currently unavailable.');
    }

    const now = Date.now();
    const activePeriod =
      app.periods.find((p) => p.startsAt.getTime() <= now && p.endsAt.getTime() >= now) ?? null;

    return {
      id: app.id,
      publicSlug: app.publicSlug,
      name: app.name,
      description: app.description,
      icon: app.icon,
      theme: app.themeConfig ?? {},
      branding: app.branding ?? {},
      requireAuth: app.requireAuth,
      allowDrafts: app.allowDrafts,
      subjectType: app.subjectType,
      organization: { name: app.organization.name, logoUrl: app.organization.logoUrl },
      period: activePeriod,
      /** Configured windows exist but none is open — the app is between cycles. */
      isOutsidePeriod: app.periods.length > 0 && !activePeriod,
    };
  }

  async createApp(
    orgId: string,
    dto: {
      name: string;
      slug?: string;
      subjectTypeId: string;
      description?: string;
      icon?: string;
      config?: FormAppConfig;
    },
    userId?: string,
  ) {
    const slug = normalizeSlug(dto.slug || dto.name);
    if (!slug) throw new BadRequestException('An app needs a name.');

    const subjectType = await this.prisma.reader.subjectType.findFirst({
      where: { id: dto.subjectTypeId, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
    if (!subjectType) throw new NotFoundException('Subject type not found.');

    const existing = await this.prisma.reader.formApp.findUnique({
      where: { organizationId_slug: { organizationId: orgId, slug } },
    });
    if (existing) throw new ConflictException(`An app with the id "${slug}" already exists.`);

    const app = await this.prisma.writer.formApp.create({
      data: {
        organizationId: orgId,
        subjectTypeId: dto.subjectTypeId,
        name: dto.name,
        slug,
        description: dto.description ?? null,
        icon: dto.icon ?? null,
        config: (await this.validateConfig(orgId, dto.config ?? {})) as any,
      },
    });

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'FORM_APP_CREATED',
      resource: 'FormApp',
      resourceId: app.id,
      metadata: { name: app.name },
    });

    return app;
  }

  async updateApp(
    orgId: string,
    appId: string,
    dto: {
      name?: string;
      description?: string;
      icon?: string;
      config?: FormAppConfig;
      isPublished?: boolean;
    },
    userId?: string,
  ) {
    await this.assertApp(orgId, appId);

    const app = await this.prisma.writer.formApp.update({
      where: { id: appId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.isPublished !== undefined && { isPublished: dto.isPublished }),
        ...(dto.config !== undefined && {
          config: (await this.validateConfig(orgId, dto.config)) as any,
        }),
      },
    });

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'FORM_APP_UPDATED',
      resource: 'FormApp',
      resourceId: appId,
    });

    return app;
  }

  async deleteApp(orgId: string, appId: string, userId?: string) {
    await this.assertApp(orgId, appId);

    await this.prisma.writer.formApp.update({
      where: { id: appId },
      data: { deletedAt: new Date() },
    });

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'FORM_APP_DELETED',
      resource: 'FormApp',
      resourceId: appId,
    });

    return { message: 'App deleted.' };
  }

  /**
   * Dashboard cards.
   *
   * Each card is a bounded, indexed count. There is no user-supplied SQL and no
   * user-supplied code — the filter shape is closed, so the worst a
   * misconfigured card can do is count zero rows.
   */
  async getDashboard(orgId: string, appId: string) {
    const app = await this.assertApp(orgId, appId);
    const config = (app.config ?? {}) as FormAppConfig;
    const cards = Array.isArray(config.dashboardCards) ? config.dashboardCards : [];

    const results = await Promise.all(
      cards.slice(0, 12).map(async (card) => {
        const since =
          typeof card.filter?.createdWithinDays === 'number'
            ? new Date(Date.now() - card.filter.createdWithinDays * 86_400_000)
            : undefined;

        if (card.source === 'submissions') {
          const count = await this.prisma.reader.formSubmission.count({
            where: {
              organizationId: orgId,
              status: { not: 'DELETED' },
              ...(card.filter?.formId ? { formId: card.filter.formId } : {}),
              ...(since ? { submittedAt: { gte: since } } : {}),
            },
          });
          return { title: card.title, value: count };
        }

        const count = await this.prisma.reader.subject.count({
          where: {
            organizationId: orgId,
            subjectTypeId: app.subjectTypeId,
            deletedAt: null,
            ...(since ? { createdAt: { gte: since } } : {}),
          },
        });
        return { title: card.title, value: count };
      }),
    );

    return { cards: results };
  }

  /**
   * Validate app config before storing it.
   *
   * Form ids are checked against this tenant so a config can never reference
   * another organization's form — the app shell later reads these ids to decide
   * what to open, and an unchecked id there would be a cross-tenant leak.
   */
  /**
   * Validate app config before storing it.
   *
   * Only dashboard cards live here now —  moved to FormAppStep, which
   * can express order, cardinality and conditions that a bare list could not.
   */
  private async validateConfig(_orgId: string, config: FormAppConfig): Promise<FormAppConfig> {
    const rawCards = Array.isArray(config.dashboardCards) ? config.dashboardCards : [];
    const dashboardCards: DashboardCard[] = [];

    for (const card of rawCards.slice(0, 12)) {
      if (!card || typeof card.title !== 'string' || !CARD_SOURCES.has(card.source)) continue;

      const filter: DashboardCard['filter'] = {};
      const days = card.filter?.createdWithinDays;
      // Clamped rather than rejected: an absurd window is a UI slip, and a
      // silently sane value is friendlier than an error on save.
      if (typeof days === 'number' && Number.isFinite(days)) {
        filter.createdWithinDays = Math.min(Math.max(Math.trunc(days), 1), 3650);
      }
      if (typeof card.filter?.formId === 'string') {
        filter.formId = card.filter.formId;
      }

      dashboardCards.push({
        title: card.title.slice(0, 120),
        source: card.source,
        ...(Object.keys(filter).length > 0 ? { filter } : {}),
      });
    }

    return { dashboardCards };
  }

  private async assertApp(orgId: string, appId: string) {
    const app = await this.prisma.reader.formApp.findFirst({
      where: { id: appId, organizationId: orgId, deletedAt: null },
    });
    if (!app) throw new NotFoundException('App not found.');
    return app;
  }
}

function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Keys an author may set on `FormApp.branding`. */
const BRANDING_TEXT_KEYS = new Set(['headerTitle', 'footerText']);
const BRANDING_URL_KEYS = new Set(['logoUrl', 'coverImageUrl']);

/**
 * Branding, sanitised.
 *
 * The URL keys are interpolated straight into `src` on a public page, so
 * anything but http(s) is dropped — `javascript:` and `data:text/html` there
 * are stored XSS against every respondent. Same rule `normalizeTheme` applies
 * to a form's cover image, for the same reason.
 */
function normalizeBranding(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>).slice(0, 20)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;

    if (BRANDING_URL_KEYS.has(key)) {
      if (!/^https?:\/\//i.test(trimmed)) continue;
      out[key] = trimmed.slice(0, 2000);
      continue;
    }
    if (BRANDING_TEXT_KEYS.has(key)) {
      out[key] = trimmed.slice(0, 500);
    }
  }
  return out;
}
