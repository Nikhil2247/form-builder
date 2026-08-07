import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsDateString,
  IsIn,
  Min,
  Max,
  MinLength,
  MaxLength,
  IsObject,
  Matches,
  Allow,
} from 'class-validator';

/**
 * Body for POST /organizations/:orgId/forms.
 *
 * `pages`, `questions` and `logic` stay `@Allow()`-ed on purpose. The global
 * ValidationPipe runs with `whitelist` + `forbidNonWhitelisted`, which on a
 * nested DTO would silently strip — or hard-reject — any question property this
 * class did not enumerate. The builder's question shape is wide and grows, and
 * a 400 on autosave costs the author everything they typed since the last
 * successful save. They are instead validated and repaired by
 * `normalizeFormStructure`, which can drop a bad option without discarding the
 * form around it.
 */
export class CreateFormDto {
  @IsString() @MinLength(1) @MaxLength(255) title: string;

  @IsOptional() @IsString() @MaxLength(10_000) description?: string;

  /**
   * Public URL segment. Constrained here because it is unique platform-wide and
   * appears verbatim in a URL — `..`, spaces and uppercase all cause problems
   * further down that are much harder to diagnose than a 400 here.
   */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  @Matches(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, {
    message: 'slug must be lowercase letters, numbers and hyphens, and cannot start or end with a hyphen',
  })
  slug?: string;

  @IsOptional() @IsBoolean() isQuizMode?: boolean;
  @IsOptional() @IsBoolean() isPasswordProtected?: boolean;

  @IsOptional() @IsString() @MinLength(4) @MaxLength(200) password?: string;

  @IsOptional() @IsBoolean() requireAuth?: boolean;
  @IsOptional() @IsBoolean() allowMultiple?: boolean;

  /**
   * `@IsOptional()` skips validation for `null` as well as `undefined`, which
   * is what lets the builder send an explicit `null` to clear a cap. The
   * service distinguishes the two: absent means "leave alone", null means
   * "remove".
   */
  @IsOptional() @IsInt() @Min(1) @Max(10_000_000) maxSubmissions?: number | null;

  @IsOptional() @IsDateString() expiresAt?: string | null;

  @IsObject() themeConfig: Record<string, any>;

  @IsOptional() @Allow() notifyEmails?: string[];
  @IsOptional() @Allow() pages?: any;
  @IsOptional() @Allow() questions?: any;
  @IsOptional() @Allow() logic?: any;

  @IsOptional()
  @IsIn(['DOCUMENT', 'CONVERSATIONAL', 'GRID', 'PORTAL'])
  layoutMode?: string;
}
