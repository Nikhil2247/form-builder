'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { Boxes, Contact, ExternalLink, FileBox, LayoutGrid, Settings2, UserPlus } from 'lucide-react';

import { Card } from '@/components/ui/card';
import {
  ButtonAnchor,
  ButtonLink,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  PageShell,
  RelativeTime,
  StatCard,
  StatGrid,
  StatusBadge,
  Toolbar,
  SearchInput,
  type DataTableColumn,
} from '@/components/shared';
import { formatCompact } from '@/components/shared/formatters';
import { Can } from '@/components/auth/RoleGuard';
import { DataAppsDisabled } from '@/components/apps/DataAppsGate';
import { DueThisPeriod } from '@/components/apps/DueThisPeriod';
import { PhonePreview } from '@/components/apps/PhonePreview';
import { PhoneAppSimulator } from '@/components/apps/PhoneAppSimulator';
import { FEATURES, useFeature } from '@/hooks/use-features';
import { usePagination } from '@/hooks/use-pagination';
import { useFormApp, useFormAppDashboard, type FormAppStep } from '@/hooks/use-form-apps';
import { useSubjects, type Subject } from '@/hooks/use-subjects';

/**
 * One data-entry app.
 *
 * Three things a field worker needs on landing, in this order: how the caseload
 * looks right now (the cards), a way to find an existing record (search), and a
 * way to add a new one (register). Everything else is secondary.
 */
export default function AppDetailPage() {
  const params = useParams<{ appId: string }>();
  const appId = params.appId;

  const appsEnabled = useFeature(FEATURES.FORM_APPS);
  const pager = usePagination();

  const app = useFormApp(appId, { enabled: appsEnabled });
  const dashboard = useFormAppDashboard(appId, { enabled: appsEnabled });

  const subjectTypeId = app.data?.subjectType?.id;
  const records = useSubjects(
    {
      page: pager.page,
      limit: pager.pageSize,
      subjectTypeId,
      search: pager.search,
    },
    { enabled: appsEnabled && !!subjectTypeId },
  );

  if (!appsEnabled) return <DataAppsDisabled title="App" />;

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

  if (!app.isLoading && !app.data) {
    return (
      <PageShell>
        <EmptyState
          icon={LayoutGrid}
          title="App not found"
          description="It may have been deleted, or you may not have access to it."
          action={
            <ButtonLink size="sm" href="/apps">
              Back to apps
            </ButtonLink>
          }
        />
      </PageShell>
    );
  }

  const detail = app.data;
  const forms = detail?.forms ?? [];
  const steps = detail?.steps ?? [];

  // The registration form is the one that *creates* records. Prefer the form's
  // own role over the subject type's binding: config resolution already dropped
  // anything unpublished or deleted, so a form present here is one that can
  // actually be opened.
  const registrationForm =
    forms.find((form) => form.subjectRole === 'REGISTERS') ??
    forms.find((form) => form.id === detail?.subjectType?.registrationFormId);

  // The simulator wants the whole list in the author's order and works out the
  // roles itself, rather than being handed a pre-split pair.
  const appForms = forms;

  const totalRecords = records.data?.pagination?.total ?? 0;
  const cards = dashboard.data?.cards ?? [];

  const columns: DataTableColumn<Subject>[] = [
    {
      id: 'displayName',
      header: 'Record',
      isRowHeader: true,
      className: 'max-w-0',
      cell: (subject) => (
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Contact className="size-3.5" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{subject.displayName}</div>
            {subject.externalId && (
              <div className="truncate text-xs text-muted-foreground">{subject.externalId}</div>
            )}
          </div>
        </div>
      ),
    },
    {
      id: 'createdAt',
      header: 'Added',
      width: 'w-40',
      hideBelow: 'sm',
      cell: (subject) => (
        <span className="text-muted-foreground">
          <RelativeTime value={subject.createdAt} />
        </span>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        isLoading={app.isLoading}
        back="/apps"
        breadcrumbs={[{ label: 'Apps', href: '/apps' }, { label: detail?.name ?? '' }]}
        title={detail?.name ?? ''}
        description={detail?.description || undefined}
        badge={
          detail && (
            <StatusBadge
              status={detail.isPublished ? 'PUBLISHED' : 'DRAFT'}
              label={detail.isPublished ? 'Live' : 'Draft'}
              dot
            />
          )
        }
        actions={
          <>
            {/* The whole programme in one link. Offered ahead of the single
                registration form, because after Phase B that is how a
                respondent is meant to file — one session, one submit. */}
            {detail?.publicSlug && detail.isPublished && (
              <ButtonAnchor size="sm" className="gap-2" href={`/a/${detail.publicSlug}`} external>
                <ExternalLink className="size-4" /> Open the app
              </ButtonAnchor>
            )}
            {registrationForm && (
              <ButtonAnchor
                variant={detail?.publicSlug && detail.isPublished ? 'outline' : 'default'}
                size="sm"
                className="gap-2"
                href={`/f/${registrationForm.slug}`}
                external
              >
                <UserPlus className="size-4" /> Register a record
              </ButtonAnchor>
            )}
            <Can permission="form:create">
              <ButtonLink
                variant="outline"
                size="sm"
                className="gap-2"
                href={`/apps/builder?id=${appId}`}
              >
                <Settings2 className="size-4" /> Configure
              </ButtonLink>
            </Can>
          </>
        }
      />

      {dashboard.error ? (
        <ErrorState
          title="Could not load the dashboard"
          error={dashboard.error}
          onRetry={() => dashboard.refetch()}
          variant="panel"
        />
      ) : cards.length > 0 || dashboard.isLoading ? (
        <StatGrid>
          {dashboard.isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <StatCard key={i} label="" value="" isLoading />
              ))
            : cards.map((card, index) => (
                <StatCard
                  key={`${card.title}-${index}`}
                  label={card.title}
                  value={formatCompact(card.value)}
                  icon={Boxes}
                />
              ))}
        </StatGrid>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-6">
          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Records</h2>
              <span className="text-xs text-muted-foreground">
                {detail?.subjectType?.name ?? 'Record type'}
              </span>
            </div>

            <Toolbar>
              <SearchInput
                value={pager.search}
                onChange={pager.setSearch}
                placeholder="Search records…"
                aria-label="Search records"
              />
            </Toolbar>

            <DataTable
              caption={`Records in ${detail?.name ?? 'this app'}`}
              columns={columns}
              data={records.data?.subjects}
              getRowId={(subject) => subject.id}
              isLoading={records.isLoading || records.isFetching}
              error={records.error}
              onRetry={() => records.refetch()}
              rowHref={(subject) => `/records/${subject.id}`}
              skeletonRows={6}
              pagination={pager.paginationProps(totalRecords, 'records')}
              empty={
                <EmptyState
                  variant="inline"
                  icon={Contact}
                  title={pager.search ? 'No records match your search' : 'No records yet'}
                  description={
                    pager.search
                      ? 'Search matches the record name and its external id.'
                      : registrationForm
                        ? 'Register the first record to start building a history against it.'
                        : 'This app has no registration form yet, so records cannot be created from it.'
                  }
                  action={
                    registrationForm && !pager.search ? (
                      <ButtonAnchor
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        href={`/f/${registrationForm.slug}`}
                        external
                      >
                        <UserPlus className="size-3.5" /> Register a record
                      </ButtonAnchor>
                    ) : undefined
                  }
                />
              }
            />
          </section>

          {/* Above the step list, because it is the thing a data-entry worker
              opens this page to act on — the steps themselves are reference. */}
          <DueThisPeriod
            appId={appId}
            steps={steps}
            publicSlug={detail?.isPublished ? (detail?.publicSlug ?? null) : null}
          />

          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Steps</h2>
              <span className="text-xs text-muted-foreground">
                Filled in this order, submitted together
              </span>
            </div>

            {steps.length === 0 ? (
              <EmptyState
                variant="panel"
                icon={FileBox}
                title="No steps configured"
                description="An app is an ordered set of steps. Add the form that identifies the respondent first, then whatever they report."
                action={
                  <Can permission="form:create">
                    <ButtonLink variant="outline" size="sm" href={`/apps/builder?id=${appId}`}>
                      Configure the app
                    </ButtonLink>
                  </Can>
                }
              />
            ) : (
              <ol className="space-y-2">
                {steps.map((step, index) => (
                  <AppStepCard key={step.id} step={step} index={index} />
                ))}
              </ol>
            )}
          </section>
        </div>

        {/* The preview is authoring context, not content — it is the first thing
            to go when the viewport cannot hold both columns. */}
        <aside className="hidden xl:block">
          <PhonePreview label="Tap through it — this is live data, and read-only">
            <PhoneAppSimulator
              name={detail?.name ?? 'App'}
              icon={detail?.icon}
              subjectTypeName={detail?.subjectType?.name}
              subjectTypeId={detail?.subjectTypeId ?? detail?.subjectType?.id ?? null}
              forms={appForms}
              cards={cards}
              cardsLoading={dashboard.isLoading}
            />
          </PhonePreview>
        </aside>
      </div>
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * One step, as read-only summary.
 *
 * The "Open" link goes to the step's own form rather than into the app, because
 * that is what this page is for — checking what a step asks. Filing a report
 * happens through the app link in the header, in one session.
 */
function AppStepCard({ step, index }: { step: FormAppStep; index: number }) {
  const entries =
    step.mode === 'SINGLE'
      ? 'Filled once'
      : step.maxEntries === null
        ? `${step.minEntries}+ entries`
        : `${step.minEntries}–${step.maxEntries} entries`;

  return (
    <li>
      <Card className="flex flex-row items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="tabular flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
            {index + 1}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{step.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {step.form?.title ?? 'Unknown form'} · {entries}
              {step.isOptional ? ' · optional' : ''}
              {!step.isUsable ? ' · form not published' : ''}
            </p>
          </div>
        </div>
        {step.form?.slug && (
          <ButtonAnchor
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            href={`/f/${step.form.slug}`}
            external
          >
            <ExternalLink className="size-3.5" /> Open
          </ButtonAnchor>
        )}
      </Card>
    </li>
  );
}
