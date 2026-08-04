import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get analytics for a specific form, scoped by organization.
   */
  async getFormAnalytics(orgId: string, formId: string) {
    // Verify form belongs to this org
    const form = await this.prisma.reader.form.findFirst({
      where: { id: formId, organizationId: orgId },
      select: { id: true },
    });

    if (!form) {
      throw new NotFoundException('Form not found in this organization.');
    }

    return this.prisma.reader.formAnalytics.findMany({
      where: { formId },
      orderBy: { date: 'asc' },
    });
  }

  /**
   * Get aggregated analytics across all forms in an organization.
   */
  async getGlobalAnalytics(orgId: string) {
    return this.prisma.reader.formAnalytics.groupBy({
      by: ['date'],
      where: {
        form: { organizationId: orgId },
      },
      _sum: {
        submissions: true,
        views: true,
        starts: true,
      },
      orderBy: { date: 'asc' },
    });
  }
}
