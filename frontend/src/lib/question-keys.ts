/**
 * Question keys — label → formula-safe identifier.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Mirrors the server's `slugifyKey` / key de-duplication in
 * `form-structure.ts` exactly. Two consumers need it and neither is the rules
 * panel, which is why it lives here rather than in `components/builder`:
 *
 *   • the rules authoring UI, so a rule can address a question that has not
 *     been saved yet and therefore has no server-assigned `key`;
 *   • the runner, which must resolve the same keys the compiled plan was built
 *     against in order to evaluate it in the browser.
 *
 * If the two derivations ever disagreed, a rule would compile in the panel and
 * then read `null` for a field at runtime. One implementation, imported by
 * both, is what prevents that.
 *
 * Pure — no React, no imports beyond the question type.
 */

import type { FormQuestion } from '@/types/form';

/** Longest key the API will store; mirrors STRUCTURE_LIMITS.MAX_KEY_LENGTH. */
const MAX_KEY_LENGTH = 60;

export function slugifyKey(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize('NFKD')
    // Strip combining accents so "Âge" and "Age" produce the same key.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_KEY_LENGTH);

  // Keys are identifiers in formulas, so they cannot lead with a digit.
  return slug && !/^\d/.test(slug) ? slug : `f_${slug}`;
}

export interface QuestionKeyRow {
  id: string;
  key: string;
  label: string;
  type: FormQuestion['type'];
}

/**
 * The key every question will be addressable by, in form order.
 *
 * A question that HAS a server-assigned key keeps it verbatim — re-slugifying
 * it would be wrong, because the server may have appended a `_2` to break a tie
 * and re-deriving from the label would drop that suffix and collide again.
 * Only a question that has never been saved gets its key derived here.
 */
export function deriveQuestionKeys(questions: FormQuestion[]): QuestionKeyRow[] {
  const seen = new Set<string>();
  const rows: QuestionKeyRow[] = [];

  for (const question of questions) {
    if (!question?.id) continue;

    let key = question.key?.trim() ? slugifyKey(question.key) : slugifyKey(question.label ?? '');

    if (seen.has(key)) {
      let suffix = 2;
      while (seen.has(`${key}_${suffix}`)) suffix += 1;
      key = `${key}_${suffix}`;
    }
    seen.add(key);

    rows.push({
      id: question.id,
      key,
      label: question.label || 'Untitled question',
      type: question.type,
    });
  }

  return rows;
}
