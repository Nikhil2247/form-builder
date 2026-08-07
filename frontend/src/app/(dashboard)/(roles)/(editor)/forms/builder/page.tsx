'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { FormRunner } from '@/components/builder/FormRunner';
import { ThemeCustomizer } from '@/components/builder/ThemeCustomizer';
import { LogicBuilder } from '@/components/builder/LogicBuilder';
import { fetchApi, unwrap } from '@/lib/api';
import { useOrgId } from '@/hooks/use-auth';
import {
  selectFormConfig,
  useBuilderMeta,
  useBuilderStore,
  useQuestionOrder,
} from '@/store/builder-store';
import type { FormConfig, QuestionType } from '@/types/form';

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
    { type: 'SECTION_HEADER', label: 'Section header', keywords: 'section header banner title', icon: HeadingIcon },
  ];

/** Draft is written this long after the last edit. */
const AUTOSAVE_DELAY_MS = 1500;

function FormBuilderInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeFormId = searchParams.get('id');
  const orgId = useOrgId();

  const meta = useBuilderMeta();
  const order = useQuestionOrder();

  const load = useBuilderStore((s) => s.load);
  const reset = useBuilderStore((s) => s.reset);
  const setLoading = useBuilderStore((s) => s.setLoading);
  const setTitle = useBuilderStore((s) => s.setTitle);
  const setDescription = useBuilderStore((s) => s.setDescription);
  const addQuestion = useBuilderStore((s) => s.addQuestion);
  const moveQuestion = useBuilderStore((s) => s.moveQuestion);
  const addPage = useBuilderStore((s) => s.addPage);
  const selectQuestion = useBuilderStore((s) => s.selectQuestion);
  const setActiveView = useBuilderStore((s) => s.setActiveView);
  const markSaved = useBuilderStore((s) => s.markSaved);
  const markPublished = useBuilderStore((s) => s.markPublished);

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
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

      setLoading(true);
      try {
        const data = unwrap<any>(await fetchApi(`/organizations/${orgId}/forms/${routeFormId}`));
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
            createdAt: form.createdAt,
            updatedAt: form.updatedAt,
          } as FormConfig,
          {
            status: form.status ?? 'DRAFT',
            slug: form.slug ?? null,
            // The draft columns are written on save, a FormVersion only on
            // publish. A newer updatedAt means the live version is stale.
            hasUnpublishedChanges:
              form.status === 'PUBLISHED' &&
              !!lastPublishedAt &&
              new Date(form.updatedAt).getTime() > new Date(lastPublishedAt).getTime(),
          },
        );
        formIdRef.current = form.id;
      } catch (error: any) {
        if (cancelled) return;
        setLoading(false);
        toast.error(error?.message ?? 'Could not load this form');
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

  // ── Save ──────────────────────────────────────────────────────────────────
  const save = useCallback(
    async (opts: { silent?: boolean } = {}): Promise<string | null> => {
      if (!orgId) return null;

      const form = selectFormConfig(useBuilderStore.getState());
      const body = JSON.stringify({
        title: form.title,
        description: form.description,
        isQuizMode: form.isQuizMode,
        themeConfig: form.theme,
        pages: form.pages,
        questions: form.questions,
        logic: form.logic,
      });

      setIsSaving(true);
      try {
        let id = formIdRef.current;

        if (id) {
          await fetchApi(`/organizations/${orgId}/forms/${id}`, { method: 'PUT', body });
        } else {
          const created = unwrap<any>(
            await fetchApi(`/organizations/${orgId}/forms`, { method: 'POST', body }),
          );
          const form = created?.form ?? created;
          id = form.id;
          formIdRef.current = id;
          // `replace`, not `push` — the empty-builder URL is not somewhere the
          // back button should return to.
          router.replace(`/forms/builder?id=${id}`);
        }

        markSaved();
        setLastSavedAt(new Date());
        if (!opts.silent) toast.success('Draft saved');
        return id;
      } catch (error: any) {
        toast.error(error?.message ?? 'Could not save this form');
        return null;
      } finally {
        setIsSaving(false);
      }
    },
    [orgId, router, markSaved],
  );

  // ── Autosave ──────────────────────────────────────────────────────────────
  // Subscribes outside React so an edit does not re-render the page component
  // just to reschedule a timer.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const unsubscribe = useBuilderStore.subscribe((state, previous) => {
      if (state.revision === previous.revision) return;
      // Only autosave forms that already exist; creating one implicitly on the
      // first keystroke would litter the list with abandoned drafts.
      if (!formIdRef.current || !state.isDirty) return;

      clearTimeout(timer);
      timer = setTimeout(() => void save({ silent: true }), AUTOSAVE_DELAY_MS);
    });

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [save]);

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
      const id = await save({ silent: true });
      if (!id) return;

      const form = selectFormConfig(useBuilderStore.getState());
      await fetchApi(`/organizations/${orgId}/forms/${id}/publish`, {
        method: 'POST',
        body: JSON.stringify({
          pages: form.pages,
          questions: form.questions,
          logic: form.logic,
          theme: form.theme,
        }),
      });

      const wasPublished = state.status === 'PUBLISHED';
      markPublished();
      toast.success(wasPublished ? 'New version published' : 'Your form is live');
    } catch (error: any) {
      toast.error(error?.message ?? 'Could not publish this form');
    } finally {
      setIsPublishing(false);
    }
  }, [orgId, save, markPublished]);

  // ── Unsaved-changes guard ─────────────────────────────────────────────────
  useEffect(() => {
    if (!meta.isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [meta.isDirty]);

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
        void save();
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
  }, [save]);

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

  // ── Adapters for the panels that still take (form, setForm) ───────────────
  const formSnapshot = useMemo(
    () => selectFormConfig(useBuilderStore.getState()),
    // Recomputed whenever the document changes; these panels are not on the
    // typing hot path, so a whole-document snapshot is fine here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meta.isDirty, meta.activeView, isThemeOpen, isPreviewOpen, order.length],
  );

  const setFormAdapter = useCallback<React.Dispatch<React.SetStateAction<FormConfig>>>((action) => {
    const state = useBuilderStore.getState();
    const current = selectFormConfig(state);
    const next = typeof action === 'function' ? action(current) : action;

    if (next.theme !== current.theme) state.setTheme(next.theme);
    if (next.logic !== current.logic) state.setLogic(next.logic);
    if (next.title !== current.title) state.setTitle(next.title);
    if (next.description !== current.description) state.setDescription(next.description);
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
        onOpenTheme={() => setIsThemeOpen(true)}
        onOpenLogic={() => setActiveView(meta.activeView === 'LOGIC' ? 'BUILDER' : 'LOGIC')}
        hasUnsavedChanges={meta.isDirty}
        onSaveChanges={() => void save()}
        onToggleLeftPanel={() => setIsLeftPanelOpen(true)}
        onPublish={() => void publish()}
        isPublishing={isPublishing}
        isSaving={isSaving}
        status={meta.status}
        hasUnpublishedChanges={meta.hasUnpublishedChanges}
        publicUrl={meta.slug ? `/f/${meta.slug}` : null}
        lastSavedAt={lastSavedAt}
      />

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
              addQuestion(type);
              setIsLeftPanelOpen(false);
            }}
            onAddPage={addPage}
            onClose={() => setIsLeftPanelOpen(false)}
          />
        </div>

        <main id="main-content" className="relative flex-1 overflow-y-auto bg-muted/25">
          {meta.activeView === 'LOGIC' ? (
            <LogicBuilder form={formSnapshot} setForm={setFormAdapter} />
          ) : (
            <div className="mx-auto max-w-3xl space-y-5 p-4 pb-24 sm:p-6 lg:p-8">
              <Card className="space-y-3 p-5">
                <Input
                  value={meta.title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-label="Form title"
                  placeholder="Form title"
                  className="h-auto rounded-none border-0 bg-transparent px-0 text-xl font-semibold shadow-none
                             focus-visible:border-b-2 focus-visible:border-foreground/30 focus-visible:ring-0"
                />
                <FormDescriptionInput onChange={setDescription} />
              </Card>

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
                  <Button onClick={() => addQuestion('SHORT_TEXT')} className="gap-2">
                    <Plus className="size-4" />
                    Add your first question
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
                  <SortableContext items={order} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                      {order.map((id, index) => (
                        <EnterpriseFieldCard key={id} id={id} index={index} />
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

              {order.length > 0 && (
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
        {isPreviewOpen && (
          <FormRunner
            form={formSnapshot}
            onSubmitResponse={() => {
              toast.success('Preview submission — no data was stored.');
            }}
          />
        )}
      </Modal>

      {/* ── Theme ───────────────────────────────────────────────────────── */}
      <Modal
        open={isThemeOpen}
        onOpenChange={setIsThemeOpen}
        size="lg"
        title="Theme and styling"
        description="Applies to the public form your respondents see."
        footer={
          <Button size="sm" onClick={() => setIsThemeOpen(false)}>
            Done
          </Button>
        }
      >
        {isThemeOpen && <ThemeCustomizer form={formSnapshot} setForm={setFormAdapter} />}
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
                    const newId = addQuestion(
                      item.type,
                      useBuilderStore.getState().selectedQuestionId,
                    );
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

/**
 * The description field keeps its value locally and pushes to the store on a
 * debounce. Unlike the title (which the navbar mirrors live) nothing else
 * displays it, so there is no reason for each keystroke to touch global state.
 */
function FormDescriptionInput({ onChange }: { onChange: (value: string) => void }) {
  const initial = useBuilderStore.getState().description;
  const [value, setValue] = useState(initial);

  useEffect(() => {
    if (value === useBuilderStore.getState().description) return;
    const timer = setTimeout(() => onChange(value), 250);
    return () => clearTimeout(timer);
  }, [value, onChange]);

  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      aria-label="Form description"
      placeholder="Add a short description (optional)"
      className="rounded-none border-0 bg-transparent px-0 text-sm text-muted-foreground shadow-none
                 focus-visible:border-b focus-visible:border-border-strong focus-visible:ring-0"
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
