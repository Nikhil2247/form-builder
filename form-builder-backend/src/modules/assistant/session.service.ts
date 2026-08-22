import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, AssistantMode, AssistantMessageRole } from '@prisma/client';
import { PrismaService } from '../../common/infra/prisma/prisma.service';
import { paginated, type Pagination } from '../../common/http/pagination/pagination';

export interface AppendMessageMeta {
  modelUsed?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd?: number;
  toolCalls?: unknown;
}

/**
 * CRUD over AssistantSession/AssistantMessage.
 *
 * Every read/write here takes `orgId` explicitly (null for PLATFORM_INSIGHTS,
 * a real id otherwise) so a session can never be fetched across the tenant
 * boundary — see tenant-scope.extension.ts, which also enforces this
 * independently for any query it can see.
 */
@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(
    orgId: string | null,
    userId: string,
    mode: AssistantMode,
    firstMessage: string,
  ) {
    return this.prisma.writer.assistantSession.create({
      data: {
        organizationId: orgId,
        userId,
        mode,
        title: firstMessage.slice(0, 200),
      },
    });
  }

  /**
   * Loads a session and asserts it belongs to this org (or, for a platform
   * session, that `orgId` is null) and this user.
   */
  async getSession(orgId: string | null, userId: string, sessionId: string) {
    const session = await this.prisma.reader.assistantSession.findFirst({
      where: { id: sessionId, organizationId: orgId, userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!session) throw new NotFoundException('Assistant session not found.');
    return session;
  }

  async listSessions(
    orgId: string | null,
    userId: string,
    mode: AssistantMode,
    pagination: Pagination,
  ) {
    const where = { organizationId: orgId, userId, mode };
    const [sessions, total] = await Promise.all([
      this.prisma.reader.assistantSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.reader.assistantSession.count({ where }),
    ]);
    return paginated('sessions', sessions, pagination, total);
  }

  async appendMessage(
    sessionId: string,
    role: AssistantMessageRole,
    content: unknown,
    meta: AppendMessageMeta = {},
  ) {
    return this.prisma.writer.assistantMessage.create({
      data: {
        sessionId,
        role,
        content: content as Prisma.InputJsonValue,
        modelUsed: meta.modelUsed,
        inputTokens: meta.inputTokens,
        outputTokens: meta.outputTokens,
        cacheReadTokens: meta.cacheReadTokens,
        cacheCreationTokens: meta.cacheCreationTokens,
        costUsd: meta.costUsd,
        ...(meta.toolCalls
          ? { toolCalls: meta.toolCalls as Prisma.InputJsonValue }
          : {}),
      },
    });
  }
}
