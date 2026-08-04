import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

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
  async listOrganizations(page = 1, limit = 20, search?: string) {
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [organizations, total] = await Promise.all([
      this.prisma.reader.organization.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { members: true, forms: true },
          },
        },
      }),
      this.prisma.reader.organization.count({ where }),
    ]);

    return {
      organizations,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
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
  async listUsers(page = 1, limit = 20, search?: string) {
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.reader.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          systemRole: true,
          emailVerified: true,
          createdAt: true,
          memberships: {
            select: {
              role: true,
              organization: {
                select: { id: true, name: true, slug: true },
              },
            },
            take: 1,
          },
        },
      }),
      this.prisma.reader.user.count({ where }),
    ]);

    return {
      users,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Get audit logs with pagination and optional org filter.
   */
  async getAuditLogs(page = 1, limit = 50, orgId?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (orgId) where.organizationId = orgId;

    const [logs, total] = await Promise.all([
      this.prisma.reader.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          organization: {
            select: { id: true, name: true, slug: true },
          },
        },
      }),
      this.prisma.reader.auditLog.count({ where }),
    ]);

    return {
      logs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
