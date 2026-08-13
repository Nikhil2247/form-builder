import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { FormAppsService } from './form-apps.service';
import {
  FormAppSessionsService,
  type SessionActor,
} from './form-app-sessions.service';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';

/**
 * The public face of a form app: /a/{publicSlug}.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Addressed by `publicSlug`, which is NULL until an author deliberately
 * publishes a link. An app is therefore unreachable from the internet by
 * default, and retiring a link is clearing that column rather than deleting the
 * app and its history.
 *
 * ── Authentication is optional here, and that is deliberate ────────────────
 * `OptionalJwtAuthGuard` attaches the user when a token is present and lets the
 * request through when it is not. Whether anonymous access is actually allowed
 * is the APP's decision (`requireAuth`, default true), enforced in the session
 * service — not the router's. Putting it here would make every app either
 * public or private at the routing layer, which is not what an organization
 * running both an open survey and an internal registry needs.
 */
@Controller('public-apps')
@UseGuards(OptionalJwtAuthGuard)
export class PublicAppsController {
  constructor(
    private readonly apps: FormAppsService,
    private readonly sessions: FormAppSessionsService,
  ) {}

  /**
   * Identify the respondent.
   *
   * A signed-in user is identified by their id. An anonymous one is identified
   * by a fingerprint they generate and store locally — the same mechanism the
   * public form drafts use. It is not a security control: it decides which
   * DRAFT is resumed, and every session lookup binds to it so one respondent
   * cannot read another's half-written report by guessing an id.
   */
  private actor(req: Request, fingerprint?: string): SessionActor {
    // The assertion is NOT redundant, despite what
    // @typescript-eslint/no-unnecessary-type-assertion concluded when it
    // auto-removed it and broke the build: passport augments Express's
    // `Request.user` with its own `User` interface, which is empty, so `.sub`
    // does not exist on it. Removing this compiles to `req.user?.sub` and fails
    // typecheck with TS2339.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const userId = (req.user as { sub?: string } | undefined)?.sub;
    return {
      userId,
      fingerprint:
        typeof fingerprint === 'string' ? fingerprint.slice(0, 64) : undefined,
    };
  }

  @Get(':publicSlug')
  // Short cache with SWR: the app's shape changes rarely, and the session
  // itself is never cached — it is per respondent and fetched separately.
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=600')
  getApp(@Param('publicSlug') publicSlug: string) {
    return this.apps.getPublicApp(publicSlug);
  }

  /**
   * Open a new session, or resume the respondent's open draft.
   *
   * `subjectId` opens the session against a record that already exists — the
   * "add a visit" case. It is rejected for anonymous callers inside the session
   * service, because a follow-up session renders the record's identity and
   * prior answers as context and would otherwise turn a public link into a
   * record-enumeration oracle.
   */
  @Post(':publicSlug/sessions')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async openSession(
    @Param('publicSlug') publicSlug: string,
    @Body()
    body: {
      fingerprint?: string;
      subjectId?: string;
      stepKeys?: string[];
      /**
       * File into a specific open window. The late-entry case: a visit made on
       * the 28th, typed on the 3rd, belongs to the month it happened. Validated
       * against the windows the app is actually offering — an arbitrary id is
       * refused rather than accepted into a closed cycle.
       */
      periodId?: string;
    },
    @Req() req: Request,
  ) {
    const app = await this.apps.getPublicApp(publicSlug);
    return this.sessions.openSession(
      app.id,
      this.actor(req, body?.fingerprint),
      {
        subjectId: body?.subjectId,
        stepKeys: Array.isArray(body?.stepKeys) ? body.stepKeys : undefined,
        periodId: body?.periodId,
      },
    );
  }

  @Get(':publicSlug/sessions/:sessionId')
  async getSession(
    @Param('publicSlug') publicSlug: string,
    @Param('sessionId') sessionId: string,
    @Query('fp') fingerprint: string,
    @Req() req: Request,
  ) {
    const app = await this.apps.getPublicApp(publicSlug);
    return this.sessions.getSession(
      app.id,
      sessionId,
      this.actor(req, fingerprint),
    );
  }

  /** Stage one entry. Called on autosave, so it stays cheap and idempotent. */
  @Put(':publicSlug/sessions/:sessionId/entries/:stepKey/:index')
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  async saveEntry(
    @Param('publicSlug') publicSlug: string,
    @Param('sessionId') sessionId: string,
    @Param('stepKey') stepKey: string,
    @Param('index') index: string,
    @Body() body: { answers: Record<string, unknown>; fingerprint?: string },
    @Req() req: Request,
  ) {
    const app = await this.apps.getPublicApp(publicSlug);
    return this.sessions.saveEntry(
      app.id,
      sessionId,
      stepKey,
      Number(index),
      body?.answers ?? {},
      this.actor(req, body?.fingerprint),
    );
  }

  @Delete(':publicSlug/sessions/:sessionId/entries/:stepKey/:index')
  async deleteEntry(
    @Param('publicSlug') publicSlug: string,
    @Param('sessionId') sessionId: string,
    @Param('stepKey') stepKey: string,
    @Param('index') index: string,
    @Query('fp') fingerprint: string,
    @Req() req: Request,
  ) {
    const app = await this.apps.getPublicApp(publicSlug);
    return this.sessions.deleteEntry(
      app.id,
      sessionId,
      stepKey,
      Number(index),
      this.actor(req, fingerprint),
    );
  }

  /** "Reset" — discard everything staged, keep the session open. */
  @Post(':publicSlug/sessions/:sessionId/reset')
  @HttpCode(HttpStatus.OK)
  async reset(
    @Param('publicSlug') publicSlug: string,
    @Param('sessionId') sessionId: string,
    @Body() body: { fingerprint?: string },
    @Req() req: Request,
  ) {
    const app = await this.apps.getPublicApp(publicSlug);
    return this.sessions.resetSession(
      app.id,
      sessionId,
      this.actor(req, body?.fingerprint),
    );
  }

  /** "Submit All Reports" — one transaction, all or nothing. */
  @Post(':publicSlug/sessions/:sessionId/submit')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async submit(
    @Param('publicSlug') publicSlug: string,
    @Param('sessionId') sessionId: string,
    @Body() body: { fingerprint?: string },
    @Req() req: Request,
  ) {
    const app = await this.apps.getPublicApp(publicSlug);
    if (!app) throw new NotFoundException('App not found.');

    return this.sessions.submitSession(
      app.id,
      sessionId,
      this.actor(req, body?.fingerprint),
      {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      },
    );
  }
}
