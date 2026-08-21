import {
  PATH_METADATA,
  METHOD_METADATA,
  GUARDS_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SCOPES_KEY } from '../decorators/scopes.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyOrJwtGuard } from './api-key-or-jwt.guard';
import { OrgMemberGuard } from './org-member.guard';
import { SuperAdminGuard } from './super-admin.guard';
import { API_KEY_SCOPES } from './api-key-policy';

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
import { ChoiceListsController } from '../../modules/choice-lists/choice-lists.controller';
import { PlatformChoiceListsController } from '../../modules/choice-lists/platform-choice-lists.controller';
import { PublicChoiceItemsController } from '../../modules/choice-lists/public-choice-items.controller';
import { ExportsController } from '../../modules/exports/exports.controller';
import { FormAppStepsController } from '../../modules/form-apps/form-app-steps.controller';
import { PublicAppsController } from '../../modules/form-apps/public-apps.controller';
import { SubjectEntriesController } from '../../modules/form-apps/subject-entries.controller';
import { NotificationsController } from '../../modules/notifications/notifications.controller';
import { MetricsController } from '../metrics/metrics.controller';
import { ApiKeysController } from '../../modules/api-keys/api-keys.controller';
import { AssistantController } from '../../modules/assistant/assistant.controller';
import { PlatformAssistantController } from '../../modules/assistant/platform-assistant.controller';

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
  ApiKeysController,
  // Added after an audit found this list had drifted to 16 of 24 controllers.
  // Three of the eight missing ones were org-scoped — ChoiceLists, Exports and
  // FormAppSteps — so "every :orgId route proves membership" was being asserted
  // over a subset while reading like it covered everything. A route-table test
  // with a hand-maintained input list is only as good as the list; see the
  // completeness check at the bottom of this file, which now fails the build if
  // it drifts again.
  ChoiceListsController,
  PlatformChoiceListsController,
  PublicChoiceItemsController,
  ExportsController,
  FormAppStepsController,
  PublicAppsController,
  SubjectEntriesController,
  NotificationsController,
  MetricsController,
  AssistantController,
  PlatformAssistantController,
];

/**
 * Guards that establish an identity on `request.user`.
 *
 * `ApiKeyOrJwtGuard` extends `JwtAuthGuard` but is recorded under its own class
 * name in the metadata, so a name check has to know about both. It authenticates
 * strictly more callers than JwtAuthGuard does, never fewer: a request with no
 * `X-API-Key` header goes straight down the bearer-token path, and one with a
 * key is refused outright unless the handler carries @RequiredScope.
 */
const AUTH_GUARD_NAMES = [JwtAuthGuard.name, ApiKeyOrJwtGuard.name];

/** Guards that will accept an `X-API-Key` on a route that opted in. */
const API_KEY_GUARD_NAMES = [ApiKeyGuard.name, ApiKeyOrJwtGuard.name];

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
  /**
   * Scopes from @RequiredScope, or null when the handler carries none.
   *
   * Read off the handler ONLY, exactly as the guards read it — reading the
   * class as well here would report a controller-wide decorator as active on
   * every route when the guards deliberately ignore it.
   */
  requiredScopes: string[] | null;
}

function guardNames(target: object): string[] {
  const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, target) ?? [];
  // Guards may be registered as classes or as pre-built instances.
  return guards.map((g: any) =>
    typeof g === 'function' ? g.name : (g?.constructor?.name ?? 'unknown'),
  );
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
    const controllerPath: string =
      Reflect.getMetadata(PATH_METADATA, controller) ?? '';
    const classGuards = guardNames(controller);
    const prototype = controller.prototype;

    for (const propertyName of Object.getOwnPropertyNames(prototype)) {
      if (propertyName === 'constructor') continue;

      const descriptor = Object.getOwnPropertyDescriptor(
        prototype,
        propertyName,
      );
      if (!descriptor || typeof descriptor.value !== 'function') continue;

      const handler = descriptor.value;
      const httpMethod = Reflect.getMetadata(METHOD_METADATA, handler);
      // Not a route handler — just a helper method on the controller.
      if (httpMethod === undefined) continue;

      const handlerPath: string =
        Reflect.getMetadata(PATH_METADATA, handler) ?? '';

      routes.push({
        controller: controller.name,
        handler: propertyName,
        fullPath: joinPath(controllerPath, handlerPath),
        method: RequestMethod[httpMethod] ?? String(httpMethod),
        // Method-level guards compose with class-level ones; Nest runs both.
        guards: [...classGuards, ...guardNames(handler)],
        isPublic: Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true,
        requiredScopes: Reflect.getMetadata(SCOPES_KEY, handler) ?? null,
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
          route.guards.includes(OrgMemberGuard.name) ||
          route.guards.includes(SuperAdminGuard.name);

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
        // that ordering is fragile. Require an auth guard explicitly.
        expect(route.guards.some((g) => AUTH_GUARD_NAMES.includes(g))).toBe(
          true,
        );
      },
    );
  });

  it('lists the routes deliberately left public', () => {
    // Locks in the public surface. Adding a route to a public controller now
    // fails here until it is consciously added to this list — the point is
    // that "this endpoint is unauthenticated" becomes a reviewed decision.
    const publicRoutes = ROUTES.filter(
      (r) => r.guards.length === 0 || r.isPublic,
    )
      .map((r) => `${r.method} ${r.fullPath}`)
      .sort();

    expect(publicRoutes).toEqual(
      [
        'GET /',
        // Kubernetes probes. Unauthenticated by necessity — the kubelet has no
        // credentials and a probe that could 401 would restart-loop the pod.
        // Reviewed and accepted on the basis that they expose only up/down per
        // dependency and no counts, versions, connection strings or error text;
        // if that ever changes, they need a network policy rather than a guard.
        'GET /health',
        'GET /health/live',
        'GET /health/ready',
        // Prometheus scrape endpoint. Unauthenticated because that is what every
        // service monitor expects, and because it carries no tenant data: the
        // labels are route PATTERNS, queue names, status codes and process role —
        // never an org id, form id or slug (see the cardinality note in
        // common/metrics/, which collapses unmatched routes to a literal).
        //
        // It does expose operational shape — request rates, error counts, queue
        // depth. That is worth withholding from the internet, but the control for
        // that is a NetworkPolicy or an ingress rule restricting /metrics to the
        // scrape range, not an auth guard the scraper would have to carry a
        // credential for.
        'GET /metrics',
        // SSE notification stream. Guard-less by necessity and NOT unauthenticated:
        // EventSource cannot set an Authorization header, so this route is
        // protected by a single-use connection ticket instead — minted by the
        // ordinary bearer-authenticated POST /notifications/stream-ticket, stored
        // as a hash in Redis for 30 seconds, and consumed atomically (GET+DEL in
        // one Lua script) so two racing connections cannot both spend it.
        //
        // It appears in this list because the check reads guard metadata, and the
        // ticket is verified inside the handler's own guard rather than by
        // JwtAuthGuard. Reviewed on that basis: the credential is short-lived,
        // single-use, single-user, and read-only over that user's own feed.
        'GET /notifications/stream',
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
        // Option lists for a published form's dropdowns. Public for the same
        // reason the form itself is: an anonymous respondent has to be able to
        // open the state/district cascade. Scoped by the form's slug, so it can
        // only ever return lists that published form actually references.
        'GET /public-forms/:slug/choice-items',
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
      ].sort(),
    );
  });
});

/**
 * The API-key surface, asserted the same way as the public surface above:
 * as a property of the route table, so that widening it is a reviewed decision
 * rather than a decorator somebody added while doing something else.
 */
describe('tenant isolation — API key surface', () => {
  const SCOPED = ROUTES.filter((r) => r.requiredScopes !== null);

  it('lists every route that accepts an API key', () => {
    // Locks the machine-to-machine surface. An API key is a long-lived,
    // copy-pasteable credential that lives in someone else's CI; which routes
    // it can reach is the whole risk, and it must not grow silently.
    //
    // WHEN THE SUBMISSIONS WIRING IS APPLIED (see WIRING-apikeys.md), add:
    //   'GET /organizations/:orgId/submissions',
    const scopedRoutes = SCOPED.map((r) => `${r.method} ${r.fullPath}`).sort();

    expect(scopedRoutes).toEqual(
      [
        'GET /organizations/:orgId/forms/:formId',
        'GET /organizations/:orgId/forms/:formId/export',
        'GET /organizations/:orgId/forms/:formId/submissions',
        'GET /organizations/:orgId/submissions',
      ].sort(),
    );
  });

  it.each(SCOPED.map((r) => [`${r.method} ${r.fullPath}`, r] as const))(
    '%s is behind a guard that actually reads the scope',
    (_label, route) => {
      // @RequiredScope on a route guarded only by JwtAuthGuard is inert
      // metadata that reads, in review, like a security control. This is the
      // check that stops it looking enforced when it is not.
      expect(route.guards.some((g) => API_KEY_GUARD_NAMES.includes(g))).toBe(
        true,
      );
    },
  );

  it.each(SCOPED.map((r) => [`${r.method} ${r.fullPath}`, r] as const))(
    '%s is organization-scoped and read-only',
    (_label, route) => {
      // The guard denies a key on any route with no :orgId — there is no
      // tenancy to check — but a route reaching that state at runtime is a
      // mistake worth catching here instead.
      expect(route.fullPath).toContain(':orgId');
      // Keys are read credentials. A mutation reachable with one turns a leaked
      // key from a disclosure into a write primitive.
      expect(route.method).toBe('GET');
    },
  );

  it.each(SCOPED.map((r) => [`${r.method} ${r.fullPath}`, r] as const))(
    '%s names only scopes the vocabulary defines',
    (_label, route) => {
      expect(route.requiredScopes!.length).toBeGreaterThan(0);
      for (const scope of route.requiredScopes!) {
        // A typo'd scope is a route no key can ever reach, which presents as
        // "the key does not work" and sends the reader to the key, not the
        // route.
        expect(API_KEY_SCOPES).toContain(scope as any);
      }
    },
  );

  it('does not let an API key manage API keys', () => {
    // A key that can mint keys survives its own revocation. Managing keys is a
    // human-session-only operation; see the ApiKeysController docblock.
    const keyRoutes = ROUTES.filter(
      (r) => r.controller === ApiKeysController.name,
    );

    expect(keyRoutes.length).toBeGreaterThan(0);
    for (const route of keyRoutes) {
      expect(route.requiredScopes).toBeNull();
      expect(route.guards).not.toContain(ApiKeyOrJwtGuard.name);
      expect(route.guards).toContain(JwtAuthGuard.name);
      expect(route.guards).toContain(OrgMemberGuard.name);
    }
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

describe('tenant isolation — the controller list is complete', () => {
  /**
   * ALL_CONTROLLERS is hand-maintained, and every assertion above is scoped to
   * it. That makes omission the quiet failure mode for this entire file: a new
   * org-scoped controller lands, nobody adds it here, and the suite keeps
   * passing while asserting nothing about it. That is exactly what happened —
   * the list had drifted to 16 of 24 controllers, three of them org-scoped.
   *
   * So the list is checked against the filesystem. Reading source files from a
   * test is unusual and deliberate: the alternative is importing every
   * controller to enumerate them, which is what the list already does, so it
   * could only ever agree with itself.
   */
  const CONTROLLER_DIR = join(__dirname, '..', '..');

  function findControllerFiles(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        found.push(...findControllerFiles(full));
      } else if (entry.name.endsWith('.controller.ts')) {
        found.push(full);
      }
    }
    return found;
  }

  /** `export class FooController` → `FooController`. */
  function exportedControllerNames(file: string): string[] {
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(/export\s+class\s+(\w*Controller)\b/g)].map(
      (m) => m[1],
    );
  }

  it('names every @Controller class in the codebase', () => {
    const onDisk = findControllerFiles(CONTROLLER_DIR)
      .flatMap(exportedControllerNames)
      .sort();

    // Sanity: if the scan finds nothing the assertion below passes vacuously.
    expect(onDisk.length).toBeGreaterThan(15);

    const covered = new Set(ALL_CONTROLLERS.map((c) => c.name));
    const missing = onDisk.filter((name) => !covered.has(name));

    // If this fails: add the controller to ALL_CONTROLLERS. Every guard
    // assertion in this file then applies to it, and one of them may well fail
    // — which is the point.
    expect(missing).toEqual([]);
  });
});
