import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import {
  lookupKey,
  planLookupRequests,
  resolveLookupBag,
  type CompiledPlan,
  type RuleValue,
} from '../../common/rules';

/**
 * Choice lists — managed option sets, with hierarchy and metadata.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Three things a per-question option array cannot do, and this can:
 *
 *   1. REUSE. One District list referenced by every form, corrected in one
 *      place when a district is renamed.
 *   2. CASCADE. District -> Block -> School, via `parentValue`.
 *   3. AUTO-FILL. Extra columns in `metadata` that a CALCULATE rule reads with
 *      `lookup()`, which is how a UDISE code fills itself from a school.
 *
 * ── Visibility ─────────────────────────────────────────────────────────────
 * A list is visible to an org if it belongs to that org, or if it is global
 * (`organizationId` null). Resolution prefers the org's own, so a tenant can
 * shadow a global list with a corrected copy without anyone else being
 * affected. Every read path in this service goes through `visibilityWhere` or
 * `resolveList` — nothing constructs that predicate by hand, because getting it
 * wrong is a cross-tenant data leak.
 */

/** Ceilings, independent of what a caller asks for. */
export const CHOICE_LIMITS = {
  /** Items accepted in one import call. */
  MAX_IMPORT_ITEMS: 20_000,
  /** Items returned by one query, however large the `limit` parameter is. */
  MAX_PAGE_SIZE: 200,
  DEFAULT_PAGE_SIZE: 50,
  MAX_METADATA_KEYS: 30,
  MAX_METADATA_VALUE_LENGTH: 500,
  MAX_LISTS_PER_ORG: 200,
} as const;

const ITEMS_CACHE_TTL_SECONDS = 3600;

export interface ChoiceItemInput {
  value: string;
  label?: string;
  parentValue?: string | null;
  metadata?: Record<string, unknown>;
  sortOrder?: number;
}

@Injectable()
export class ChoiceListsService {
  private readonly logger = new Logger(ChoiceListsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // VISIBILITY
  // ══════════════════════════════════════════════════════════════════════════

  /** Lists this org may read: its own, plus the platform's. */
  private visibilityWhere(orgId: string) {
    return {
      deletedAt: null,
      OR: [{ organizationId: orgId }, { organizationId: null }],
    };
  }

  /**
   * Resolve a slug for an org, preferring the org's own list over a global one
   * of the same name.
   *
   * The ordering is what makes shadowing work: `orderBy organizationId desc`
   * with NULLS LAST puts the org-owned row first.
   */
  async resolveList(orgId: string, slug: string) {
    const candidates = await this.prisma.reader.choiceList.findMany({
      where: { ...this.visibilityWhere(orgId), slug },
      orderBy: { organizationId: { sort: 'desc', nulls: 'last' } },
      take: 2,
    });
    return candidates[0] ?? null;
  }

  /** Every slug this org may reference. Used by the publish-time rule compiler. */
  async listSlugsFor(orgId: string): Promise<string[]> {
    const rows = await this.prisma.reader.choiceList.findMany({
      where: this.visibilityWhere(orgId),
      select: { slug: true },
    });
    return [...new Set(rows.map((row) => row.slug))];
  }

  private assertEditable(list: { organizationId: string | null }, orgId: string) {
    if (list.organizationId === null) {
      throw new BadRequestException(
        'This list is provided by the platform and cannot be edited. Create your own copy to change it.',
      );
    }
    if (list.organizationId !== orgId) {
      // Should be unreachable — visibilityWhere already excludes other orgs —
      // but an ownership check on the write path is not something to infer.
      throw new NotFoundException('List not found.');
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // READS
  // ══════════════════════════════════════════════════════════════════════════

  async listLists(orgId: string) {
    const lists = await this.prisma.reader.choiceList.findMany({
      where: this.visibilityWhere(orgId),
      orderBy: [{ organizationId: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        organizationId: true,
        parentListId: true,
        metadataSchema: true,
        itemCount: true,
        version: true,
        updatedAt: true,
        parentList: { select: { id: true, slug: true, name: true } },
      },
    });

    return lists.map((list) => ({
      ...list,
      /** The UI shows a badge and hides the edit controls on these. */
      isGlobal: list.organizationId === null,
    }));
  }

  async getList(orgId: string, slug: string) {
    const list = await this.resolveList(orgId, slug);
    if (!list) throw new NotFoundException('List not found.');

    const parentList = list.parentListId
      ? await this.prisma.reader.choiceList.findUnique({
          where: { id: list.parentListId },
          select: { id: true, slug: true, name: true },
        })
      : null;

    return { ...list, parentList, isGlobal: list.organizationId === null };
  }

  /**
   * Items of a list, optionally filtered by parent and searched by label.
   *
   * Cursor-paginated on `(sortOrder, id)` rather than offset: a school registry
   * has hundreds of thousands of rows, and OFFSET 200000 makes Postgres walk
   * every one of them.
   */
  async getItems(
    orgId: string,
    slug: string,
    query: { parent?: string; q?: string; limit?: number; cursor?: string },
  ) {
    const list = await this.resolveList(orgId, slug);
    if (!list) throw new NotFoundException('List not found.');
    return this.queryItems(list, query);
  }

  /** Shared by the authenticated and public paths, which differ only in how they authorise. */
  async queryItems(
    list: { id: string; version: number; parentListId: string | null },
    query: { parent?: string; q?: string; limit?: number; cursor?: string; values?: string[] },
  ) {
    // ── Fetch specific items by value ──────────────────────────────────────
    // Used by the browser to resolve `lookup()` for live auto-fill: it needs
    // the metadata of the ONE item the respondent picked, which may not be on
    // the current page of a large list. Bypasses the parent filter deliberately
    // — the value is already the exact identity of the row, and the cascade
    // consistency of that pairing is checked at submit, not here.
    if (Array.isArray(query.values) && query.values.length > 0) {
      const values = query.values.slice(0, CHOICE_LIMITS.MAX_PAGE_SIZE);
      const items = await this.prisma.reader.choiceItem.findMany({
        where: { listId: list.id, value: { in: values } },
        select: { id: true, value: true, label: true, parentValue: true, metadata: true },
      });
      return { items, nextCursor: null, total: items.length };
    }

    const limit = Math.min(
      Math.max(Number(query.limit) || CHOICE_LIMITS.DEFAULT_PAGE_SIZE, 1),
      CHOICE_LIMITS.MAX_PAGE_SIZE,
    );
    const search = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
    const parent = typeof query.parent === 'string' ? query.parent.trim().slice(0, 120) : '';

    // A child list with no parent selected returns nothing rather than
    // everything. Showing all 784 districts before a state is chosen defeats
    // the point of the cascade and is a large payload for no reason.
    if (list.parentListId && !parent) {
      return { items: [], nextCursor: null, total: 0 };
    }

    const cacheable = !search && !query.cursor;
    const cacheKey = `choice_items:${list.id}:${list.version}:${parent}:${limit}`;

    if (cacheable) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch {
        /* cache is an optimisation; fall through to the database */
      }
    }

    const where = {
      listId: list.id,
      isActive: true,
      ...(list.parentListId ? { parentValue: parent } : {}),
      ...(search ? { label: { contains: search, mode: 'insensitive' as const } } : {}),
    };

    const rows = await this.prisma.reader.choiceItem.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      // One extra row tells us whether another page exists without a COUNT.
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: { id: true, value: true, label: true, parentValue: true, metadata: true },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const result = {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
      total: items.length,
    };

    if (cacheable) {
      this.redis
        .set(cacheKey, JSON.stringify(result), ITEMS_CACHE_TTL_SECONDS)
        .catch(() => undefined);
    }

    return result;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VALIDATION SUPPORT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Check submitted values against the lists they claim to come from.
   *
   * Batched deliberately: a form with five cascading dropdowns must not become
   * five queries per submission. Everything is resolved in one `IN` per list.
   *
   * Returns a map of `listSlug::value` to the item, so the caller can both
   * check membership AND verify cascade consistency — that the block the
   * respondent submitted really does sit under the district they submitted.
   */
  async resolveItemsForValidation(
    orgId: string,
    wanted: ReadonlyArray<{ listSlug: string; value: string }>,
  ): Promise<Map<string, { value: string; parentValue: string | null; metadata: unknown }>> {
    const found = new Map<
      string,
      { value: string; parentValue: string | null; metadata: unknown }
    >();
    if (wanted.length === 0) return found;

    const bySlug = new Map<string, Set<string>>();
    for (const item of wanted) {
      const set = bySlug.get(item.listSlug);
      if (set) set.add(item.value);
      else bySlug.set(item.listSlug, new Set([item.value]));
    }

    const lists = await this.prisma.reader.choiceList.findMany({
      where: { ...this.visibilityWhere(orgId), slug: { in: [...bySlug.keys()] } },
      orderBy: { organizationId: { sort: 'desc', nulls: 'last' } },
      select: { id: true, slug: true, organizationId: true },
    });

    // Shadowing again: keep the first (org-owned) row per slug.
    const listBySlug = new Map<string, string>();
    for (const list of lists) {
      if (!listBySlug.has(list.slug)) listBySlug.set(list.slug, list.id);
    }

    await Promise.all(
      [...bySlug.entries()].map(async ([slug, values]) => {
        const listId = listBySlug.get(slug);
        if (!listId) return;
        const rows = await this.prisma.reader.choiceItem.findMany({
          where: { listId, value: { in: [...values] } },
          select: { value: true, parentValue: true, metadata: true },
        });
        for (const row of rows) {
          found.set(`${slug}::${row.value}`, row);
        }
      }),
    );

    return found;
  }

  /**
   * Fill the rules engine's lookup bag for one submission.
   *
   * Mirrors `resolveReferences`: the plan says which columns it can read, the
   * answers say of which items, and this turns that into a plain map so the
   * interpreter performs no I/O. See LookupSpec in common/rules/ast.ts.
   */
  async resolveLookups(
    orgId: string,
    plan: CompiledPlan,
    answersByKey: Record<string, RuleValue>,
  ): Promise<Record<string, RuleValue>> {
    const requests = planLookupRequests(plan.lookups, answersByKey);
    if (requests.length === 0) return {};

    const resolved = await this.resolveItemsForValidation(
      orgId,
      requests.map((request) => ({ listSlug: request.list, value: request.value })),
    );

    const metadataByKey = new Map<string, Record<string, unknown>>();
    for (const [key, item] of resolved) {
      metadataByKey.set(
        key,
        item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
          ? (item.metadata as Record<string, unknown>)
          : {},
      );
    }

    return resolveLookupBag(requests, metadataByKey);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // WRITES
  // ══════════════════════════════════════════════════════════════════════════

  async createList(
    orgId: string,
    dto: {
      name: string;
      slug?: string;
      description?: string;
      parentListSlug?: string;
      metadataSchema?: unknown;
    },
    userId?: string,
  ) {
    const slug = normalizeSlug(dto.slug || dto.name);
    if (!slug) throw new BadRequestException('A list needs a name.');

    const count = await this.prisma.reader.choiceList.count({
      where: { organizationId: orgId, deletedAt: null },
    });
    if (count >= CHOICE_LIMITS.MAX_LISTS_PER_ORG) {
      throw new BadRequestException(
        `An organization may have at most ${CHOICE_LIMITS.MAX_LISTS_PER_ORG} lists.`,
      );
    }

    const clash = await this.prisma.reader.choiceList.findFirst({
      where: { organizationId: orgId, slug, deletedAt: null },
      select: { id: true },
    });
    if (clash) throw new ConflictException(`A list with the id "${slug}" already exists.`);

    let parentListId: string | null = null;
    if (dto.parentListSlug) {
      const parent = await this.resolveList(orgId, dto.parentListSlug);
      if (!parent) throw new BadRequestException('The parent list does not exist.');
      parentListId = parent.id;
    }

    const list = await this.prisma.writer.choiceList.create({
      data: {
        organizationId: orgId,
        slug,
        name: dto.name.slice(0, 120),
        description: dto.description?.slice(0, 500) ?? null,
        parentListId,
        metadataSchema: normalizeMetadataSchema(dto.metadataSchema) as any,
      },
    });

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'CHOICE_LIST_CREATED',
      resource: 'ChoiceList',
      resourceId: list.id,
      metadata: { slug, name: list.name },
    });

    return list;
  }

  async updateList(
    orgId: string,
    slug: string,
    dto: { name?: string; description?: string; parentListSlug?: string | null; metadataSchema?: unknown },
    userId?: string,
  ) {
    const list = await this.resolveList(orgId, slug);
    if (!list) throw new NotFoundException('List not found.');
    this.assertEditable(list, orgId);

    let parentListId: string | null | undefined;
    if (dto.parentListSlug !== undefined) {
      if (dto.parentListSlug === null) {
        parentListId = null;
      } else {
        const parent = await this.resolveList(orgId, dto.parentListSlug);
        if (!parent) throw new BadRequestException('The parent list does not exist.');
        // A list that is its own ancestor makes the cascade query recurse
        // forever the first time a respondent opens the form.
        if (parent.id === list.id) {
          throw new BadRequestException('A list cannot be its own parent.');
        }
        parentListId = parent.id;
      }
    }

    const updated = await this.prisma.writer.choiceList.update({
      where: { id: list.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.slice(0, 120) }),
        ...(dto.description !== undefined && { description: dto.description?.slice(0, 500) ?? null }),
        ...(parentListId !== undefined && { parentListId }),
        ...(dto.metadataSchema !== undefined && {
          metadataSchema: normalizeMetadataSchema(dto.metadataSchema) as any,
        }),
        version: { increment: 1 },
      },
    });

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'CHOICE_LIST_UPDATED',
      resource: 'ChoiceList',
      resourceId: list.id,
    });

    return updated;
  }

  /**
   * Replace or extend a list's items.
   *
   * `mode: 'replace'` deactivates anything absent from the payload rather than
   * deleting it. A retired option must still resolve to a label in every
   * historical answer that references it — deleting the row turns those
   * submissions into bare codes.
   */
  async importItems(
    orgId: string,
    slug: string,
    dto: { items: ChoiceItemInput[]; mode?: 'replace' | 'merge' },
    userId?: string,
  ) {
    const list = await this.resolveList(orgId, slug);
    if (!list) throw new NotFoundException('List not found.');
    this.assertEditable(list, orgId);

    if (!Array.isArray(dto.items)) throw new BadRequestException('`items` must be an array.');
    if (dto.items.length > CHOICE_LIMITS.MAX_IMPORT_ITEMS) {
      throw new BadRequestException(
        `At most ${CHOICE_LIMITS.MAX_IMPORT_ITEMS} items can be imported at once; this had ${dto.items.length}. Split the file.`,
      );
    }

    const normalized = normalizeItems(dto.items, !!list.parentListId);
    if (normalized.length === 0) {
      throw new BadRequestException('No usable items in the payload.');
    }

    const mode = dto.mode === 'merge' ? 'merge' : 'replace';

    await this.prisma.writer.$transaction(async (tx) => {
      const existing = await tx.choiceItem.findMany({
        where: { listId: list.id },
        select: { id: true, value: true },
      });
      const idByValue = new Map(existing.map((item) => [item.value, item.id]));

      const incoming = new Set(normalized.map((item) => item.value));
      const toCreate = normalized.filter((item) => !idByValue.has(item.value));

      if (toCreate.length > 0) {
        await tx.choiceItem.createMany({
          data: toCreate.map((item) => ({ listId: list.id, ...item })) as any,
          skipDuplicates: true,
        });
      }

      for (const item of normalized) {
        const id = idByValue.get(item.value);
        if (!id) continue;
        await tx.choiceItem.update({
          where: { id },
          data: { ...item, isActive: true } as any,
        });
      }

      if (mode === 'replace') {
        const stale = existing.filter((item) => !incoming.has(item.value)).map((item) => item.id);
        if (stale.length > 0) {
          await tx.choiceItem.updateMany({
            where: { id: { in: stale } },
            data: { isActive: false },
          });
        }
      }

      const itemCount = await tx.choiceItem.count({ where: { listId: list.id, isActive: true } });
      await tx.choiceList.update({
        where: { id: list.id },
        // Moving `version` is what invalidates the items cache.
        data: { itemCount, version: { increment: 1 } },
      });
    });

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'CHOICE_LIST_ITEMS_IMPORTED',
      resource: 'ChoiceList',
      resourceId: list.id,
      metadata: { slug, mode, count: normalized.length },
    });

    const refreshed = await this.prisma.reader.choiceList.findUniqueOrThrow({
      where: { id: list.id },
      select: { id: true, slug: true, itemCount: true, version: true },
    });
    return refreshed;
  }

  async deleteList(orgId: string, slug: string, userId?: string) {
    const list = await this.resolveList(orgId, slug);
    if (!list) throw new NotFoundException('List not found.');
    this.assertEditable(list, orgId);

    // A list that other lists cascade from cannot go: deleting it would leave
    // every child unreachable and every question bound to one silently empty.
    const children = await this.prisma.reader.choiceList.count({
      where: { parentListId: list.id, deletedAt: null },
    });
    if (children > 0) {
      throw new ConflictException(
        `${children} other list(s) cascade from this one. Detach them before deleting it.`,
      );
    }

    await this.prisma.writer.choiceList.update({
      where: { id: list.id },
      data: { deletedAt: new Date() },
    });

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'CHOICE_LIST_DELETED',
      resource: 'ChoiceList',
      resourceId: list.id,
      metadata: { slug },
    });

    return { message: 'List deleted.' };
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function normalizeMetadataSchema(input: unknown): Array<{ key: string; label: string; type: string }> {
  if (!Array.isArray(input)) return [];
  const out: Array<{ key: string; label: string; type: string }> = [];
  for (const raw of input.slice(0, CHOICE_LIMITS.MAX_METADATA_KEYS)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const key = typeof entry.key === 'string' ? normalizeSlug(entry.key).replace(/-/g, '_') : '';
    if (!key) continue;
    out.push({
      key,
      label: typeof entry.label === 'string' ? entry.label.slice(0, 120) : key,
      type: typeof entry.type === 'string' ? entry.type.slice(0, 20) : 'text',
    });
  }
  return out;
}

/**
 * Coerce a caller's rows into storable items.
 *
 * Repair-first, like `normalizeFormStructure`: an import of ten thousand rows
 * should not fail wholesale because three of them are blank. Rows without a
 * usable `value` are dropped, everything else is clamped.
 */
function normalizeItems(
  items: ChoiceItemInput[],
  requiresParent: boolean,
): Array<{
  value: string;
  label: string;
  parentValue: string | null;
  metadata: Record<string, unknown>;
  sortOrder: number;
}> {
  const seen = new Set<string>();
  const out: Array<{
    value: string;
    label: string;
    parentValue: string | null;
    metadata: Record<string, unknown>;
    sortOrder: number;
  }> = [];

  items.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const value = typeof raw.value === 'string' ? raw.value.trim().slice(0, 120) : '';
    if (!value) return;
    // A duplicate value would collide on the unique index and abort the whole
    // import; the first occurrence wins.
    if (seen.has(value)) return;
    seen.add(value);

    const parentValue =
      typeof raw.parentValue === 'string' && raw.parentValue.trim()
        ? raw.parentValue.trim().slice(0, 120)
        : null;
    // A child-list item with no parent can never be reached by the cascade.
    if (requiresParent && !parentValue) return;

    const metadata: Record<string, unknown> = {};
    if (raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)) {
      for (const [key, entry] of Object.entries(raw.metadata).slice(
        0,
        CHOICE_LIMITS.MAX_METADATA_KEYS,
      )) {
        if (entry === null || entry === undefined) continue;
        if (typeof entry === 'object') continue;
        metadata[key.slice(0, 60)] =
          typeof entry === 'string'
            ? entry.slice(0, CHOICE_LIMITS.MAX_METADATA_VALUE_LENGTH)
            : entry;
      }
    }

    out.push({
      value,
      label:
        typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 300) : value,
      parentValue,
      metadata,
      sortOrder: Number.isFinite(raw.sortOrder) ? Number(raw.sortOrder) : index,
    });
  });

  return out;
}

/** Re-exported so the submissions path can key a bag without importing the AST. */
export { lookupKey };
