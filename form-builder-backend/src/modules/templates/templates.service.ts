import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/infra/prisma/prisma.service';
import {
  parsePagination,
  paginated,
  type Pagination,
} from '../../common/http/pagination/pagination';

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicTemplates(
    category?: string,
    pagination: Pagination = parsePagination(),
    search?: string,
  ) {
    const where: Prisma.FormTemplateWhereInput = { isPublic: true };
    if (category) where.category = category;

    // Search was applied client-side against the loaded page only, so searching
    // for a template that sat on page 2 returned nothing.
    const term = search?.trim();
    if (term) {
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        { category: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [templates, total] = await Promise.all([
      this.prisma.reader.formTemplate.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        // `id` breaks ties: without a unique tiebreaker, two templates with the
        // same usageCount can swap between pages and one is never shown.
        orderBy: [{ usageCount: 'desc' }, { id: 'asc' }],
        // The catalogue grid needs none of the template's definition JSON,
        // which is the bulk of the row.
        select: {
          id: true,
          name: true,
          description: true,
          category: true,
          thumbnail: true,
          usageCount: true,
          createdAt: true,
        },
      }),
      this.prisma.reader.formTemplate.count({ where }),
    ]);

    return paginated('templates', templates, pagination, total);
  }

  /**
   * Distinct categories, for the templates filter. Without this the frontend
   * had a hardcoded category list that did not match the seeded data.
   */
  async getCategories(): Promise<string[]> {
    const rows = await this.prisma.reader.formTemplate.findMany({
      where: { isPublic: true },
      distinct: ['category'],
      select: { category: true },
      orderBy: { category: 'asc' },
    });

    // `category` is non-nullable in the schema but can be an empty string on
    // seeded rows; an empty filter option is worse than none.
    return rows
      .map((row) => row.category)
      .filter(
        (category): category is string =>
          !!category && category.trim().length > 0,
      );
  }

  async getTemplateById(id: string) {
    const template = await this.prisma.reader.formTemplate.findFirst({
      // A non-public template must not be readable by id — the endpoint is
      // unauthenticated, so `findUnique` handed out private templates to
      // anyone who guessed or scraped an id.
      where: { id, isPublic: true },
    });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }
}
