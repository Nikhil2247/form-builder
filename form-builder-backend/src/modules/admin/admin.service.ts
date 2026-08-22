import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../common/infra/prisma/prisma.service';
import {
  parsePagination,
  paginated,
  type Pagination,
} from '../../common/http/pagination/pagination';
import {
  organizationAdminSelect,
  userAdminSelect,
  auditLogSelect,
  memberSelect,
} from '../../common/infra/prisma/selects';
import { SessionCacheService } from '../../common/infra/session/session-cache.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionCacheService,
  ) {}

  /**
   * Platform-wide dashboard statistics for SuperAdmin.
   */
  async getDashboard() {
    const [
      totalOrgs,
      activeOrgs,
      suspendedOrgs,
      totalUsers,
      totalForms,
      totalSubmissions,
    ] = await Promise.all([
      this.prisma.reader.organization.count(),
      this.prisma.reader.organization.count({
        where: { isActive: true, deletedAt: null },
      }),
      this.prisma.reader.organization.count({
        where: { suspendedAt: { not: null } },
      }),
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
  async listOrganizations(
    pagination: Pagination = parsePagination(),
    search?: string,
  ) {
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

  /** Same scheme the signup flow uses, so a platform-created org's slug looks
   *  no different from one a user made for themselves. */
  private generateSlug(name: string): string {
    const baseSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 100);
    const suffix = crypto.randomBytes(3).toString('hex');
    return `${baseSlug}-${suffix}`;
  }

  /**
   * Create a new organization from the platform admin console.
   *
   * No members are attached — a super admin creating a shell workspace is not
   * implicitly joining it (same rule PlatformRoleCard documents on the
   * frontend). Whoever should run it gets invited afterwards, the normal way.
   */
  async createOrganization(data: { name: string; slug?: string }) {
    const slug = data.slug?.trim() || this.generateSlug(data.name);

    if (data.slug) {
      const existing = await this.prisma.reader.organization.findUnique({
        where: { slug },
      });
      if (existing) throw new ConflictException('This slug is already taken.');
    }

    return this.prisma.writer.organization.create({
      data: { name: data.name, slug },
      select: organizationAdminSelect,
    });
  }

  /**
   * Edit an organization's identity fields. Quotas have their own endpoint
   * (updateOrgQuotas) — kept separate so a rename cannot accidentally carry a
   * quota change along with it.
   */
  async updateOrganization(
    orgId: string,
    data: { name?: string; slug?: string; logoUrl?: string },
  ) {
    const org = await this.prisma.reader.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Organization not found.');

    if (data.slug && data.slug !== org.slug) {
      const existing = await this.prisma.reader.organization.findUnique({
        where: { slug: data.slug },
      });
      if (existing) throw new ConflictException('This slug is already taken.');
    }

    return this.prisma.writer.organization.update({
      where: { id: orgId },
      data: {
        name: data.name,
        slug: data.slug,
        logoUrl: data.logoUrl,
      },
      select: organizationAdminSelect,
    });
  }

  /**
   * Soft-delete an organization from the platform console.
   *
   * Mirrors OrganizationsService.deleteOrganization (the self-service path an
   * org's own admin uses): `deletedAt` rather than a row delete, so forms,
   * submissions, and the audit trail survive. Every cached member session is
   * invalidated so the org closes immediately rather than at the end of a TTL.
   */
  async deleteOrganization(orgId: string) {
    const org = await this.prisma.reader.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Organization not found.');
    if (org.deletedAt) {
      throw new BadRequestException('This organization is already deleted.');
    }

    const deleted = await this.prisma.writer.organization.update({
      where: { id: orgId },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.sessions.invalidateOrganizationMembers(orgId);
    return deleted;
  }

  /**
   * Attach an existing user to an organization from the platform console.
   *
   * The one path that does not exist anywhere else: an org's own admin can
   * only add someone via an emailed invitation (OrganizationsService.
   * createInvitation), which has to wait for the recipient to click accept.
   * A platform admin bypasses that — the membership is created immediately,
   * matching every other action in this file (suspend, quota changes) that
   * takes effect the moment the operator confirms it rather than the moment
   * someone else responds.
   */
  async addOrganizationMember(
    orgId: string,
    email: string,
    role: 'ADMIN' | 'EDITOR' | 'VIEWER',
  ) {
    const org = await this.prisma.reader.organization.findUnique({
      where: { id: orgId },
    });
    if (!org || org.deletedAt) {
      throw new NotFoundException('Organization not found.');
    }

    const user = await this.prisma.reader.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user) {
      throw new NotFoundException(
        'No account exists with this email. Create the user first.',
      );
    }

    const existing = await this.prisma.reader.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId: user.id },
      },
    });
    if (existing) {
      throw new ConflictException(
        'This user is already a member of this organization.',
      );
    }

    const member = await this.prisma.writer.organizationMember.create({
      data: { organizationId: orgId, userId: user.id, role },
      select: memberSelect,
    });

    // The membership list is part of the cached session; without this the
    // user does not see the new workspace until the cache TTL expires.
    await this.sessions.invalidate(user.id);

    return member;
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

    const suspended = await this.prisma.writer.organization.update({
      where: { id: orgId },
      data: {
        isActive: false,
        suspendedAt: new Date(),
        suspendReason: reason,
      },
    });

    // Suspension is enforced from `organization.isActive` / `suspendedAt`, which
    // every member carries a copy of inside their cached session. An operator
    // who suspends a workspace expects it closed now, not at the end of a cache
    // TTL — this is the whole reason the invalidation list exists.
    await this.sessions.invalidateOrganizationMembers(orgId);

    return suspended;
  }

  /**
   * Reactivate a suspended organization.
   */
  async activateOrganization(orgId: string) {
    const activated = await this.prisma.writer.organization.update({
      where: { id: orgId },
      data: {
        isActive: true,
        suspendedAt: null,
        suspendReason: null,
      },
    });

    // The mirror image, and a usability failure rather than a security one:
    // without it the members of a just-restored org keep being told their
    // workspace is suspended, and the support ticket gets reopened.
    await this.sessions.invalidateOrganizationMembers(orgId);

    return activated;
  }

  /**
   * Update organization quotas (SuperAdmin privilege).
   */
  async updateOrgQuotas(
    orgId: string,
    quotas: {
      maxForms?: number;
      maxSubmissionsMonth?: number;
      maxMembers?: number;
      storageQuotaBytes?: bigint;
    },
  ) {
    return this.prisma.writer.organization.update({
      where: { id: orgId },
      data: quotas,
    });
  }

  /**
   * List all users with pagination and search.
   *
   * Unlike organizations, a user has no separate "suspended" flag — suspension
   * IS `deletedAt` (see AdminUsersService.setUserSuspended). Filtering it out
   * here would make a suspended account disappear from the one screen an
   * operator uses to reinstate it, so every account stays listed and the UI
   * marks suspended ones instead.
   */
  async listUsers(pagination: Pagination = parsePagination(), search?: string) {
    const where: any = {};

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
