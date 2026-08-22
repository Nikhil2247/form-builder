import { Injectable } from '@nestjs/common';
import { AssistantMessageRole } from '@prisma/client';
import { PrismaService } from '../../common/infra/prisma/prisma.service';

const PLATFORM_BUCKET_KEY = '__platform__';
const DEFAULT_WINDOW_DAYS = 30;

export interface OrgUsageRow {
  /** null for platform (superadmin cross-org) sessions, which have no organization. */
  organizationId: string | null;
  organizationName: string;
  totalQueries: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  /** cache_read / (cache_read + input) per §3.8 — null when there's no traffic to divide. */
  cacheHitRate: number | null;
}

/**
 * Usage aggregation for AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.8 — reads the
 * per-turn token/cost columns Phase A already writes on every ASSISTANT
 * message (agent-loop.service.ts#finish) rather than tracking usage a second
 * way. In-memory aggregation over a bounded time window, not a raw SQL
 * groupBy: this repo's usage volume doesn't need it, and it keeps the query
 * a plain Prisma call.
 *
 * Deliberately no enforcement here — see the plan's §6 decision 3: the org
 * asked for visibility (who's using the most, in tokens and cost), not a
 * spend ceiling.
 */
@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  async getUsageByOrg(params: {
    days?: number;
    organizationId?: string;
  }): Promise<OrgUsageRow[]> {
    const days =
      params.days && params.days > 0 ? params.days : DEFAULT_WINDOW_DAYS;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const messages = await this.prisma.reader.assistantMessage.findMany({
      where: {
        role: AssistantMessageRole.ASSISTANT,
        createdAt: { gte: since },
        session: params.organizationId
          ? { organizationId: params.organizationId }
          : undefined,
      },
      select: {
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheCreationTokens: true,
        costUsd: true,
        session: {
          select: {
            organizationId: true,
            organization: { select: { name: true } },
          },
        },
      },
    });

    const byOrg = new Map<string, OrgUsageRow>();
    for (const message of messages) {
      const orgId = message.session.organizationId;
      const key = orgId ?? PLATFORM_BUCKET_KEY;
      const row = byOrg.get(key) ?? {
        organizationId: orgId,
        organizationName: orgId
          ? (message.session.organization?.name ?? 'Unknown organization')
          : 'Platform (superadmin)',
        totalQueries: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
        cacheHitRate: null,
      };
      row.totalQueries += 1;
      row.inputTokens += message.inputTokens ?? 0;
      row.outputTokens += message.outputTokens ?? 0;
      row.cacheReadTokens += message.cacheReadTokens ?? 0;
      row.cacheCreationTokens += message.cacheCreationTokens ?? 0;
      row.costUsd += message.costUsd ? Number(message.costUsd) : 0;
      byOrg.set(key, row);
    }

    return Array.from(byOrg.values())
      .map((row) => ({
        ...row,
        costUsd: Math.round(row.costUsd * 1e6) / 1e6,
        cacheHitRate:
          row.cacheReadTokens + row.inputTokens > 0
            ? row.cacheReadTokens / (row.cacheReadTokens + row.inputTokens)
            : null,
      }))
      .sort((a, b) => b.costUsd - a.costUsd);
  }
}
