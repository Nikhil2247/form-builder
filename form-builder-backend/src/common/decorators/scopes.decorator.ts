import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key used by ApiKeyGuard / ApiKeyOrJwtGuard to read required scopes.
 */
export const SCOPES_KEY = 'requiredScopes';

/**
 * @RequiredScope decorator — declares the API-key scopes a route demands, and
 * by doing so OPTS THE ROUTE IN to API-key authentication at all.
 *
 * Usage:
 *   @Get(':formId')
 *   @RequiredScope('forms:read')
 *   getFormById(...) { ... }
 *
 *   // Several scopes = all of them are required (AND, not OR).
 *   @RequiredScope('submissions:read', 'submissions:export')
 *
 * TWO JOBS, ONE DECORATOR — and that is deliberate. The guard refuses an API
 * key on any handler that carries no @RequiredScope, so "which routes accept a
 * key" and "what that key must be allowed to do" can never drift apart. The
 * failure mode being designed out is the ordinary one: someone adds a new
 * machine-readable endpoint, the auth guard is inherited from the controller
 * and silently accepts keys, and nobody notices that the endpoint is reachable
 * by every key in the org regardless of what it was scoped to.
 *
 * Deliberately handler-scoped — the guards read this off the handler ONLY,
 * never the class, exactly as JwtAuthGuard reads @Public(). Applying it to a
 * whole controller therefore does nothing, rather than quietly opening every
 * route on that controller (including its mutations) to API keys.
 *
 * Must be used with ApiKeyGuard or ApiKeyOrJwtGuard. On a route guarded only by
 * JwtAuthGuard it is inert metadata.
 */
export const RequiredScope = (...scopes: string[]) =>
  SetMetadata(SCOPES_KEY, scopes);
