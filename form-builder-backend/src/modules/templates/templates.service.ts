import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicTemplates(category?: string, page = 1, limit = 20) {
    const where: any = { isPublic: true };
    if (category) {
      where.category = category;
    }
    
    const skip = (page - 1) * limit;

    const [templates, total] = await Promise.all([
      this.prisma.reader.formTemplate.findMany({
        where,
        skip,
        take: limit,
        orderBy: { usageCount: 'desc' },
        select: {
          id: true,
          name: true,
          description: true,
          category: true,
          thumbnail: true,
          usageCount: true,
          createdAt: true,
        }
      }),
      this.prisma.reader.formTemplate.count({ where })
    ]);

    return {
      templates,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async getTemplateById(id: string) {
    const template = await this.prisma.reader.formTemplate.findUnique({
      where: { id },
    });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }
}
