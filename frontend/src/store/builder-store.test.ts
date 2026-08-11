import { describe, expect, it, beforeEach } from 'bun:test';
import {
  selectFormSnapshot,
  selectQuestionOutline,
  selectSavePayload,
  useBuilderStore,
} from './builder-store';
import type { FormConfig } from '@/types/form';

/**
 * The invariant these protect is a `getSnapshot` contract, not a preference.
 *
 * zustand hands a selector's result to `useSyncExternalStore`, which re-renders
 * whenever that result's identity differs from the previous one. A selector
 * that allocates on every call therefore renders → allocates → is told the
 * snapshot changed → renders, until React aborts with "Maximum update depth
 * exceeded". That is the crash that made every saved form impossible to open.
 */

const sample = (questionCount: number): FormConfig => ({
  id: 'form-1',
  title: 'Test',
  description: '',
  isQuizMode: false,
  theme: {} as FormConfig['theme'],
  pages: [{ pageNumber: 1, title: 'Page 1', description: '' }],
  questions: Array.from({ length: questionCount }, (_, i) => ({
    id: `q${i}`,
    type: 'SHORT_TEXT' as const,
    label: `Question ${i}`,
    validation: { required: false },
    pageNumber: 1,
  })),
  logic: [],
  createdAt: '',
  updatedAt: '2026-08-07T10:00:00.000Z',
});

describe('selectQuestionOutline', () => {
  beforeEach(() => useBuilderStore.getState().reset());

  it('returns the identical array when called twice on unchanged state', () => {
    useBuilderStore.getState().load(sample(3));
    const state = useBuilderStore.getState();

    // The exact call pattern useSyncExternalStore makes during a render pass.
    expect(selectQuestionOutline(state)).toBe(selectQuestionOutline(state));
  });

  it('stays identical across a state change that the outline does not display', () => {
    useBuilderStore.getState().load(sample(3));
    const before = selectQuestionOutline(useBuilderStore.getState());

    // Placeholder is not part of an outline row.
    useBuilderStore.getState().patchQuestion('q1', { placeholder: 'typed something' });

    expect(selectQuestionOutline(useBuilderStore.getState())).toBe(before);
  });

  it('is stable for an empty form too', () => {
    const state = useBuilderStore.getState();
    expect(selectQuestionOutline(state)).toBe(selectQuestionOutline(state));
  });

  it('produces a new array when a displayed field changes', () => {
    useBuilderStore.getState().load(sample(2));
    const before = selectQuestionOutline(useBuilderStore.getState());

    useBuilderStore.getState().patchQuestion('q0', { label: 'Renamed' });

    const after = selectQuestionOutline(useBuilderStore.getState());
    expect(after).not.toBe(before);
    expect(after[0].label).toBe('Renamed');
  });

  it('tracks additions and removals', () => {
    useBuilderStore.getState().load(sample(2));
    useBuilderStore.getState().deleteQuestion('q0');
    expect(selectQuestionOutline(useBuilderStore.getState())).toHaveLength(1);
  });
});

describe('selectFormSnapshot', () => {
  beforeEach(() => useBuilderStore.getState().reset());

  it('is stable while the document is unchanged', () => {
    useBuilderStore.getState().load(sample(2));
    const state = useBuilderStore.getState();
    expect(selectFormSnapshot(state)).toBe(selectFormSnapshot(state));
  });

  it('recomputes after every edit — including the second one', () => {
    // The regression: the old memo keyed off `isDirty`, which latches true, so
    // only the first edit of a session was ever reflected in the panels.
    useBuilderStore.getState().load(sample(2));

    const first = selectFormSnapshot(useBuilderStore.getState());
    useBuilderStore.getState().setTheme({ primaryColor: '#111' } as any);
    const second = selectFormSnapshot(useBuilderStore.getState());
    useBuilderStore.getState().setTheme({ primaryColor: '#222' } as any);
    const third = selectFormSnapshot(useBuilderStore.getState());

    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
    expect((third.theme as any).primaryColor).toBe('#222');
  });

  it('does not reuse a snapshot across loading a different form', () => {
    useBuilderStore.getState().load(sample(1));
    const first = selectFormSnapshot(useBuilderStore.getState());

    useBuilderStore.getState().load({ ...sample(1), id: 'form-2', title: 'Other' });
    const second = selectFormSnapshot(useBuilderStore.getState());

    expect(second).not.toBe(first);
    expect(second.title).toBe('Other');
  });
});

describe('revision watermarking', () => {
  beforeEach(() => useBuilderStore.getState().reset());

  it('keeps edits made during an in-flight save dirty', () => {
    useBuilderStore.getState().load(sample(1));

    useBuilderStore.getState().setTitle('A');
    const sent = useBuilderStore.getState().revision;

    // The user keeps typing while the request is on the wire.
    useBuilderStore.getState().setTitle('AB');

    useBuilderStore.getState().markSaved(sent, { updatedAt: '2026-08-07T10:05:00.000Z' });

    expect(useBuilderStore.getState().isDirty).toBe(true);
    expect(useBuilderStore.getState().savedRevision).toBe(sent);
  });

  it('settles when the save covered the latest revision', () => {
    useBuilderStore.getState().load(sample(1));
    useBuilderStore.getState().setTitle('A');

    useBuilderStore.getState().markSaved(useBuilderStore.getState().revision);

    expect(useBuilderStore.getState().isDirty).toBe(false);
  });

  it('never lets revision go backwards across a load', () => {
    useBuilderStore.getState().setTitle('scratch');
    const before = useBuilderStore.getState().revision;

    useBuilderStore.getState().load(sample(1));

    expect(useBuilderStore.getState().revision).toBeGreaterThan(before);
  });
});

describe('selectSavePayload', () => {
  beforeEach(() => useBuilderStore.getState().reset());

  it('carries the settings the builder used to drop entirely', () => {
    useBuilderStore.getState().load(sample(1), {
      settings: {
        slug: 'my-form',
        layoutMode: 'CONVERSATIONAL',
        requireAuth: true,
        allowMultiple: false,
        maxSubmissions: 50,
        expiresAt: '2026-12-01T00:00:00.000Z',
        isPasswordProtected: false,
        notifyEmails: ['a@b.com'],
      },
    });

    useBuilderStore.getState().patchSettings({ slug: 'my-renamed-form' });

    const payload = selectSavePayload(useBuilderStore.getState());

    expect(payload.slug).toBe('my-renamed-form');
    expect(payload.layoutMode).toBe('CONVERSATIONAL');
    expect(payload.requireAuth).toBe(true);
    expect(payload.allowMultiple).toBe(false);
    expect(payload.maxSubmissions).toBe(50);
    expect(payload.expiresAt).toBe('2026-12-01T00:00:00.000Z');
    expect(payload.notifyEmails).toEqual(['a@b.com']);
  });

  it('omits a slug the server issued, so a legacy slug cannot 400 its own autosave', () => {
    // Forms created before slugs were generated from a lowercase alphabet carry
    // uppercase and underscores, which the API's own `@Matches` rejects. Echoing
    // one back made every autosave on that form fail permanently.
    useBuilderStore.getState().load(sample(1), {
      settings: { slug: 'V1StGXR8_Z' },
    });

    expect(selectSavePayload(useBuilderStore.getState())).not.toHaveProperty('slug');

    // A save that echoes the same slug back must not re-arm it either.
    useBuilderStore.getState().markSaved(useBuilderStore.getState().revision, {
      slug: 'V1StGXR8_Z',
    });

    expect(selectSavePayload(useBuilderStore.getState())).not.toHaveProperty('slug');
  });

  it('sends null rather than omitting a cleared cap, so clearing it takes effect', () => {
    useBuilderStore.getState().load(sample(1), {
      settings: { maxSubmissions: 10, expiresAt: '2026-12-01T00:00:00.000Z' },
    });
    useBuilderStore.getState().patchSettings({ maxSubmissions: null, expiresAt: null });

    const payload = selectSavePayload(useBuilderStore.getState());

    expect(payload).toHaveProperty('maxSubmissions', null);
    expect(payload).toHaveProperty('expiresAt', null);
  });

  it('includes expectedUpdatedAt so a concurrent editor is detected', () => {
    useBuilderStore.getState().load(sample(1), { updatedAt: '2026-08-07T10:00:00.000Z' });
    expect(selectSavePayload(useBuilderStore.getState()).expectedUpdatedAt).toBe(
      '2026-08-07T10:00:00.000Z',
    );
  });

  it('only sends a password when one was actually typed', () => {
    useBuilderStore.getState().load(sample(1));
    expect(selectSavePayload(useBuilderStore.getState())).not.toHaveProperty('password');

    useBuilderStore.getState().setPendingPassword('hunter2');
    expect(selectSavePayload(useBuilderStore.getState()).password).toBe('hunter2');
  });
});

describe('load', () => {
  beforeEach(() => useBuilderStore.getState().reset());

  it('drops logic rules pointing at questions the form no longer has', () => {
    useBuilderStore.getState().load({
      ...sample(2),
      logic: [
        { id: 'ok', triggerQuestionId: 'q0', operator: 'EQUALS', value: '1', action: 'HIDE', targetQuestionId: 'q1' },
        { id: 'dangling', triggerQuestionId: 'q0', operator: 'EQUALS', value: '1', action: 'HIDE', targetQuestionId: 'deleted' },
      ],
    });

    expect(useBuilderStore.getState().logic.map((r) => r.id)).toEqual(['ok']);
  });

  it('survives the nulls and duplicates older saves left in the JSON columns', () => {
    useBuilderStore.getState().load({
      ...sample(0),
      questions: [
        null,
        { id: 'a', type: 'SHORT_TEXT', label: 'A', validation: {} },
        { id: 'a', type: 'SHORT_TEXT', label: 'Duplicate', validation: {} },
      ] as any,
    });

    expect(useBuilderStore.getState().order).toEqual(['a']);
    expect(useBuilderStore.getState().byId['a'].label).toBe('A');
  });
});
