'use client';

/**
 * One vocabulary for turning a thrown value into something a user can read.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Five competing idioms had grown up across the app for the same job:
 *
 *   err?.message ?? 'Could not save'
 *   err instanceof Error ? err.message : 'Could not save'
 *   error instanceof ApiError ? error.message : 'Could not save'
 *   a local `errorMessage()` helper (duplicated in three files)
 *   a hardcoded string that discarded the server's message entirely
 *
 * They disagreed about which errors reach the user, and the last one silently
 * threw away the most useful information on the wire. The API is careful about
 * what it says — RoleGuard, quota checks, and the "you cannot demote the last
 * super admin" family all return a sentence written for a human — so the
 * default here is to SHOW WHAT THE API SAID and only substitute our own copy
 * when the server's message is absent or carries no information.
 *
 * ── Validation issues ──────────────────────────────────────────────────────
 * The backend attaches a field-level `issues` array to rejected submissions,
 * rejected app-session submits, and publishes blocked by rule errors. The
 * exception filter goes out of its way to preserve it and `ApiError` parses
 * it — and every toast in the app then dropped it, so the user was told "some
 * answers are invalid" and never which ones. `toastError` renders it.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { ApiError, type ValidationIssue } from './api';

/** Beyond this the toast becomes a wall of text; the rest are counted. */
const MAX_ISSUES_SHOWN = 4;

export interface ErrorDescription {
  /** The sentence to lead with — the server's, when it said something useful. */
  title: string;
  /** Extra context we can add that the server could not, e.g. a retry delay. */
  description?: string;
  /** Field-level failures, when the server sent them. */
  issues: ValidationIssue[];
  /** HTTP status, or null when the throw did not come from the API. */
  status: number | null;
  /**
   * Stable key for the same failure, so a page whose four queries all fail
   * against a down API shows one toast instead of four, and so a call site
   * that already toasts in its own `catch` collapses with the global handler
   * rather than double-reporting.
   */
  id: string;
}

/**
 * Server messages that are technically present but tell the user nothing.
 * When we see one of these we prefer our own copy for that status.
 */
const UNINFORMATIVE = new Set([
  'internal server error',
  'bad request',
  'unauthorized',
  'forbidden',
  'not found',
  'conflict',
  'unprocessable entity',
  'payload too large',
  'too many requests',
  'throttlerexception: too many requests',
  'request timeout',
  'service unavailable',
  'bad gateway',
  'gateway timeout',
]);

function isInformative(message: string | undefined | null): message is string {
  if (!message) return false;
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (UNINFORMATIVE.has(normalized)) return false;
  // Our own last-resort string from `fetchApi`, e.g. "Request failed (500)".
  if (/^request failed \(\d+\)$/.test(normalized)) return false;
  return true;
}

/** Canned copy for the cases where the server had nothing specific to add. */
function fallbackForStatus(status: number | null, fallback: string): string {
  switch (status) {
    case 0:
      return 'Could not reach the server. Check your connection and try again.';
    case 408:
      return 'That took too long and was cancelled. Please try again.';
    case 401:
      return 'Your session has expired. Please sign in again.';
    case 403:
      return 'You do not have permission to do that.';
    case 404:
      return 'That item no longer exists. It may have been deleted.';
    case 409:
      return 'That change conflicts with the current state. Reload and try again.';
    case 413:
      return 'That is too large to upload. Try a smaller file or split the import.';
    case 429:
      return 'Too many attempts. Please wait a moment and try again.';
    default:
      if (status !== null && status >= 500) {
        return 'Something went wrong on our end. Please try again in a moment.';
      }
      return fallback;
  }
}

/** Context we can add that the server cannot, keyed on status. */
function hintForStatus(status: number | null, retryAfterSeconds?: number): string | undefined {
  if (status === 429) {
    if (retryAfterSeconds && retryAfterSeconds > 0) {
      const minutes = Math.ceil(retryAfterSeconds / 60);
      return retryAfterSeconds < 60
        ? `You can try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.`
        : `You can try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
    }
    return 'You can try again shortly.';
  }
  if (status !== null && status >= 500) {
    return 'If it keeps happening, contact support with the time this occurred.';
  }
  return undefined;
}

/** Tiny non-cryptographic hash — only needs to be stable, not unguessable. */
function stableId(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return `err:${(hash >>> 0).toString(36)}`;
}

/**
 * Normalise any thrown value into displayable parts.
 *
 * `fallback` is the caller's description of what was being attempted — "Could
 * not save this form" — and is used only when nothing better is available.
 */
export function describeError(error: unknown, fallback = 'Something went wrong'): ErrorDescription {
  const status = error instanceof ApiError ? error.status : null;
  const retryAfterSeconds = error instanceof ApiError ? error.retryAfterSeconds : undefined;
  const issues = error instanceof ApiError && error.issues?.length ? error.issues : [];

  const serverMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;

  const title = isInformative(serverMessage)
    ? serverMessage
    : fallbackForStatus(status, fallback);

  return {
    title,
    description: hintForStatus(status, retryAfterSeconds),
    issues,
    status,
    id: stableId(`${status ?? 'x'}|${title}`),
  };
}

/** Just the sentence, for the places that only have room for one. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  return describeError(error, fallback).title;
}

/**
 * Renders the parts of an error that go under the headline: our own hint, then
 * the field-level issues the server sent.
 */
export function ErrorDetail({ description, issues }: Pick<ErrorDescription, 'description' | 'issues'>) {
  const shown = issues.slice(0, MAX_ISSUES_SHOWN);
  const hidden = issues.length - shown.length;

  if (!description && shown.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {description && <p>{description}</p>}
      {shown.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4">
          {shown.map((issue, index) => (
            <li key={`${issue.questionId}-${issue.code}-${index}`}>
              {issue.label ? <span className="font-medium">{issue.label}: </span> : null}
              {issue.message}
            </li>
          ))}
          {hidden > 0 && <li>and {hidden} more</li>}
        </ul>
      )}
    </div>
  );
}

/**
 * Report a failure to the user.
 *
 * Deduplicated by a stable id derived from status + message, which is what
 * makes the global handlers in `query-provider` safe to run alongside the call
 * sites that still catch and report themselves: both produce the same id, so
 * sonner replaces rather than stacks.
 */
export function toastError(error: unknown, fallback = 'Something went wrong') {
  const described = describeError(error, fallback);

  toast.error(described.title, {
    id: described.id,
    description: <ErrorDetail description={described.description} issues={described.issues} />,
  });

  return described;
}
