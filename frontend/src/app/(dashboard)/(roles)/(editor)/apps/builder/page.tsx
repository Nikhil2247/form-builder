'use client';

import React, { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  BarChart3,
  Boxes,
  ExternalLink,
  ListOrdered,
  Loader2,
  Plus,
  Save,
  Settings2,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ButtonLink,
  EmptyState,
  ErrorState,
  ForbiddenState,
  Modal,
  PageHeader,
  PageShell,
} from '@/components/shared';
import { DataAppsDisabled } from '@/components/apps/DataAppsGate';
import { AppSettingsPanel } from '@/components/apps/AppSettingsPanel';
import { AppStepsDesigner } from '@/components/apps/AppStepsDesigner';
import { PhonePreview } from '@/components/apps/PhonePreview';
import { PhoneAppSimulator } from '@/components/apps/PhoneAppSimulator';
import { usePermissions } from '@/hooks/use-auth';
import { FEATURES, useFeature } from '@/hooks/use-features';
import { useForms } from '@/hooks/use-forms';
import { useSubjectTypes } from '@/hooks/use-subjects';
import {
  toAppConfig,
  useCreateFormApp,
  useFormApp,
  useUpdateAppSettings,
  useUpdateFormApp,
  type CardSource,
  type DashboardCardConfig,
  type FormAppDetail,
} from '@/hooks/use-form-apps';

const NONE = '__none__';

const SOURCE_OPTIONS: { value: CardSource; label: string }[] = [
  { value: 'subjects', label: 'Records' },
  { value: 'submissions', label: 'Responses' },
];

/**
 * Configure a data-entry app.
 *
 * The app is configuration, not code: a record type, an ordered list of STEPS,
 * and a set of declarative dashboard cards. Everything the author picks here is
 * reflected in the phone frame beside the form, because the app is used on a
 * 390pt screen and authored on a 1400px one — without the frame it is very easy
 * to configure eight dashboard cards that no field worker will ever scroll past.
 *
 * ── Two save models on one page, deliberately ──────────────────────────────
 * The basics and the dashboard cards are fields on one row, so they batch
 * behind the save button. Steps and settings are not: a step is a row whose key
 * is referenced by conditions and by staged session entries, and the public
 * slug is unique platform-wide. Both write through immediately, which is why
 * the step designer has no save button of its own and the settings dialog says
 * it saves automatically — exactly like the form settings panel.
 *
 * `?id=<appId>` edits an existing app; without it the page creates a new one,
 * matching the form builder's convention.
 */
export default function AppBuilderPage() {
  return (
    <React.Suspense
      fallback={
        <PageShell>
          <PageHeader isLoading title="" />
          <Skeleton className="h-96 rounded-xl" />
        </PageShell>
      }
    >
      <AppBuilderRoute />
    </React.Suspense>
  );
}

/**
 * `useSearchParams` opts the subtree into client-side rendering, and Next
 * requires that boundary to be explicit — see the form builder, which wraps the
 * same way.
 */
function AppBuilderRoute() {
  const appsEnabled = useFeature(FEATURES.FORM_APPS);
  const { can, isLoading: permissionsLoading } = usePermissions();
  const searchParams = useSearchParams();
  const appId = searchParams.get('id') ?? undefined;

  const app = useFormApp(appId, { enabled: appsEnabled });

  if (!appsEnabled) return <DataAppsDisabled title="App builder" />;

  // The (editor) layout already gates the route; this is the same check stated
  // in terms of the capability the page actually needs, so a permission matrix
  // change cannot leave a save button on screen that the API will reject.
  if (!permissionsLoading && !can('form:create')) {
    return (
      <ForbiddenState
        title="You have read-only access"
        description="Configuring a data-entry app requires the Editor or Admin role in this organization."
      />
    );
  }

  if (app.error) {
    return (
      <PageShell>
        <ErrorState
          title="Could not load this app"
          error={app.error}
          onRetry={() => app.refetch()}
        />
      </PageShell>
    );
  }

  // The form seeds its fields from `app` in `useState`, so it must not mount
  // until the app has arrived. Copying server data into state from an effect
  // instead would render the whole builder once with empty fields and then
  // again with real ones — and would overwrite whatever the author had typed in
  // between, which is the classic way a builder eats an edit.
  if (appId && app.isLoading) {
    return (
      <PageShell>
        <PageHeader isLoading title="" />
        <Skeleton className="h-96 rounded-xl" />
      </PageShell>
    );
  }

  return <AppBuilderForm key={app.data?.id ?? 'new'} appId={appId} app={app.data} />;
}

// ─────────────────────────────────────────────────────────────────────────────

function AppBuilderForm({
  appId,
  app,
}: {
  appId: string | undefined;
  app: FormAppDetail | undefined;
}) {
  const router = useRouter();

  const subjectTypes = useSubjectTypes();
  const forms = useForms({ limit: 100, status: 'PUBLISHED' });

  const createApp = useCreateFormApp();
  const updateApp = useUpdateFormApp();
  const updateSettings = useUpdateAppSettings();

  const seed = toAppConfig(app?.config);

  const [name, setName] = useState(app?.name ?? '');
  const [description, setDescription] = useState(app?.description ?? '');
  const [icon, setIcon] = useState(app?.icon ?? '');
  const [subjectTypeId, setSubjectTypeId] = useState<string>(
    app?.subjectType?.id ?? app?.subjectTypeId ?? NONE,
  );
  const [cards, setCards] = useState<DashboardCardConfig[]>(seed.dashboardCards);
  const [isSettingsOpen, setSettingsOpen] = useState(false);

  const publishedForms = useMemo(() => forms.data?.forms ?? [], [forms.data]);
  const steps = useMemo(() => app?.steps ?? [], [app]);

  // The forms an app actually opens, deduplicated: the same form is legitimately
  // two steps, and a card filter offering it twice is just noise.
  const stepForms = useMemo(() => {
    const seen = new Map<string, { id: string; title: string }>();
    for (const step of steps) {
      if (step.form && !seen.has(step.formId)) {
        seen.set(step.formId, { id: step.formId, title: step.form.title });
      }
    }
    return [...seen.values()];
  }, [steps]);

  const subjectType = (subjectTypes.data ?? []).find((type) => type.id === subjectTypeId);
  const isEditing = !!appId;
  const isSaving = createApp.isPending || updateApp.isPending;
  const canSave = !!name.trim() && subjectTypeId !== NONE && !isSaving;

  function updateCard(index: number, patch: Partial<DashboardCardConfig>) {
    setCards((current) =>
      current.map((card, i) => (i === index ? { ...card, ...patch } : card)),
    );
  }

  async function handleSave() {
    if (!canSave) return;

    const config = {
      dashboardCards: cards
        .filter((card) => card.title.trim().length > 0)
        .map((card) => ({
          title: card.title.trim(),
          source: card.source,
          ...(card.filter && (card.filter.createdWithinDays || card.filter.formId)
            ? {
                filter: {
                  ...(card.filter.createdWithinDays
                    ? { createdWithinDays: card.filter.createdWithinDays }
                    : {}),
                  ...(card.filter.formId && card.source === 'submissions'
                    ? { formId: card.filter.formId }
                    : {}),
                },
              }
            : {}),
        })),
    };

    try {
      if (appId) {
        await updateApp.mutateAsync({
          appId,
          name: name.trim(),
          description: description.trim(),
          icon: icon.trim(),
          // `isPublished` is deliberately absent: it lives in the settings
          // dialog, which writes it through on toggle. Sending it from here as
          // well would let a stale copy in this form undo a change made there.
          config,
        });
        toast.success('App saved');
      } else {
        const created = await createApp.mutateAsync({
          name: name.trim(),
          subjectTypeId,
          description: description.trim() || undefined,
          icon: icon.trim() || undefined,
          config,
        });
        toast.success(`Created "${created.name}"`);
        // Stay in the builder, now bound to the new app, so the author can keep
        // configuring without losing what they just typed.
        router.replace(`/apps/builder?id=${created.id}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save this app');
    }
  }

  const noRecordTypes = !subjectTypes.isLoading && (subjectTypes.data ?? []).length === 0;

  return (
    <PageShell>
      <PageHeader
        back="/apps"
        breadcrumbs={[
          { label: 'Apps', href: '/apps' },
          { label: isEditing ? 'Configure' : 'New app' },
        ]}
        title={isEditing ? name || 'Configure app' : 'New app'}
        description="Pick a record type, lay out the steps your team works through, and define the dashboard."
        actions={
          <>
            {isEditing && app?.publicSlug && app.isPublished && (
              <ButtonLink
                variant="ghost"
                size="sm"
                className="gap-2"
                href={`/a/${app.publicSlug}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="size-4" />
                Public link
              </ButtonLink>
            )}
            {isEditing && (
              <ButtonLink variant="outline" size="sm" href={`/apps/${appId}`}>
                Open app
              </ButtonLink>
            )}
            {isEditing && app && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings2 className="size-4" />
                Settings
              </Button>
            )}
            <Button size="sm" className="gap-2" onClick={handleSave} disabled={!canSave}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {isEditing ? 'Save changes' : 'Create app'}
            </Button>
          </>
        }
      />

      {/* ── Settings ──────────────────────────────────────────────────────── */}
      {/* Same modal, same size and the same "saves automatically" contract as
          the form settings panel — an author who has set up a form already
          knows what this button does. */}
      {isEditing && app && (
        <Modal
          open={isSettingsOpen}
          onOpenChange={setSettingsOpen}
          size="md"
          title="App settings"
          description="Design, public link, access and reporting periods. Saved automatically."
          footer={
            <Button size="sm" onClick={() => setSettingsOpen(false)}>
              Done
            </Button>
          }
        >
          {isSettingsOpen && <AppSettingsPanel app={app} />}
        </Modal>
      )}

      {noRecordTypes ? (
        <EmptyState
          icon={Boxes}
          title="Create a record type first"
          description="An app is a data-entry surface over one record type, so there has to be a record type before there can be an app."
          action={
            <ButtonLink size="sm" href="/record-types">
              Manage record types
            </ButtonLink>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-6">
            {/* ── Basics ───────────────────────────────────────────────── */}
            <Card className="space-y-4 p-5">
              <div>
                <h2 className="text-sm font-semibold">Basics</h2>
                <p className="text-xs text-muted-foreground">
                  What this app is called and which records it works with.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_6rem]">
                <div className="space-y-1.5">
                  <Label htmlFor="app-name">Name</Label>
                  <Input
                    id="app-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Household visits"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="app-icon">Icon</Label>
                  <Input
                    id="app-icon"
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    placeholder="🏠"
                    maxLength={4}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="app-description">Description</Label>
                <Textarea
                  id="app-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Shown under the app name in the list."
                  rows={2}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Record type</Label>
                <Select
                  value={subjectTypeId}
                  onValueChange={(value) => setSubjectTypeId((value as string) ?? NONE)}
                  disabled={isEditing}
                >
                  <SelectTrigger className="w-full" aria-label="Record type">
                    <SelectValue placeholder="Choose a record type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Choose a record type</SelectItem>
                    {(subjectTypes.data ?? []).map((type) => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {isEditing
                    ? 'The record type is fixed once an app exists — its records and dashboard are already scoped to it.'
                    : 'This cannot be changed after the app is created.'}
                </p>
              </div>

              {isEditing && app && (
                <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
                  <div>
                    <Label htmlFor="app-published">Live</Label>
                    <p className="text-xs text-muted-foreground">
                      A draft app stays visible to editors but is not offered for data entry, and
                      its public link returns nothing.
                    </p>
                  </div>
                  {/* Mirrors the switch in the settings dialog and writes through
                      the same endpoint, so the two can never disagree. */}
                  <Switch
                    id="app-published"
                    checked={app.isPublished}
                    onCheckedChange={(checked) =>
                      updateSettings
                        .mutateAsync({ appId: app.id, isPublished: checked })
                        .catch((error: unknown) =>
                          toast.error(
                            error instanceof Error ? error.message : 'Could not change that',
                          ),
                        )
                    }
                  />
                </div>
              )}
            </Card>

            {/* ── Steps ────────────────────────────────────────────────── */}
            {forms.error ? (
              <Card className="p-5">
                <ErrorState error={forms.error} onRetry={() => forms.refetch()} variant="inline" />
              </Card>
            ) : !isEditing || !app ? (
              // Steps are rows keyed to an app id, so there is nothing to
              // attach them to until the app exists. Saying so beats an empty
              // designer that silently fails on the first "Add step".
              <Card className="p-5">
                <EmptyState
                  variant="inline"
                  icon={ListOrdered}
                  title="Create the app first"
                  description="Steps belong to a saved app. Press “Create app” and the step designer opens here."
                />
              </Card>
            ) : (
              <AppStepsDesigner
                appId={app.id}
                steps={steps}
                subjectTypeId={app.subjectTypeId}
                availableForms={publishedForms}
                registrationFormId={subjectType?.registrationFormId ?? null}
              />
            )}

            {/* ── Dashboard cards ──────────────────────────────────────── */}
            <Card className="space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Dashboard cards</h2>
                  <p className="text-xs text-muted-foreground">
                    Each card is a count, computed server-side from a fixed filter. Up to 12.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={cards.length >= 12}
                  onClick={() =>
                    setCards((current) => [...current, { title: '', source: 'subjects' }])
                  }
                >
                  <Plus className="size-3.5" /> Add card
                </Button>
              </div>

              {cards.length === 0 ? (
                <EmptyState
                  variant="inline"
                  icon={BarChart3}
                  title="No cards yet"
                  description="A card answers one question at a glance — “registered this month”, “visits this week”."
                />
              ) : (
                <ul className="space-y-3">
                  {cards.map((card, index) => (
                    <li
                      key={index}
                      className="space-y-3 rounded-lg border border-border p-3 sm:p-4"
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <Label htmlFor={`card-title-${index}`} className="text-xs">
                            Title
                          </Label>
                          <Input
                            id={`card-title-${index}`}
                            value={card.title}
                            onChange={(e) => updateCard(index, { title: e.target.value })}
                            placeholder="Registered this month"
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="mt-6 shrink-0 text-muted-foreground hover:text-destructive"
                          aria-label={`Remove card ${index + 1}`}
                          onClick={() =>
                            setCards((current) => current.filter((_, i) => i !== index))
                          }
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Counts</Label>
                          <Select
                            value={card.source}
                            onValueChange={(value) =>
                              updateCard(index, {
                                source: (value as CardSource) ?? 'subjects',
                                // A form filter is meaningless on a record count.
                                filter:
                                  value === 'subjects'
                                    ? { createdWithinDays: card.filter?.createdWithinDays }
                                    : card.filter,
                              })
                            }
                          >
                            <SelectTrigger className="w-full" aria-label="Card source">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {SOURCE_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor={`card-days-${index}`} className="text-xs">
                            Within last (days)
                          </Label>
                          <Input
                            id={`card-days-${index}`}
                            type="number"
                            min={1}
                            max={3650}
                            value={card.filter?.createdWithinDays ?? ''}
                            onChange={(e) => {
                              const parsed = Number(e.target.value);
                              updateCard(index, {
                                filter: {
                                  ...card.filter,
                                  createdWithinDays:
                                    e.target.value === '' || !Number.isFinite(parsed)
                                      ? undefined
                                      : parsed,
                                },
                              });
                            }}
                            placeholder="All time"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Form</Label>
                          <Select
                            value={card.filter?.formId ?? NONE}
                            onValueChange={(value) =>
                              updateCard(index, {
                                filter: {
                                  ...card.filter,
                                  formId: value === NONE ? undefined : ((value as string) ?? undefined),
                                },
                              })
                            }
                            disabled={card.source !== 'submissions' || stepForms.length === 0}
                          >
                            <SelectTrigger className="w-full" aria-label="Card form filter">
                              <SelectValue placeholder="Any form" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>Any form</SelectItem>
                              {stepForms.map((form) => (
                                <SelectItem key={form.id} value={form.id}>
                                  {form.title}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <aside className="hidden xl:block">
            <div className="sticky top-6">
              <PhonePreview label="Live preview — nothing is saved until you press save">
                <PhoneAppSimulator
                  name={name.trim() || 'Untitled app'}
                  icon={icon || null}
                  subjectTypeName={subjectType?.name ?? 'No record type'}
                  subjectTypeId={subjectTypeId === NONE ? null : subjectTypeId}
                  // One entry per STEP, not per form: a programme that collects
                  // the same form under two headings shows two rows on the
                  // device, and the preview exists to say exactly that.
                  forms={steps.map((step) => ({
                    id: step.id,
                    title: step.title,
                    slug: step.form?.slug ?? step.key,
                    subjectRole:
                      step.form?.subjectRole ??
                      (step.formId === subjectType?.registrationFormId
                        ? ('REGISTERS' as const)
                        : ('ATTACHES' as const)),
                    subjectTypeId: subjectTypeId === NONE ? null : subjectTypeId,
                  }))}
                  // Titles only. The counts come from the server once the card
                  // is saved, and inventing a number here would be exactly the
                  // fake demo data this app avoids elsewhere.
                  cards={cards.map((card) => ({
                    title: card.title.trim() || 'Untitled card',
                    value: undefined as unknown as number,
                  }))}
                  canLoadRecords={subjectTypeId !== NONE}
                />
              </PhonePreview>
            </div>
          </aside>
        </div>
      )}
    </PageShell>
  );
}
