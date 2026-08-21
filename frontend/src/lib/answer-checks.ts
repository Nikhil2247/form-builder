/**
 * Client-side answer checks.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The runner used to check exactly one thing before submitting: whether a
 * required question was empty. Everything else the author configured —
 * `minLength`, `maxLength`, `min`, `max`, `pattern`, and the format implied by
 * EMAIL / URL / PHONE — was enforced only by the API, and arrived back as a
 * single unattributed error string after the respondent pressed Submit.
 *
 * This is NOT a second source of truth. `AnswerValidatorService` on the API is
 * the authority and rejects anything this misses; these checks exist so the
 * respondent finds out at the field instead of at the end. The messages are
 * phrased to match the server's so the same problem does not read two different
 * ways depending on which side caught it.
 *
 * Pure — no React, no imports beyond the question type.
 */

import type { FormQuestion } from '@/types/form';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const PHONE_RE = /^\+?[0-9\s\-().]{6,20}$/;

export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

/**
 * Author-supplied regex is untrusted and runs in the respondent's browser.
 * A catastrophic-backtracking pattern would hang their tab, so the same caps
 * the server applies are applied here, and a malformed pattern passes rather
 * than blocking a form nobody can fix from the outside.
 */
function safePatternTest(pattern: string, subject: string): boolean {
  if (pattern.length > 200 || subject.length > 2000) return true;
  try {
    return new RegExp(pattern).test(subject);
  } catch {
    return true;
  }
}

/**
 * The first problem with an answer, or null.
 *
 * @param required  Resolved requiredness — the question's own flag OR a REQUIRE
 *                  rule. Passed in rather than read off the question, because
 *                  a rule can make an optional question mandatory.
 */
export function checkAnswer(
  q: FormQuestion,
  value: unknown,
  required: boolean,
): string | null {
  const label = q.label || 'This question';
  const v = q.validation ?? {};

  if (isBlank(value)) {
    return required ? 'This question is required.' : null;
  }

  switch (q.type) {
    case 'SHORT_TEXT':
    case 'LONG_TEXT': {
      const text = String(value);
      if (v.maxLength != null && text.length > v.maxLength) {
        return `${label} must be at most ${v.maxLength} characters.`;
      }
      if (v.minLength != null && text.length < v.minLength) {
        return `${label} must be at least ${v.minLength} characters.`;
      }
      if (v.pattern && !safePatternTest(v.pattern, text)) {
        return `${label} is not in the expected format.`;
      }
      return null;
    }

    case 'EMAIL':
      return EMAIL_RE.test(String(value).trim())
        ? null
        : `${label} must be a valid email address.`;

    case 'URL':
      return URL_RE.test(String(value).trim())
        ? null
        : `${label} must be a valid http(s) URL.`;

    case 'PHONE': {
      const s = String(value).trim();
      // A custom pattern (e.g. "exactly 10 digits") overrides the generic
      // format — same precedence as the API's validator, so the two agree.
      const ok = v.pattern ? safePatternTest(v.pattern, s) : PHONE_RE.test(s);
      return ok ? null : `${label} must be a valid phone number.`;
    }

    case 'NUMBER':
    case 'SLIDER': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      if (!Number.isFinite(n)) return `${label} must be a number.`;
      // SLIDER carries its bounds on the question; NUMBER carries them in
      // `validation`. Both are honoured so neither control can submit a value
      // its own UI could not produce.
      const min = q.type === 'SLIDER' ? (q.sliderMin ?? v.min) : v.min;
      const max = q.type === 'SLIDER' ? (q.sliderMax ?? v.max) : v.max;
      if (min != null && n < min) return `${label} must be at least ${min}.`;
      if (max != null && n > max) return `${label} must be at most ${max}.`;
      return null;
    }

    case 'MULTI_CHOICE': {
      const selected = Array.isArray(value) ? value : [];
      if (v.min != null && selected.length < v.min) {
        return `${label} requires at least ${v.min} selection${v.min === 1 ? '' : 's'}.`;
      }
      if (v.max != null && selected.length > v.max) {
        return `${label} allows at most ${v.max} selection${v.max === 1 ? '' : 's'}.`;
      }
      return null;
    }

    case 'DATE': {
      const parsed = new Date(String(value));
      return Number.isNaN(parsed.getTime()) ? `${label} must be a valid date.` : null;
    }

    case 'GPS_LOCATION': {
      const point = value as { lat?: unknown; lng?: unknown };
      const lat = Number(point?.lat);
      const lng = Number(point?.lng);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) return `${label} needs a valid location.`;
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) return `${label} needs a valid location.`;
      return null;
    }

    default:
      return null;
  }
}

/**
 * Seed the answer map from each question's `defaultValue`.
 *
 * `defaultValue` has been typed, normalised and persisted since the schema was
 * written, and read by nothing — so a form could never pre-fill a field. Values
 * already present (a restored draft, a URL prefill) always win.
 */
export function applyDefaultValues(
  questions: FormQuestion[],
  answers: Record<string, unknown>,
): Record<string, unknown> {
  const seeded: Record<string, unknown> = { ...answers };

  for (const q of questions) {
    if (!q?.id || q.type === 'SECTION_HEADER') continue;
    if (q.defaultValue === undefined || q.defaultValue === null || q.defaultValue === '') continue;
    if (!isBlank(seeded[q.id])) continue;

    // MULTI_CHOICE answers are always arrays; a single default authored as a
    // string would otherwise render as an unchecked list with a value the
    // control cannot represent.
    if (q.type === 'MULTI_CHOICE' && !Array.isArray(q.defaultValue)) {
      seeded[q.id] = [String(q.defaultValue)];
      continue;
    }

    seeded[q.id] = q.defaultValue;
  }

  return seeded;
}
