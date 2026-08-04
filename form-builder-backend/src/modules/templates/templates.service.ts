import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicTemplates(category?: string) {
    const where: any = { isPublic: true };
    if (category) {
      where.category = category;
    }
    
    return this.prisma.reader.formTemplate.findMany({
      where,
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
    });
  }

  async getTemplateById(id: string) {
    const template = await this.prisma.reader.formTemplate.findUnique({
      where: { id },
    });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }
}
