import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  parsePagination,
  paginated,
  type Pagination,
} from '../../common/pagination/pagination';
import {
  organizationAdminSelect,
  userAdminSelect,
  auditLogSelect,
} from '../../common/prisma/selects';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Platform-wide dashboard statistics for SuperAdmin.
   */
  async getDashboard() {
    const [totalOrgs, activeOrgs, suspendedOrgs, totalUsers, totalForms, totalSubmissions] =
      await Promise.all([
        this.prisma.reader.organization.count(),
        this.prisma.reader.organization.count({ where: { isActive: true, deletedAt: null } }),
        this.prisma.reader.organization.count({ where: { suspendedAt: { not: null } } }),
        this.prisma.reader.user.count({ where: { deletedAt: null } }),
        this.prisma.reader.form.count(),
        this.prisma.reader.formSubmission.count(),
      ]);

    // Recent activity
    const recentOrgs = await this.prisma.reader.organization.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        name: true,
        slug: true,
        isActive: true,
        createdAt: true,
        _count: { select: { members: true, forms: true } },
      },
    });

    return {
      stats: {
        totalOrgs,
        activeOrgs,
        suspendedOrgs,
        totalUsers,
        totalForms,
        totalSubmissions,
      },
      recentOrgs,
    };
  }

  /**
   * List all organizations with pagination and search.
   */
  async listOrganizations(pagination: Pagination = parsePagination(), search?: string) {
    const where: any = { deletedAt: null };

    const term = search?.trim();
    if (term) {
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { slug: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [organizations, total] = await Promise.all([
      this.prisma.reader.organization.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        // `include` returned every column, including the MinIO/S3 bucket names
        // and the raw `settings` JSON — internal configuration with no place in
        // a list response.
        select: organizationAdminSelect,
      }),
      this.prisma.reader.organization.count({ where }),
    ]);

    return paginated('organizations', organizations, pagination, total);
  }

  /**
   * Get detailed org info for admin inspection.
   */
  async getOrganizationDetail(orgId: string) {
    const org = await this.prisma.reader.organization.findUnique({
      where: { id: orgId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                systemRole: true,
              },
            },
          },
        },
        _count: {
          select: { forms: true, invitations: true },
        },
      },
    });

    if (!org) throw new NotFoundException('Organization not found.');
    return org;
  }

  /**
   * Suspend an organization.
   */
  async suspendOrganization(orgId: string, reason: string) {
    const org = await this.prisma.reader.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) throw new NotFoundException('Organization not found.');

    return this.prisma.writer.organization.update({
      where: { id: orgId },
      data: {
        isActive: false,
        suspendedAt: new Date(),
        suspendReason: reason,
      },
    });
  }

  /**
   * Reactivate a suspended organization.
   */
  async activateOrganization(orgId: string) {
    return this.prisma.writer.organization.update({
      where: { id: orgId },
      data: {
        isActive: true,
        suspendedAt: null,
        suspendReason: null,
      },
    });
  }

  /**
   * Update organization quotas (SuperAdmin privilege).
   */
  async updateOrgQuotas(orgId: string, quotas: {
    maxForms?: number;
    maxSubmissionsMonth?: number;
    maxMembers?: number;
    storageQuotaBytes?: bigint;
  }) {
    return this.prisma.writer.organization.update({
      where: { id: orgId },
      data: quotas,
    });
  }

  /**
   * List all users with pagination and search.
   */
  async listUsers(pagination: Pagination = parsePagination(), search?: string) {
    const where: any = { deletedAt: null };

    const term = search?.trim();
    if (term) {
      where.OR = [
        { email: { contains: term, mode: 'insensitive' } },
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.reader.user.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: userAdminSelect,
      }),
      this.prisma.reader.user.count({ where }),
    ]);

    return paginated('users', users, pagination, total);
  }

  /**
   * Get audit logs with pagination and optional org filter.
   */
  async getAuditLogs(
    pagination: Pagination = parsePagination(),
    orgId?: string,
    action?: string,
  ) {
    const where: any = {};
    if (orgId) where.organizationId = orgId;
    if (action) where.action = action;

    const [logs, total] = await Promise.all([
      this.prisma.reader.auditLog.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: auditLogSelect,
      }),
      this.prisma.reader.auditLog.count({ where }),
    ]);

    return paginated('logs', logs, pagination, total);
  }
}
