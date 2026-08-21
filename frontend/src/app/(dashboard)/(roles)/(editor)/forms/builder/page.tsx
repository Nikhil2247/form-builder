'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  AlignLeft,
  Calendar,
  CheckCircle2,
  CheckSquare,
  Gauge,
  Grid,
  Hash,
  Heading as HeadingIcon,
  Link as LinkIcon,
  ListFilter,
  Mail,
  MapPin,
  PenTool,
  Phone,
  Plus,
  Sliders,
  Sparkles,
  Star,
  Type,
  UploadCloud,
} from 'lucide-react';
import { toast } from 'sonner';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Modal } from '@/components/shared';
import { EnterpriseNavbar } from '@/components/builder/EnterpriseNavbar';
import { LeftTreePanel } from '@/components/builder/LeftTreePanel';
import { EnterpriseFieldCard } from '@/components/builder/EnterpriseFieldCard';
import { RichTextEditor } from '@/components/builder/RichTextEditor';
import { PageTabsBar } from '@/components/builder/PageTabsBar';
import { FormRunner } from '@/components/builder/FormRunner';
import { FormThemeScope } from '@/components/builder/FormThemeScope';
import { LogicBuilder } from '@/components/builder/LogicBuilder';
import { RulesBuilder } from '@/components/builder/RulesBuilder';
import { FormSettingsPanel } from '@/components/builder/FormSettingsPanel';
import { fetchApi, unwrap } from '@/lib/api';
import { toastError } from '@/lib/errors';
import { selectAllOnFocus } from '@/lib/utils';
import { useOrgId } from '@/hooks/use-auth';
import { useFormAutosave } from '@/hooks/use-form-autosave';
import {
  selectFormConfig,
  useBuilderMeta,
  useBuilderStore,
  useFormConfigAdapter,
  useFormSnapshot,
  usePageQuestionIds,
  useQuestionOrder,
} from '@/store/builder-store';
import type { FormConfig, FormLayoutMode, QuestionType } from '@/types/form';

const COMMAND_ITEMS: { type: QuestionType; label: string; keywords: string; icon: React.ElementType }[] =
  [
    { type: 'SHORT_TEXT', label: 'Short answer', keywords: 'text short input string', icon: Type },
    { type: 'LONG_TEXT', label: 'Paragraph', keywords: 'long text paragraph textarea', icon: AlignLeft },
    { type: 'EMAIL', label: 'Email address', keywords: 'email mail address', icon: Mail },
    { type: 'PHONE', label: 'Phone number', keywords: 'phone mobile tel', icon: Phone },
    { type: 'NUMBER', label: 'Number', keywords: 'number numeric integer amount', icon: Hash },
    { type: 'URL', label: 'Website URL', keywords: 'url website link', icon: LinkIcon },
    { type: 'SINGLE_CHOICE', label: 'Single choice', keywords: 'radio single choice select', icon: CheckCircle2 },
    { type: 'MULTI_CHOICE', label: 'Multiple choice', keywords: 'checkbox multi multiple', icon: CheckSquare },
    { type: 'DROPDOWN', label: 'Dropdown', keywords: 'dropdown select menu list', icon: ListFilter },
    { type: 'STAR_RATING', label: 'Star rating', keywords: 'star rating score', icon: Star },
    { type: 'NPS', label: 'NPS score', keywords: 'nps net promoter score', icon: Gauge },
    { type: 'SLIDER', label: 'Slider', keywords: 'slider range scale', icon: Sliders },
    { type: 'DATE', label: 'Date', keywords: 'date picker calendar', icon: Calendar },
    { type: 'FILE_UPLOAD', label: 'File upload', keywords: 'file upload document image', icon: UploadCloud },
    { type: 'SIGNATURE', label: 'Signature', keywords: 'signature sign draw', icon: PenTool },
    { type: 'MATRIX', label: 'Matrix / Likert', keywords: 'matrix likert grid table', icon: Grid },
    { type: 'GPS_LOCATION', label: 'GPS location', keywords: 'gps location geolocation map coordinates', icon: MapPin },
    { type: 'SECTION_HEADER', label: 'Section header', keywords: 'section header banner title', icon: HeadingIcon },
  ];

/**
 * The builder's view of GET /organizations/:orgId/forms/:id.
 *
 * Written out rather than reaching for `any`: this is the one place the whole
 * document crosses into the store, so a field the API stops sending should be a
 * type error here and not a silently empty panel. Everything is optional
 * because forms saved by older builds genuinely lack some of these columns —
 * `rulesJson` and `subjectTypeId` most of all.
 */
interface LoadedFormResponse {
  id?: string;
  title?: string;
  description?: string | null;
  isQuizMode?: boolean;
  themeConfig?: FormConfig['theme'];
  pagesJson?: FormConfig['pages'];
  questionsJson?: FormConfig['questions'];
  logicJson?: FormConfig['logic'];
  rulesJson?: FormConfig['rules'];
  slug?: string | null;
  status?: FormConfig['status'];
  layoutMode?: string | null;
  /** Present only on forms bound to a subject type; gates `ref` nodes. */
  subjectTypeId?: string | null;
  requireAuth?: boolean;
  allowMultiple?: boolean;
  maxSubmissions?: number | null;
  expiresAt?: string | null;
  isPasswordProtected?: boolean;
  notifyEmails?: unknown;
  createdAt?: string;
  updatedAt?: string;
  versions?: Array<{ publishedAt?: string | null }>;
  /** The API sometimes wraps the row and sometimes returns it bare. */
  form?: LoadedFormResponse;
}

/**
 * The load and publish paths below call `fetchApi` directly rather than through
 * a mutation, so the global MutationCache handler never sees their failures —
 * they report for themselves via `toastError`. Publish especially: the API
 * answers a rule-compilation failure with a field-level `issues` array naming
 * each broken rule, and `toastError` is what renders it instead of collapsing
 * the whole thing to "Could not publish this form".
 */

function FormBuilderInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeFormId = searchParams.get('id');
  const orgId = useOrgId();

  const meta = useBuilderMeta();
  const order = useQuestionOrder();
  const pages = useBuilderStore((s) => s.pages);
  const activePage = useBuilderStore((s) => s.activePage);
  const visibleIds = usePageQuestionIds(activePage);

  const load = useBuilderStore((s) => s.load);
  const reset = useBuilderStore((s) => s.reset);
  const setLoading = useBuilderStore((s) => s.setLoading);
  const setTitle = useBuilderStore((s) => s.setTitle);
  const setDescription = useBuilderStore((s) => s.setDescription);
  const addQuestion = useBuilderStore((s) => s.addQuestion);
  const moveQuestion = useBuilderStore((s) => s.moveQuestion);
  const addPage = useBuilderStore((s) => s.addPage);
  const updatePage = useBuilderStore((s) => s.updatePage);
  const setActivePage = useBuilderStore((s) => s.setActivePage);
  const setActiveView = useBuilderStore((s) => s.setActiveView);
  const markPublished = useBuilderStore((s) => s.markPublished);

  /**
   * Appends after the last question on the active page, rather than after
   * whatever question was last selected — anywhere in the form. That
   * `selectedQuestionId` version is why "Add question" used to insert a new
   * field mid-form instead of at the bottom.
   */
  const appendToActivePage = useCallback(
    (type: QuestionType) => {
      const state = useBuilderStore.getState();
      let lastIdOnPage: string | undefined;
      for (let i = state.order.length - 1; i >= 0; i--) {
        if (state.byId[state.order[i]]?.pageNumber === state.activePage) {
          lastIdOnPage = state.order[i];
          break;
        }
      }
      return addQuestion(type, lastIdOnPage, state.activePage);
    },
    [addQuestion],
  );

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // `formId` lives in a ref as well as the URL because autosave fires from a
  // timer and must see the id created by an in-flight first save.
  const formIdRef = useRef<string | null>(routeFormId);

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadForm() {
      if (!routeFormId) {
        // Brand new form. Previously this seeded from SAMPLE_FORMS, so a new
        // form opened pre-filled with mock questions the user could publish.
        reset();
        return;
      }
      if (!orgId) return;

      // The first autosave of a new form creates it and rewrites the URL to
      // carry the new id. That changes `routeFormId`, which re-runs this
      // effect — and re-fetching would overwrite the live editor with the
      // server's copy, discarding everything typed since that request left and
      // yanking the cursor out of whatever field it was in. We already hold
      // this exact form; there is nothing to load.
      if (formIdRef.current === routeFormId && useBuilderStore.getState().id === routeFormId) {
        return;
      }

      setLoading(true);
      try {
        const data = unwrap<LoadedFormResponse>(
          await fetchApi(`/organizations/${orgId}/forms/${routeFormId}`),
        );
        const form = data?.form ?? data;
        if (cancelled) return;

        const lastPublishedAt = form.versions?.[0]?.publishedAt;

        load(
          {
            id: form.id,
            title: form.title,
            description: form.description ?? '',
            isQuizMode: form.isQuizMode,
            theme: form.themeConfig,
            pages: form.pagesJson ?? [],
            questions: form.questionsJson ?? [],
            logic: form.logicJson ?? [],
            rules: form.rulesJson ?? [],
            slug: form.slug ?? undefined,
            createdAt: form.createdAt,
            updatedAt: form.updatedAt,
          } as FormConfig,
          {
            status: form.status ?? 'DRAFT',
            updatedAt: form.updatedAt ?? null,
            // Cross-form `ref` nodes read another form's answer for the same
            // subject, so without a subject type there is nothing to look them
            // up against and the compiler rejects them. Same condition the
            // publish endpoint uses for `allowReferences`.
            allowReferences: !!form.subjectTypeId,
            // The draft columns are written on save, a FormVersion only on
            // publish. A newer updatedAt means the live version is stale.
            hasUnpublishedChanges:
              form.status === 'PUBLISHED' &&
              !!lastPublishedAt &&
              // Guarded rather than assumed: without `updatedAt` this read
              // `new Date(undefined)`, which is an Invalid Date whose
              // `getTime()` is NaN — and every comparison against NaN is false,
              // so a published form silently reported no pending changes.
              !!form.updatedAt &&
              new Date(form.updatedAt).getTime() > new Date(lastPublishedAt).getTime(),
            settings: {
              slug: form.slug ?? '',
              layoutMode: (form.layoutMode ?? 'DOCUMENT') as FormLayoutMode,
              requireAuth: !!form.requireAuth,
              // The column defaults to true, so `?? true` rather than `!!` —
              // a missing field must not silently switch duplicate blocking on.
              allowMultiple: form.allowMultiple ?? true,
              maxSubmissions: form.maxSubmissions ?? null,
              expiresAt: form.expiresAt ?? null,
              isPasswordProtected: !!form.isPasswordProtected,
              notifyEmails: Array.isArray(form.notifyEmails)
                ? form.notifyEmails.filter((e: unknown): e is string => typeof e === 'string')
                : [],
            },
          },
        );
        // The id we asked for, if the response omitted its own — losing it here
        // would make the next autosave POST a second copy of this form.
        formIdRef.current = form.id ?? routeFormId;
      } catch (error) {
        if (cancelled) return;
        setLoading(false);
        toastError(error, 'Could not load this form');
      }
    }

    void loadForm();
    return () => {
      cancelled = true;
    };
  }, [routeFormId, orgId, load, reset, setLoading]);

  // Leaving the builder must not leave the previous form in the store — opening
  // a different form briefly rendered the old one's questions.
  useEffect(() => () => reset(), [reset]);

  // ── Autosave ──────────────────────────────────────────────────────────────
  // The whole save path — debounce, coalescing, retry, offline, conflict and
  // flush-on-exit — lives in the hook. This component only supplies the id and
  // reacts to the resulting status.
  const autosave = useFormAutosave({
    orgId,
    formIdRef,
    enabled: !meta.isLoading,
    onCreated: useCallback(
      (id: string) => {
        // `replace`, not `push` — the empty-builder URL is not somewhere the
        // back button should return to.
        router.replace(`/forms/builder?id=${id}`);
      },
      [router],
    ),
  });

  const { saveNow, status: saveStatus } = autosave;

  const saveManually = useCallback(async () => {
    const id = await saveNow();
    if (id) toast.success('Draft saved');
    return id;
  }, [saveNow]);

  // ── Publish ───────────────────────────────────────────────────────────────
  const publish = useCallback(async () => {
    const state = useBuilderStore.getState();
    if (state.order.length === 0) {
      toast.error('Add at least one question before publishing.');
      return;
    }

    setIsPublishing(true);
    try {
      // Persist first so the published snapshot matches what is on screen.
      // `saveNow` returns the existing id unchanged when there is nothing
      // pending, so a republish with no edits still works.
      const id = await saveNow({ silent: true });
      if (!id) {
        toast.error('Your latest changes could not be saved, so nothing was published.');
        return;
      }

      const form = selectFormConfig(useBuilderStore.getState());
      await fetchApi(`/organizations/${orgId}/forms/${id}/publish`, {
        method: 'POST',
        body: JSON.stringify({
          pages: form.pages,
          questions: form.questions,
          logic: form.logic,
          // Compiled server-side by the same `compileRules` the rules panel
          // runs live, so a set the panel reports as clean publishes cleanly.
          rules: form.rules ?? [],
          theme: form.theme,
        }),
      });

      const wasPublished = state.status === 'PUBLISHED';
      markPublished();
      toast.success(wasPublished ? 'New version published' : 'Your form is live');
    } catch (error) {
      toastError(error, 'Could not publish this form');
    } finally {
      setIsPublishing(false);
    }
  }, [orgId, saveNow, markPublished]);

  // ── Unsaved-changes guard ─────────────────────────────────────────────────
  // Autosave already flushes on `pagehide`, so this is the narrow case that
  // flush cannot cover: work that is still queued *and* the last attempt to
  // write it failed. Prompting whenever `isDirty` was true — as this used to —
  // meant a confirm dialog during the ordinary 1.2s debounce, on a form that
  // was about to save itself perfectly well.
  useEffect(() => {
    const atRisk =
      saveStatus === 'error' || saveStatus === 'conflict' || saveStatus === 'offline';
    if (!atRisk) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveStatus]);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return (
        !!el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+S works from anywhere, including inside a field.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveManually();
        return;
      }
      if (isTypingTarget(e.target)) return;

      if (e.key === '/' && useBuilderStore.getState().activeView === 'BUILDER') {
        e.preventDefault();
        setIsPaletteOpen(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveManually]);

  // ── Drag and drop ─────────────────────────────────────────────────────────
  const sensors = useSensors(
    // 8px, up from 4 — at 4 a click that drifted by a pixel or two started a
    // drag instead of selecting the card.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingId(null);
      const { active, over } = event;
      if (over && active.id !== over.id) {
        moveQuestion(String(active.id), String(over.id));
      }
    },
    [moveQuestion],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggingId(String(event.active.id));
  }, []);

  if (meta.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center gap-3 bg-background" role="status">
        <Spinner className="size-5 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading form…</span>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-background">
      <EnterpriseNavbar
        formTitle={meta.title}
        onTitleChange={setTitle}
        onPreview={() => setIsPreviewOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        activeView={meta.activeView}
        onChangeView={setActiveView}
        // Both panels live behind the Logic tab, so the badge counts both —
        // showing only the conditional-logic rules would have read "1" on a
        // view holding four things the author has to maintain.
        logicRuleCount={meta.logicRuleCount + meta.ruleCount}
        onSaveChanges={() => void saveManually()}
        onToggleLeftPanel={() => setIsLeftPanelOpen(true)}
        onPublish={() => void publish()}
        isPublishing={isPublishing}
        saveStatus={autosave.status}
        saveError={autosave.errorMessage}
        status={meta.status}
        hasUnpublishedChanges={meta.hasUnpublishedChanges}
        publicUrl={meta.slug ? `/f/${meta.slug}` : null}
        lastSavedAt={autosave.lastSavedAt}
      />

      {/* A conflict stops autosave dead: another session owns the newer copy,
          and writing over it would destroy their work silently. */}
      {autosave.status === 'conflict' && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm"
        >
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
          <span className="flex-1 text-destructive">
            {autosave.errorMessage ??
              'This form was changed somewhere else. Your recent edits have not been saved.'}
          </span>
          <Button size="sm" variant="outline" onClick={autosave.reloadFromServer} className="gap-1.5">
            <RefreshCw className="size-3.5" />
            Reload the latest version
          </Button>
        </div>
      )}

      <div className="relative flex flex-1 overflow-hidden">
        {isLeftPanelOpen && (
          <div
            role="presentation"
            className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm md:hidden"
            onClick={() => setIsLeftPanelOpen(false)}
          />
        )}

        <div
          className={`fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out
                      md:relative md:translate-x-0
                      ${isLeftPanelOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <LeftTreePanel
            onAddQuestion={(type) => {
              appendToActivePage(type);
              setIsLeftPanelOpen(false);
            }}
            onAddPage={() => setActivePage(addPage())}
            onClose={() => setIsLeftPanelOpen(false)}
          />
        </div>

        <main id="main-content" className="relative flex-1 overflow-y-auto bg-muted/25">
          {meta.activeView === 'LOGIC' ? (
            // Both panels share this view. The rules panel renders nothing at
            // all when FORM_RULES is off, so an org without the flag sees the
            // logic canvas exactly as it was. The bottom padding lives here
            // rather than inside either panel, so the two stack on one rhythm
            // whichever of them is last.
            <div className="pb-24">
              <LogicBuilderPanel />
              <RulesBuilderPanel />
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5 p-4 pb-24 sm:p-6 lg:p-8">
              <Card className="space-y-3 p-5">
                <Input
                  value={meta.title}
                  onChange={(e) => setTitle(e.target.value)}
                  onFocus={selectAllOnFocus}
                  aria-label="Form title"
                  placeholder="Form title"
                  className="h-auto rounded-none border-0 bg-transparent px-0 text-xl font-semibold shadow-none
                             focus-visible:border-b-2 focus-visible:border-foreground/30 focus-visible:ring-0"
                />
                <FormDescriptionEditor onChange={setDescription} />
              </Card>

              {/* Only once there is more than one page — a single-page form
                  looks exactly as it always has. */}
              {pages.length > 1 && (
                <div className="space-y-3">
                  <PageTabsBar />
                  <Card className="space-y-3 p-5">
                    <Input
                      value={pages.find((p) => p.pageNumber === activePage)?.title ?? ''}
                      onChange={(e) => updatePage(activePage, { title: e.target.value })}
                      onFocus={selectAllOnFocus}
                      aria-label="Page title"
                      placeholder={`Page ${activePage}`}
                      className="h-auto rounded-none border-0 bg-transparent px-0 text-base font-semibold shadow-none
                                 focus-visible:border-b-2 focus-visible:border-foreground/30 focus-visible:ring-0"
                    />
                    <RichTextEditor
                      key={activePage}
                      value={pages.find((p) => p.pageNumber === activePage)?.description ?? ''}
                      onChange={(html) => updatePage(activePage, { description: html })}
                      ariaLabel="Page description"
                      placeholder="Add a page description (optional)"
                    />
                  </Card>
                </div>
              )}

              {order.length === 0 ? (
                <div className="space-y-4 rounded-xl border border-dashed border-border-strong bg-card p-12 text-center">
                  <Sparkles className="mx-auto size-7 text-muted-foreground" strokeWidth={1.5} />
                  <div>
                    <p className="text-sm font-semibold">This form has no questions yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Pick a field from the palette, or press{' '}
                      <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-xs font-semibold">
                        /
                      </kbd>{' '}
                      to search.
                    </p>
                  </div>
                  <Button onClick={() => appendToActivePage('SHORT_TEXT')} className="gap-2">
                    <Plus className="size-4" />
                    Add your first question
                  </Button>
                </div>
              ) : visibleIds.length === 0 ? (
                <div className="space-y-3 rounded-xl border border-dashed border-border-strong bg-card p-8 text-center">
                  <p className="text-sm font-semibold">No questions on this page yet</p>
                  <Button
                    variant="outline"
                    onClick={() => appendToActivePage('SHORT_TEXT')}
                    className="gap-2"
                  >
                    <Plus className="size-4" />
                    Add a question
                  </Button>
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={() => setDraggingId(null)}
                >
                  <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                      {visibleIds.map((id) => (
                        <EnterpriseFieldCard key={id} id={id} index={order.indexOf(id)} />
                      ))}
                    </div>
                  </SortableContext>

                  {/* A drag overlay keeps the moving card at full opacity and
                      out of the list's layout, which removes the jitter the
                      previous in-place transform caused. */}
                  <DragOverlay dropAnimation={null}>
                    {draggingId ? <DragPreview id={draggingId} /> : null}
                  </DragOverlay>
                </DndContext>
              )}

              {visibleIds.length > 0 && (
                <div className="pt-2 text-center">
                  <Button
                    variant="outline"
                    onClick={() => setIsPaletteOpen(true)}
                    className="gap-2 rounded-full"
                  >
                    <Plus className="size-4" />
                    Add question
                  </Button>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ── Preview ─────────────────────────────────────────────────────── */}
      <Modal
        open={isPreviewOpen}
        onOpenChange={setIsPreviewOpen}
        size="lg"
        title="Preview"
        description="Interactive preview — nothing submitted here is saved."
      >
        {isPreviewOpen && <PreviewPanel />}
      </Modal>

      {/* ── Settings ────────────────────────────────────────────────────── */}
      {/* `md` (32rem), not the previous `xl` (56rem). The tabs are a column of
          label/control rows, not a dashboard — at 56rem every row was a short
          label stranded beside a control against the far edge. */}
      <Modal
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        size="md"
        title="Form settings"
        description="Design, access, limits and notifications. Saved automatically."
        footer={
          <Button size="sm" onClick={() => setIsSettingsOpen(false)}>
            Done
          </Button>
        }
      >
        {isSettingsOpen && <FormSettingsPanel />}
      </Modal>

      {/* ── Field palette ───────────────────────────────────────────────── */}
      <CommandDialog open={isPaletteOpen} onOpenChange={setIsPaletteOpen}>
        <CommandInput placeholder="Search field types…" />
        <CommandList>
          <CommandEmpty>No field type matches.</CommandEmpty>
          <CommandGroup heading="Add a field">
            {COMMAND_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.type}
                  value={`${item.label} ${item.keywords}`}
                  onSelect={() => {
                    const newId = appendToActivePage(item.type);
                    setIsPaletteOpen(false);
                    // Bring the new card into view — adding from the palette
                    // while scrolled up gave no feedback at all.
                    requestAnimationFrame(() => {
                      document
                        .querySelector(`[data-question-id="${newId}"]`)
                        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    });
                  }}
                  className="cursor-pointer gap-2"
                >
                  <Icon className="size-4 text-muted-foreground" />
                  <span>{item.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Panels
//
// Each of these subscribes to the whole document itself rather than receiving
// it as a prop from the page.
//
// That is deliberate. The page used to build the snapshot with:
//
//   useMemo(() => selectFormConfig(store.getState()),
//           [meta.isDirty, meta.activeView, isThemeOpen, isPreviewOpen, order.length])
//
// `isDirty` flips false → true on the first edit of a session and then stays
// true until an autosave completes, so after that first edit none of the deps
// moved for a theme tweak or a logic-rule change. The panels kept re-rendering
// the *original* snapshot: adding a logic rule appeared to do nothing at all,
// and colour changes only showed up when an autosave happened to reset
// `isDirty` and unstick the memo.
//
// `useFormSnapshot` is memoised on the store's monotonic `revision`, so it is
// correct by construction. Keeping it inside these small components (mounted
// only while their panel is open) means the canvas and the page component are
// still not re-rendered by it.
// ─────────────────────────────────────────────────────────────────────────────

function LogicBuilderPanel() {
  const form = useFormSnapshot();
  const setForm = useFormConfigAdapter();
  return <LogicBuilder form={form} setForm={setForm} />;
}

/**
 * Rules panel — same wiring as the logic panel above, plus the one fact the
 * document itself does not carry: whether this form is bound to a subject type,
 * which is what decides whether cross-form references are legal.
 */
function RulesBuilderPanel() {
  const form = useFormSnapshot();
  const setForm = useFormConfigAdapter();
  const allowReferences = useBuilderStore((s) => s.allowReferences);
  return <RulesBuilder form={form} setForm={setForm} allowReferences={allowReferences} />;
}

/**
 * The preview is themed, because the point of a preview is to show what the
 * respondent gets. It renders inside a dialog, so the scope must not paint its
 * own page background over the dialog's surface.
 */
function PreviewPanel() {
  const form = useFormSnapshot();
  const layoutMode = useBuilderStore((s) => s.settings.layoutMode);
  // The preview holds AUTHORED rules, not a compiled plan, so the runner
  // compiles them live with the same `compileRules` the publish endpoint uses.
  // `allowReferences` has to match, or a preview would accept a cross-form
  // reference that publish then rejects.
  const allowReferences = useBuilderStore((s) => s.allowReferences);
  // Lets a list-backed question fetch its real options here — there is no
  // published form slug yet, so without this it could only say which list it
  // was bound to, not show it.
  const orgId = useOrgId();

  return (
    <FormThemeScope
      theme={form.theme}
      paintBackground={false}
      className="rounded-lg p-4"
      // Painted here rather than by the scope so the dialog's own padding and
      // radius stay visible around it.
      style={{ backgroundColor: form.theme?.backgroundColor }}
    >
      <FormRunner
        form={form}
        layoutMode={layoutMode === 'PORTAL' ? 'DOCUMENT' : layoutMode}
        allowReferences={allowReferences}
        orgId={orgId}
        onSubmitResponse={() => {
          toast.success('Preview submission — no data was stored.');
        }}
      />
    </FormThemeScope>
  );
}

/**
 * The description field reads its initial value once — the store's own
 * revision-scoped snapshot is for the panels that render the whole document,
 * and subscribing this to it would re-mount the editor on every keystroke.
 */
function FormDescriptionEditor({ onChange }: { onChange: (value: string) => void }) {
  const initial = useBuilderStore.getState().description;

  return (
    <RichTextEditor
      value={initial}
      onChange={onChange}
      ariaLabel="Form description"
      placeholder="Add a short description (optional)"
    />
  );
}

/** Minimal ghost shown under the cursor while dragging. */
function DragPreview({ id }: { id: string }) {
  const question = useBuilderStore((s) => s.byId[id]);
  const index = useBuilderStore((s) => s.order.indexOf(id));
  if (!question) return null;

  return (
    <Card className="flex items-center gap-3 border-foreground/25 p-4 shadow-overlay">
      <span className="tabular text-xs font-semibold text-muted-foreground">Q{index + 1}</span>
      <span className="truncate text-sm font-medium">{question.label}</span>
    </Card>
  );
}

export default function FormBuilderStudioPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-background">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      }
    >
      <FormBuilderInner />
    </React.Suspense>
  );
}
