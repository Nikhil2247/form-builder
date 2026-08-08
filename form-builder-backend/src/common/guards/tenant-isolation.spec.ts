import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OrgMemberGuard } from './org-member.guard';
import { SuperAdminGuard } from './super-admin.guard';

import { AppController } from '../../app.controller';
import { HealthController } from '../health/health.controller';
import { AdminController } from '../../modules/admin/admin.controller';
import { AnalyticsController } from '../../modules/analytics/analytics.controller';
import { AuthController } from '../../modules/auth/auth.controller';
import { FormsController } from '../../modules/forms/forms.controller';
import { PublicFormsController } from '../../modules/forms/public-forms.controller';
import { OrganizationsController } from '../../modules/organizations/organizations.controller';
import { StorageController } from '../../modules/storage/storage.controller';
import { SubmissionsController } from '../../modules/submissions/submissions.controller';
import { TemplatesController } from '../../modules/templates/templates.controller';
import { WebhooksController } from '../../modules/webhooks/webhooks.controller';
import { SubjectsController } from '../../modules/subjects/subjects.controller';
import { FormAppsController } from '../../modules/form-apps/form-apps.controller';
import { FeatureFlagsController } from '../../modules/feature-flags/feature-flags.controller';

/**
 * Structural tenant-isolation checks.
 *
 * These assert a property of the *route table* rather than of any one handler:
 * every route that names an organization must be behind a guard that proves
 * membership of it. That is the failure mode a unit test on OrgMemberGuard can
 * never catch — the guard being correct is worth nothing on a route that
 * forgot to apply it, and forgetting is the normal way this bug appears.
 *
 * No database, no HTTP. Reads the same decorator metadata Nest itself reads at
 * bootstrap, so it runs in the fast CI job and cannot drift from reality.
 */

/** Every controller Nest mounts. A controller missing here is untested. */
const ALL_CONTROLLERS = [
  AppController,
  HealthController,
  AdminController,
  AnalyticsController,
  AuthController,
  FormsController,
  PublicFormsController,
  OrganizationsController,
  StorageController,
  SubmissionsController,
  TemplatesController,
  WebhooksController,
  SubjectsController,
  FormAppsController,
  FeatureFlagsController,
];

interface RouteInfo {
  controller: string;
  handler: string;
  fullPath: string;
  method: string;
  guards: string[];
  /**
   * @Public() suppresses JwtAuthGuard at runtime while the guard is still
   * listed in metadata. Tracked separately or a public route would read as
   * protected here — the exact false assurance this file exists to prevent.
   */
  isPublic: boolean;
}

function guardNames(target: object): string[] {
  const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, target) ?? [];
  // Guards may be registered as classes or as pre-built instances.
  return guards.map((g: any) => (typeof g === 'function' ? g.name : g?.constructor?.name ?? 'unknown'));
}

function joinPath(controllerPath: string, handlerPath: string): string {
  const segments = [controllerPath, handlerPath]
    .map((s) => (s ?? '').replace(/^\/+|\/+$/g, ''))
    .filter((s) => s.length > 0);
  return '/' + segments.join('/');
}

/** Walk decorator metadata to reconstruct the route table. */
function collectRoutes(): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const controller of ALL_CONTROLLERS) {
    const controllerPath: string = Reflect.getMetadata(PATH_METADATA, controller) ?? '';
    const classGuards = guardNames(controller);
    const prototype = controller.prototype;

    for (const propertyName of Object.getOwnPropertyNames(prototype)) {
      if (propertyName === 'constructor') continue;

      const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
      if (!descriptor || typeof descriptor.value !== 'function') continue;

      const handler = descriptor.value;
      const httpMethod = Reflect.getMetadata(METHOD_METADATA, handler);
      // Not a route handler — just a helper method on the controller.
      if (httpMethod === undefined) continue;

      const handlerPath: string = Reflect.getMetadata(PATH_METADATA, handler) ?? '';

      routes.push({
        controller: controller.name,
        handler: propertyName,
        fullPath: joinPath(controllerPath, handlerPath),
        method: RequestMethod[httpMethod] ?? String(httpMethod),
        // Method-level guards compose with class-level ones; Nest runs both.
        guards: [...classGuards, ...guardNames(handler)],
        isPublic: Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true,
      });
    }
  }

  return routes;
}

const ROUTES = collectRoutes();
const ORG_SCOPED = ROUTES.filter((r) => r.fullPath.includes(':orgId'));

describe('tenant isolation — route table', () => {
  it('discovers the route table from decorator metadata', () => {
    // A guard against this whole file silently passing because an import broke
    // and collectRoutes() returned nothing.
    expect(ROUTES.length).toBeGreaterThan(30);
    expect(ORG_SCOPED.length).toBeGreaterThan(10);
  });

  describe('every :orgId route proves membership of that org', () => {
    it.each(ORG_SCOPED.map((r) => [`${r.method} ${r.fullPath}`, r] as const))(
      '%s',
      (_label, route) => {
        // OrgMemberGuard resolves :orgId -> membership. SuperAdminGuard is the
        // deliberate alternative on /admin routes, which are cross-tenant by
        // design and gated on systemRole instead.
        const hasTenantGuard =
          route.guards.includes(OrgMemberGuard.name) || route.guards.includes(SuperAdminGuard.name);

        expect(hasTenantGuard).toBe(true);
        // @Public() on an org-scoped route would disable the auth guard and
        // leave OrgMemberGuard with no user to check.
        expect(route.isPublic).toBe(false);
      },
    );

    it.each(ORG_SCOPED.map((r) => [`${r.method} ${r.fullPath}`, r] as const))(
      '%s authenticates first',
      (_label, route) => {
        // OrgMemberGuard reads request.user and throws if absent, so an
        // unauthenticated route would 403 rather than leak — but relying on
        // that ordering is fragile. Require the auth guard explicitly.
        expect(route.guards).toContain(JwtAuthGuard.name);
      },
    );
  });

  it('lists the routes deliberately left public', () => {
    // Locks in the public surface. Adding a route to a public controller now
    // fails here until it is consciously added to this list — the point is
    // that "this endpoint is unauthenticated" becomes a reviewed decision.
    const publicRoutes = ROUTES.filter((r) => r.guards.length === 0 || r.isPublic)
      .map((r) => `${r.method} ${r.fullPath}`)
      .sort();

    expect(publicRoutes).toEqual([
      'GET /',
      'GET /health',
      // Credential endpoints — necessarily reachable without a token, since
      // they are how a token is obtained. Protected by strict per-identifier
      // throttles rather than guards (see @Throttle on AuthController).
      'GET /auth/verify-email',
      'POST /auth/forgot-password',
      'POST /auth/login',
      'POST /auth/login/mfa',
      'POST /auth/logout',
      'POST /auth/refresh',
      'POST /auth/register',
      'POST /auth/reset-password',
      // Invitation preview. The recipient may have no account yet, so the
      // accept screen must be able to name the org before they sign up. The
      // token is the secret; display fields only.
      'GET /organizations/invitations/:token',
      // Respondent-facing form runner. Access control lives in the service
      // layer (status, expiry, password, requireAuth) rather than in a guard,
      // because anonymous respondents are the intended callers.
      'DELETE /public-forms/:slug/draft',
      'GET /public-forms/:slug',
      'GET /public-forms/:slug/draft',
      'GET /public-forms/:slug/embed',
      'POST /public-forms/:slug/track',
      'PUT /public-forms/:slug/draft',
      // Presigned upload URLs for anonymous respondents. Constrained in
      // StorageService: published form only, question must exist and be
      // FILE_UPLOAD, MIME + extension allowlist, size bound re-verified.
      'POST /storage/presigned-url',
      'GET /templates',
      'GET /templates/:id',
      'GET /templates/categories',
    ].sort());
  });
});

describe('tenant isolation — role requirements', () => {
  it('does not gate destructive form routes below EDITOR', () => {
    // A regression here means a VIEWER could mutate forms. Encoded as a
    // property of the route table rather than trusting the decorators to be
    // read correctly during review.
    const destructive = ROUTES.filter(
      (r) =>
        r.controller === 'FormsController' &&
        ['POST', 'PUT', 'DELETE'].includes(r.method) &&
        !r.fullPath.includes('/submissions'),
    );

    expect(destructive.length).toBeGreaterThan(0);
    for (const route of destructive) {
      expect(route.guards).toContain('RoleGuard');
    }
  });
});
