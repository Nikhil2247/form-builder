import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Exempt a single route handler from JwtAuthGuard.
 *
 * For endpoints that must work before the caller has an account — accepting an
 * invitation, verifying an email — that live on a controller which is otherwise
 * authenticated.
 *
 * Deliberately handler-scoped: JwtAuthGuard reads this off the handler ONLY,
 * never the class. Applying it to a controller therefore does nothing rather
 * than silently unauthenticating every route on it, which is the failure mode
 * this pattern is usually responsible for.
 *
 * Making a route public removes authentication, not authorization — whatever
 * the handler does must be safe for an anonymous caller on its own terms
 * (a secret in the URL, a rate limit, or no sensitive data at all).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
