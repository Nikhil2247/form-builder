import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
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
      include: { subjectType: true },
    });
    if (!app) throw new NotFoundException('App not found.');

    // Resolve the configured form ids into real forms, scoped to this tenant.
    // Doing it here rather than trusting config means a form deleted after the
    // app was configured simply disappears from the app instead of 404ing when
    // a data-entry user taps it.
    const config = (app.config ?? {}) as FormAppConfig;
    const formIds = Array.isArray(config.formIds) ? config.formIds : [];

    const forms = formIds.length
      ? await this.prisma.reader.form.findMany({
          where: {
            id: { in: formIds },
            organizationId: orgId,
            deletedAt: null,
            status: 'PUBLISHED',
          },
          select: {
            id: true,
            title: true,
            slug: true,
            subjectRole: true,
            subjectTypeId: true,
          },
        })
      : [];

    const byId = new Map(forms.map((form) => [form.id, form]));

    return {
      ...app,
      // Preserve the author's ordering; drop ids that no longer resolve.
      forms: formIds.map((id) => byId.get(id)).filter(Boolean),
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
  private async validateConfig(orgId: string, config: FormAppConfig): Promise<FormAppConfig> {
    const formIds = Array.isArray(config.formIds)
      ? config.formIds.filter((id): id is string => typeof id === 'string').slice(0, 50)
      : [];

    if (formIds.length > 0) {
      const owned = await this.prisma.reader.form.findMany({
        where: { id: { in: formIds }, organizationId: orgId, deletedAt: null },
        select: { id: true },
      });
      const ownedIds = new Set(owned.map((form) => form.id));
      const foreign = formIds.filter((id) => !ownedIds.has(id));
      if (foreign.length > 0) {
        throw new BadRequestException('One or more selected forms do not exist.');
      }
    }

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
      if (typeof card.filter?.formId === 'string' && formIds.includes(card.filter.formId)) {
        filter.formId = card.filter.formId;
      }

      dashboardCards.push({
        title: card.title.slice(0, 120),
        source: card.source,
        ...(Object.keys(filter).length > 0 ? { filter } : {}),
      });
    }

    return { formIds, dashboardCards };
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
