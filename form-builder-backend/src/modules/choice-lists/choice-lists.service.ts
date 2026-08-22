import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../common/infra/prisma/prisma.service';
import { RedisService } from '../../common/infra/redis/redis.service';
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

/**
 * Rows per SQL statement during an import.
 *
 * The whole import is one statement per chunk, not one per row. At 20 000 rows
 * the previous row-at-a-time loop issued 20 000 round trips inside a single
 * interactive transaction, which exceeded Prisma's 5 s transaction timeout long
 * before it finished and rolled the entire upload back — so the largest imports,
 * the ones this feature exists for, were the ones that could never succeed.
 *
 * 1 000 keeps each statement's parameter arrays small enough to plan quickly
 * while cutting the round trips by three orders of magnitude.
 */
const IMPORT_CHUNK_SIZE = 1_000;

/**
 * Who is acting on a list.
 *
 * `null` is the platform itself — a super admin curating the global dictionary
 * every tenant reads (India's states and districts ship that way). A string is
 * one organization acting on its own lists. It is deliberately the same shape as
 * `ChoiceList.organizationId`, so the scope and the column can never drift.
 */
export type ChoiceListScope = string | null;

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

  /**
   * The list a write is allowed to touch, or a refusal explaining why not.
   *
   * Writes do NOT go through `resolveList`. That one falls back to the global
   * list when the org has none of its own, which is exactly right for reading
   * and exactly wrong for writing — an org editing "in-districts" it does not
   * own must be told so, not silently handed the row every other tenant reads.
   * Scoping the lookup by `organizationId` makes that impossible to get wrong:
   * a super admin (`scope === null`) matches only global rows, an org matches
   * only its own.
   */
  private async resolveForWrite(scope: ChoiceListScope, slug: string) {
    const list = await this.prisma.reader.choiceList.findFirst({
      where: { organizationId: scope, slug, deletedAt: null },
    });
    if (list) return list;

    // Nothing owned. If a global list answers to this slug, say which wall the
    // caller has hit rather than claiming the list does not exist.
    if (scope !== null) {
      const global = await this.prisma.reader.choiceList.findFirst({
        where: { organizationId: null, slug, deletedAt: null },
        select: { id: true },
      });
      if (global) {
        throw new BadRequestException(
          'This list is provided by the platform and cannot be edited here. Create your own copy to change it.',
        );
      }
    }

    throw new NotFoundException('List not found.');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // READS
  // ══════════════════════════════════════════════════════════════════════════

  async listLists(orgId: string) {
    const lists = await this.prisma.reader.choiceList.findMany({
      where: this.visibilityWhere(orgId),
      orderBy: [
        { organizationId: { sort: 'desc', nulls: 'last' } },
        { name: 'asc' },
      ],
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
    query: {
      parent?: string;
      q?: string;
      limit?: number;
      cursor?: string;
      values?: string[];
    },
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
        select: {
          id: true,
          value: true,
          label: true,
          parentValue: true,
          metadata: true,
        },
      });
      return { items, nextCursor: null, total: items.length };
    }

    const limit = Math.min(
      Math.max(Number(query.limit) || CHOICE_LIMITS.DEFAULT_PAGE_SIZE, 1),
      CHOICE_LIMITS.MAX_PAGE_SIZE,
    );
    const search =
      typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
    const parent =
      typeof query.parent === 'string' ? query.parent.trim().slice(0, 120) : '';

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
      ...(search
        ? { label: { contains: search, mode: 'insensitive' as const } }
        : {}),
    };

    const rows = await this.prisma.reader.choiceItem.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      // One extra row tells us whether another page exists without a COUNT.
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        value: true,
        label: true,
        parentValue: true,
        metadata: true,
      },
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
  ): Promise<
    Map<
      string,
      { value: string; parentValue: string | null; metadata: unknown }
    >
  > {
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
      where: {
        ...this.visibilityWhere(orgId),
        slug: { in: [...bySlug.keys()] },
      },
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
      requests.map((request) => ({
        listSlug: request.list,
        value: request.value,
      })),
    );

    const metadataByKey = new Map<string, Record<string, unknown>>();
    for (const [key, item] of resolved) {
      metadataByKey.set(
        key,
        item.metadata &&
          typeof item.metadata === 'object' &&
          !Array.isArray(item.metadata)
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
    scope: ChoiceListScope,
    dto: {
      name: string;
      slug?: string;
      description?: string;
      parentListSlug?: string;
      metadataSchema?: unknown;
    },
    userId?: string,
  ) {
    if (typeof dto?.name !== 'string' || !dto.name.trim()) {
      throw new BadRequestException('A list needs a name.');
    }

    const slug = normalizeSlug(dto.slug || dto.name);
    // A name of only punctuation ("---") slugifies to nothing, which would
    // otherwise be stored as an empty slug that no question could ever bind to.
    if (slug.length < 2) {
      throw new BadRequestException(
        'The list id must contain at least two letters or digits. Try naming it after what it holds, like "Districts".',
      );
    }

    // Global lists are curated by the platform, not by a tenant, so the
    // per-organization ceiling does not apply to them.
    if (scope !== null) {
      const count = await this.prisma.reader.choiceList.count({
        where: { organizationId: scope, deletedAt: null },
      });
      if (count >= CHOICE_LIMITS.MAX_LISTS_PER_ORG) {
        throw new BadRequestException(
          `An organization may have at most ${CHOICE_LIMITS.MAX_LISTS_PER_ORG} lists.`,
        );
      }
    }

    const clash = await this.prisma.reader.choiceList.findFirst({
      where: { organizationId: scope, slug, deletedAt: null },
      select: { id: true },
    });
    if (clash)
      throw new ConflictException(
        `A list with the id "${slug}" already exists.`,
      );

    // A global list may only cascade from another global list. Pointing one at
    // a tenant's list would expose that tenant's values to every other org
    // through the cascade, which is a data leak dressed as a dropdown.
    let parentListId: string | null = null;
    if (dto.parentListSlug) {
      const parent =
        scope === null
          ? await this.prisma.reader.choiceList.findFirst({
              where: {
                organizationId: null,
                slug: dto.parentListSlug,
                deletedAt: null,
              },
            })
          : await this.resolveList(scope, dto.parentListSlug);
      if (!parent)
        throw new BadRequestException('The parent list does not exist.');
      parentListId = parent.id;
    }

    const list = await this.prisma.writer.choiceList.create({
      data: {
        organizationId: scope,
        slug,
        name: dto.name.trim().slice(0, 120),
        description: dto.description?.slice(0, 500) ?? null,
        parentListId,
        metadataSchema: normalizeMetadataSchema(dto.metadataSchema) as any,
      },
    });

    this.audit.log({
      organizationId: scope ?? undefined,
      userId,
      action:
        scope === null ? 'CHOICE_LIST_GLOBAL_CREATED' : 'CHOICE_LIST_CREATED',
      resource: 'ChoiceList',
      resourceId: list.id,
      metadata: { slug, name: list.name },
    });

    return { ...list, isGlobal: list.organizationId === null };
  }

  async updateList(
    scope: ChoiceListScope,
    slug: string,
    dto: {
      name?: string;
      description?: string;
      parentListSlug?: string | null;
      metadataSchema?: unknown;
    },
    userId?: string,
  ) {
    const list = await this.resolveForWrite(scope, slug);

    let parentListId: string | null | undefined;
    if (dto.parentListSlug !== undefined) {
      if (dto.parentListSlug === null) {
        parentListId = null;
      } else {
        const parent =
          scope === null
            ? await this.prisma.reader.choiceList.findFirst({
                where: {
                  organizationId: null,
                  slug: dto.parentListSlug,
                  deletedAt: null,
                },
              })
            : await this.resolveList(scope, dto.parentListSlug);
        if (!parent)
          throw new BadRequestException('The parent list does not exist.');
        parentListId = parent.id;
        await this.assertNoCycle(list.id, parent.id);
      }
    }

    const updated = await this.prisma.writer.choiceList.update({
      where: { id: list.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.slice(0, 120) }),
        ...(dto.description !== undefined && {
          description: dto.description?.slice(0, 500) ?? null,
        }),
        ...(parentListId !== undefined && { parentListId }),
        ...(dto.metadataSchema !== undefined && {
          metadataSchema: normalizeMetadataSchema(dto.metadataSchema) as any,
        }),
        version: { increment: 1 },
      },
    });

    this.audit.log({
      organizationId: scope ?? undefined,
      userId,
      action:
        scope === null ? 'CHOICE_LIST_GLOBAL_UPDATED' : 'CHOICE_LIST_UPDATED',
      resource: 'ChoiceList',
      resourceId: list.id,
      metadata: { slug },
    });

    return { ...updated, isGlobal: updated.organizationId === null };
  }

  /**
   * Refuse a parent link that would make the hierarchy a ring.
   *
   * The previous check only rejected a list naming *itself*, which catches
   * A → A and nothing else. A → B → A is just as fatal and was allowed: the
   * cascade walks parents to decide what to load, so a ring made the first
   * respondent to open the form loop until the request timed out. Walking up
   * from the proposed parent is cheap — hierarchies here are two or three deep
   * — and the step ceiling stops even a ring that predates this check from
   * hanging the request that tries to repair it.
   */
  private async assertNoCycle(listId: string, proposedParentId: string) {
    let cursor: string | null = proposedParentId;
    for (let step = 0; cursor && step < 64; step++) {
      if (cursor === listId) {
        throw new BadRequestException(
          'That would make the lists cascade in a circle. Pick a parent that does not already sit under this list.',
        );
      }
      const row: { parentListId: string | null } | null =
        await this.prisma.reader.choiceList.findUnique({
          where: { id: cursor },
          select: { parentListId: true },
        });
      cursor = row?.parentListId ?? null;
    }
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
    scope: ChoiceListScope,
    slug: string,
    dto: { items: ChoiceItemInput[]; mode?: 'replace' | 'merge' },
    userId?: string,
  ) {
    const list = await this.resolveForWrite(scope, slug);

    if (!Array.isArray(dto.items))
      throw new BadRequestException('`items` must be an array.');
    if (dto.items.length > CHOICE_LIMITS.MAX_IMPORT_ITEMS) {
      throw new BadRequestException(
        `At most ${CHOICE_LIMITS.MAX_IMPORT_ITEMS} rows can be imported at once; this had ${dto.items.length}. Upload the file in parts using "Add and update".`,
      );
    }

    const normalized = normalizeItems(dto.items, !!list.parentListId);
    if (normalized.length === 0) {
      throw new BadRequestException(
        list.parentListId
          ? 'No usable rows. This list cascades from another one, so every row needs a parent value naming the item it sits under.'
          : 'No usable rows — every row was missing a value.',
      );
    }

    const mode = dto.mode === 'merge' ? 'merge' : 'replace';
    const skipped = dto.items.length - normalized.length;

    const result = await this.prisma.writer.$transaction(
      async (tx) => {
        const before = await tx.choiceItem.count({
          where: { listId: list.id },
        });

        // ── Upsert, in chunks, one statement each ───────────────────────────
        //
        // The row-at-a-time loop this replaces issued an UPDATE per existing
        // row: re-importing a 20 000-row district file meant 20 000 sequential
        // round trips inside one interactive transaction, which blew the
        // transaction timeout and rolled back the entire upload. Here each
        // chunk is a single INSERT ... ON CONFLICT, so the same import is 20
        // statements rather than 20 000.
        for (
          let offset = 0;
          offset < normalized.length;
          offset += IMPORT_CHUNK_SIZE
        ) {
          const chunk = normalized.slice(offset, offset + IMPORT_CHUNK_SIZE);

          // `id` is generated here rather than in SQL: the Prisma schema
          // declares `@default(uuid())`, which Prisma applies client-side, so
          // the column carries no database-level default to fall back on.
          const ids = chunk.map(() => randomUUID());
          const values = chunk.map((item) => item.value);
          const labels = chunk.map((item) => item.label);
          const parents = chunk.map((item) => item.parentValue);
          const metadata = chunk.map((item) => JSON.stringify(item.metadata));
          const sortOrders = chunk.map((item) => item.sortOrder);

          await tx.$executeRaw`
            INSERT INTO "choice_items"
              ("id", "list_id", "value", "label", "parent_value", "metadata", "sort_order", "is_active")
            SELECT
              t.id::uuid,
              ${list.id}::uuid,
              t.value,
              t.label,
              t.parent_value,
              t.metadata::jsonb,
              t.sort_order,
              true
            FROM unnest(
              ${ids}::text[],
              ${values}::text[],
              ${labels}::text[],
              ${parents}::text[],
              ${metadata}::text[],
              ${sortOrders}::int[]
            ) AS t(id, value, label, parent_value, metadata, sort_order)
            ON CONFLICT ("list_id", "value") DO UPDATE SET
              "label"        = EXCLUDED."label",
              "parent_value" = EXCLUDED."parent_value",
              "metadata"     = EXCLUDED."metadata",
              "sort_order"   = EXCLUDED."sort_order",
              -- A value that comes back in a later import is offered again.
              "is_active"    = true
          `;
        }

        // ── Retire what the file no longer contains ─────────────────────────
        //
        // Deactivated, never deleted: a retired option must still resolve to a
        // label in every historical answer that references it, or those
        // submissions render as bare codes.
        let retired = 0;
        if (mode === 'replace') {
          retired = await tx.$executeRaw`
            UPDATE "choice_items"
               SET "is_active" = false
             WHERE "list_id" = ${list.id}::uuid
               AND "is_active" = true
               AND "value" <> ALL(${normalized.map((item) => item.value)}::text[])
          `;
        }

        const [{ count }] = await tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*)::bigint AS count
            FROM "choice_items"
           WHERE "list_id" = ${list.id}::uuid AND "is_active" = true
        `;
        const itemCount = Number(count);

        await tx.choiceList.update({
          where: { id: list.id },
          // Moving `version` is what invalidates the items cache.
          data: { itemCount, version: { increment: 1 } },
        });

        const after = await tx.choiceItem.count({ where: { listId: list.id } });

        return {
          itemCount,
          retired,
          created: after - before,
          updated: normalized.length - (after - before),
        };
      },
      // The default 5 s ceiling is not enough for a 20 000-row upload even at
      // one statement per thousand rows, and a timeout here discards the whole
      // file after the user has waited for it to upload.
      { timeout: 120_000, maxWait: 15_000 },
    );

    this.audit.log({
      organizationId: scope ?? undefined,
      userId,
      action:
        scope === null
          ? 'CHOICE_LIST_GLOBAL_ITEMS_IMPORTED'
          : 'CHOICE_LIST_ITEMS_IMPORTED',
      resource: 'ChoiceList',
      resourceId: list.id,
      metadata: { slug, mode, submitted: dto.items.length, ...result, skipped },
    });

    return {
      id: list.id,
      slug: list.slug,
      mode,
      /** Rows in the payload that had no usable value (or no parent, on a child list). */
      skipped,
      ...result,
    };
  }

  async deleteList(scope: ChoiceListScope, slug: string, userId?: string) {
    const list = await this.resolveForWrite(scope, slug);

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
      organizationId: scope ?? undefined,
      userId,
      action:
        scope === null ? 'CHOICE_LIST_GLOBAL_DELETED' : 'CHOICE_LIST_DELETED',
      resource: 'ChoiceList',
      resourceId: list.id,
      metadata: { slug },
    });

    return { message: 'List deleted.' };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DICTIONARY MANAGEMENT
  //
  // The authoring surface, as opposed to the respondent-facing reads above. It
  // differs in three ways that matter: it shows retired items (an editor needs
  // to see what was dropped by the last import), it does not require a parent
  // on a child list (the point is to review the whole file that was uploaded),
  // and it reports a true total so the page count is real.
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * The list a READ may see, which is a wider set than a write may touch.
   *
   * An org admin looking at the dictionary sees the platform's global lists
   * alongside their own — they need to know `in-districts` exists before they
   * decide whether to shadow it — so browsing and exporting resolve org-then-
   * global, exactly as `resolveList` does for the builder. Writes deliberately
   * do not: see `resolveForWrite`.
   */
  private async resolveForRead(scope: ChoiceListScope, slug: string) {
    const list =
      scope === null
        ? await this.prisma.reader.choiceList.findFirst({
            where: { organizationId: null, slug, deletedAt: null },
          })
        : await this.resolveList(scope, slug);

    if (!list) throw new NotFoundException('List not found.');
    return list;
  }

  /** Lists in one scope. `null` is the platform's global dictionary. */
  async listListsForScope(scope: ChoiceListScope) {
    const lists = await this.prisma.reader.choiceList.findMany({
      where: { organizationId: scope, deletedAt: null },
      orderBy: { name: 'asc' },
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
      isGlobal: list.organizationId === null,
    }));
  }

  /**
   * One page of a list's items for the dictionary browser.
   *
   * OFFSET-paginated, unlike the respondent-facing `queryItems`, because an
   * editor needs to jump to page 40 and a cursor cannot do that. The offset is
   * capped so the cost of the skip stays bounded — past the cap the answer is
   * "narrow your search", which is also the more useful answer.
   */
  async browseItems(
    scope: ChoiceListScope,
    slug: string,
    query: {
      q?: string;
      parent?: string;
      page?: number;
      limit?: number;
      includeInactive?: boolean;
    },
  ) {
    const list = await this.resolveForRead(scope, slug);

    const limit = Math.min(
      Math.max(Number(query.limit) || CHOICE_LIMITS.DEFAULT_PAGE_SIZE, 1),
      CHOICE_LIMITS.MAX_PAGE_SIZE,
    );
    const page = Math.max(Number(query.page) || 1, 1);
    const MAX_PAGE = 500;
    if (page > MAX_PAGE) {
      throw new BadRequestException(
        `Only the first ${MAX_PAGE} pages can be paged through directly. Search for what you need instead.`,
      );
    }

    const search =
      typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
    const parent =
      typeof query.parent === 'string' ? query.parent.trim().slice(0, 120) : '';

    const where: Prisma.ChoiceItemWhereInput = {
      listId: list.id,
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(parent ? { parentValue: parent } : {}),
      ...(search
        ? {
            OR: [
              { label: { contains: search, mode: 'insensitive' } },
              { value: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.reader.choiceItem.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          value: true,
          label: true,
          parentValue: true,
          metadata: true,
          sortOrder: true,
          isActive: true,
        },
      }),
      this.prisma.reader.choiceItem.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
      metadataSchema: list.metadataSchema,
      cascades: !!list.parentListId,
    };
  }

  /**
   * The whole list as CSV, in the same column layout the importer accepts.
   *
   * Round-tripping is the point: export, correct a few labels in a spreadsheet,
   * re-import. Streaming is deliberately not attempted — a list is bounded by
   * MAX_IMPORT_ITEMS, so the largest possible export is a few megabytes.
   */
  async exportCsv(scope: ChoiceListScope, slug: string): Promise<string> {
    const list = await this.resolveForRead(scope, slug);
    const schema = normalizeMetadataSchema(list.metadataSchema);
    const items = await this.prisma.reader.choiceItem.findMany({
      where: { listId: list.id },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        value: true,
        label: true,
        parentValue: true,
        metadata: true,
        isActive: true,
      },
      take: CHOICE_LIMITS.MAX_IMPORT_ITEMS,
    });

    const header = [
      'value',
      'label',
      ...(list.parentListId ? ['parent_value'] : []),
      ...schema.map((column) => column.key),
      'is_active',
    ];

    const rows = items.map((item) => {
      const metadata = (item.metadata ?? {}) as Record<string, unknown>;
      return [
        item.value,
        item.label,
        ...(list.parentListId ? [item.parentValue ?? ''] : []),
        ...schema.map((column) => stringifyCell(metadata[column.key])),
        item.isActive ? 'true' : 'false',
      ]
        .map(csvCell)
        .join(',');
    });

    return [header.join(','), ...rows].join('\r\n');
  }

  /**
   * A blank starter file for this list: the right headers, and example rows.
   *
   * "Export" is not a substitute for this. An empty list exports a header and
   * nothing else, which tells a first-time user what the columns are called but
   * not what belongs in them — and the column that matters most, `parent_value`,
   * is the one whose meaning is least obvious from its name. The examples are
   * drawn from the PARENT list where there is one, so the sample rows a user
   * downloads for "Nagaland — Blocks" already carry real district values they
   * can cascade under rather than a placeholder they must go and look up.
   */
  async templateCsv(scope: ChoiceListScope, slug: string): Promise<string> {
    const list = await this.resolveForRead(scope, slug);
    const schema = normalizeMetadataSchema(list.metadataSchema);

    const header = [
      'value',
      'label',
      ...(list.parentListId ? ['parent_value'] : []),
      ...schema.map((column) => column.key),
    ];

    // Real parent values beat an invented one: a row whose parent does not
    // resolve is silently skipped at import, and a user whose sample file was
    // skipped has no way to tell that from "the upload did nothing".
    let parentSamples: string[] = [];
    if (list.parentListId) {
      const parents = await this.prisma.reader.choiceItem.findMany({
        where: { listId: list.parentListId, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { value: true },
        take: 2,
      });
      parentSamples = parents.map((parent) => parent.value);
    }

    const EXAMPLES = [
      { value: 'example-001', label: 'First example — replace this row' },
      { value: 'example-002', label: 'Second example — replace this row' },
    ];

    const rows = EXAMPLES.map((example, index) =>
      [
        example.value,
        example.label,
        ...(list.parentListId
          ? [
              parentSamples[index] ??
                parentSamples[0] ??
                'parent-value-from-the-list-above',
            ]
          : []),
        ...schema.map((column) => `sample ${column.label || column.key}`),
      ]
        .map(csvCell)
        .join(','),
    );

    return [header.join(','), ...rows].join('\r\n');
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  // Metadata is JSONB, so a cell can legitimately hold a nested object even
  // though the importer only ever writes scalars — an older row, or one written
  // by the API directly. `String({})` would export "[object Object]" and lose it
  // on the round trip through a spreadsheet.
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '';
}

/**
 * Escape a cell for CSV, defending against CSV injection.
 *
 * A cell beginning with = + - @ (or tab/CR) is interpreted as a formula by
 * Excel and Sheets. A dictionary is uploaded by one admin and downloaded by
 * another, so a list item labelled `=cmd|'/c calc'!A1` would execute on whoever
 * opens the export. The leading quote neutralises it and still displays the
 * original text. Same treatment as the submission export in FormsService.
 */
function csvCell(value: string): string {
  let cell = value ?? '';
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
}

function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function normalizeMetadataSchema(
  input: unknown,
): Array<{ key: string; label: string; type: string }> {
  if (!Array.isArray(input)) return [];
  const out: Array<{ key: string; label: string; type: string }> = [];
  for (const raw of input.slice(0, CHOICE_LIMITS.MAX_METADATA_KEYS)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const key =
      typeof entry.key === 'string'
        ? normalizeSlug(entry.key).replace(/-/g, '_')
        : '';
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
    const value =
      typeof raw.value === 'string' ? raw.value.trim().slice(0, 120) : '';
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
    if (
      raw.metadata &&
      typeof raw.metadata === 'object' &&
      !Array.isArray(raw.metadata)
    ) {
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
        typeof raw.label === 'string' && raw.label.trim()
          ? raw.label.trim().slice(0, 300)
          : value,
      parentValue,
      metadata,
      sortOrder: Number.isFinite(raw.sortOrder) ? Number(raw.sortOrder) : index,
    });
  });

  return out;
}

/** Re-exported so the submissions path can key a bag without importing the AST. */
export { lookupKey };
