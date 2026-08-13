import {
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  ArrayNotEmpty,
  ArrayMaxSize,
  MaxLength,
  MinLength,
} from 'class-validator';
import { API_KEY_SCOPES } from '../../../common/guards/api-key-policy';

/**
 * Body for POST /organizations/:orgId/api-keys.
 *
 * The response to this route is the ONLY time the raw key exists outside the
 * caller's own storage — there is no "show key" route and no way to add one
 * without a schema change, because only the SHA-256 hash is persisted.
 */
export class CreateApiKeyDto {
  /**
   * The label shown in the key list. Capped at the column width (VarChar(100))
   * rather than truncated server-side, so a user who pastes something long is
   * told, instead of finding a silently clipped name later.
   */
  @IsString() @MinLength(1) @MaxLength(100) name: string;

  /**
   * Requested scopes. Validated against the vocabulary the ApiKey schema
   * documents — an unrecognised scope is rejected rather than stored, because a
   * stored scope that no guard will ever match is indistinguishable, from the
   * key list, from one that works.
   *
   * Omitted entirely means "use the column default", which the schema sets to
   * `forms:read,submissions:read` — read-only, the correct default for a
   * credential whose whole purpose is unattended access.
   */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(API_KEY_SCOPES.length)
  @IsIn(API_KEY_SCOPES, { each: true })
  scopes?: string[];

  /**
   * Optional expiry, ISO-8601. Null/absent means the key never expires.
   *
   * Range is checked in the service, not here: `@IsDateString` only says the
   * string parses, and the two answers worth rejecting — a date in the past
   * (a key that is dead on arrival) and a sentinel like 9999-12-31 (a
   * never-expires key wearing an expiry's clothes) — both parse fine.
   */
  @IsOptional() @IsDateString() expiresAt?: string | null;
}
