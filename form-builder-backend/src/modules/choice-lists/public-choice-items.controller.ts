import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { ChoiceListsService } from './choice-lists.service';
import { PrismaService } from '../../common/infra/prisma/prisma.service';

/**
 * Options for a question on a PUBLIC form.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * SCOPED BY FORM AND QUESTION, NOT BY LIST SLUG. That is the whole security
 * design of this endpoint.
 *
 * The obvious shape — `GET /public-choice-lists/:slug/items` — would let anyone
 * enumerate any organization's lists by guessing slugs, and an org's supplier
 * registry or staff directory is exactly the kind of thing that ends up in one.
 * Here the caller names a published form and one of its questions; the server
 * reads the binding off that question's own definition and refuses anything
 * else. A respondent can therefore reach precisely the options the form they
 * are looking at would have shown them anyway, and nothing more.
 */
@Controller('public-forms/:slug/choice-items')
export class PublicChoiceItemsController {
  constructor(
    private readonly lists: ChoiceListsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  // Cascade responses are per (question, parent) and change only when the list
  // does, so they cache well. Short max-age with SWR keeps an edit visible
  // within minutes without putting the traffic on the origin.
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async items(
    @Param('slug') slug: string,
    @Query('question') questionId: string,
    @Query()
    query: {
      parent?: string;
      q?: string;
      limit?: string;
      cursor?: string;
      values?: string;
    },
  ) {
    if (!questionId)
      throw new NotFoundException('Question not found on this form.');

    const form = await this.prisma.reader.form.findFirst({
      where: { slug, deletedAt: null, status: 'PUBLISHED' },
      select: {
        organizationId: true,
        currentVersion: true,
        versions: {
          orderBy: { version: 'desc' },
          take: 5,
          select: { version: true, questionsJson: true },
        },
      },
    });
    if (!form || form.versions.length === 0)
      throw new NotFoundException('Form not found.');

    // The version the form actually points at, matching getPublicForm — a
    // respondent mid-publish must see the options for the schema they hold.
    const active =
      form.versions.find((v) => v.version === form.currentVersion) ??
      form.versions[0];

    const questions = Array.isArray(active.questionsJson)
      ? (active.questionsJson as any[])
      : [];
    const question = questions.find((q) => q?.id === questionId);
    if (!question)
      throw new NotFoundException('Question not found on this form.');

    const source = question.optionsSource;
    if (
      !source ||
      source.kind !== 'CHOICE_LIST' ||
      typeof source.listSlug !== 'string'
    ) {
      throw new NotFoundException(
        'This question does not draw its options from a list.',
      );
    }

    // Resolved against the FORM'S organization, not a caller-supplied one.
    const list = await this.lists.resolveList(
      form.organizationId,
      source.listSlug,
    );
    if (!list)
      throw new NotFoundException(
        'This question does not draw its options from a list.',
      );

    return this.lists.queryItems(list, {
      parent: query.parent,
      q: query.q,
      limit: query.limit ? Number(query.limit) : undefined,
      cursor: query.cursor,
      // Comma-separated exact values, used by the runner to resolve `lookup()`
      // for a field the respondent has already answered.
      values: query.values
        ? query.values.split(',').filter(Boolean)
        : undefined,
    });
  }
}
