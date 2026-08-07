'use client';

import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FormRunner, type RunnerLayoutMode } from '@/components/builder/FormRunner';
import { FormThemeScope, cardVariantClass } from '@/components/builder/FormThemeScope';
import { FormConfig, FormTheme } from '@/types/form';
import { Skeleton } from '@/components/ui/skeleton';
import { useSearchParams } from 'next/navigation';
import { API_BASE_URL } from '@/lib/config';
import { cn } from '@/lib/utils';
import { LogIn } from 'lucide-react';
import { formFontVariables } from './fonts';

/**
 * Single source of truth for the API origin.
 * The default was :3100 here while the backend defaults to :3000 — the two
 * never agreed out of the box.
 */


async function fetchForm(slug: string): Promise<FormConfig> {
  const res = await fetch(`${API_BASE_URL}/public-forms/${slug}`);
  if (!res.ok) throw new Error('Failed to fetch form');
  const json = await res.json();
  return json.data ?? json;
}

export function FormRunnerClient({ slug, initialData }: { slug: string, initialData: FormConfig }) {
  const { data: formConfig, isLoading, isError } = useQuery({
    queryKey: ['public-form', slug],
    queryFn: () => fetchForm(slug),
    initialData,
    staleTime: 5 * 60 * 1000,
  });
  
  const searchParams = useSearchParams();
  const [prefilledAnswers, setPrefilledAnswers] = useState<Record<string, any>>({});
  const [isReady, setIsReady] = useState(false);

  const getFingerprint = () => {
    if (typeof window === 'undefined') return '';
    let fp = localStorage.getItem('form_fingerprint');
    if (!fp) {
      // Was two Math.random() calls concatenated — not a fingerprint and not
      // even collision-resistant. crypto.randomUUID is available in every
      // browser that runs this app.
      fp =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem('form_fingerprint', fp);
    }
    return fp;
  };

  useEffect(() => {
    const initForm = async () => {
      if (!formConfig) return;

      const answers: Record<string, any> = {};

      // 1. Check for draft from backend
      const fp = getFingerprint();
      if (fp) {
        try {
          const res = await fetch(`${API_BASE_URL}/public-forms/${slug}/draft?fp=${fp}`);
          if (res.ok) {
            const json = await res.json();
            const draft = json.data ?? json;
            if (draft && draft.answers) {
              Object.assign(answers, draft.answers);
            }
          }
        } catch (e) {
          console.warn('Failed to load draft', e);
        }
      }

      // 2. Overwrite with searchParams (highest priority)
      if (searchParams) {
        searchParams.forEach((value, key) => {
          const q = formConfig.questions.find(
            q => q.id === key || q.label.toLowerCase() === key.toLowerCase()
          );
          if (q) {
            answers[q.id] = value;
          }
        });
      }

      setPrefilledAnswers(answers);
      setIsReady(true);
    };

    initForm();
  }, [formConfig, searchParams, slug]);

  if (isLoading && !formConfig) {
    return (
      <div className="space-y-6 bg-card p-8 rounded-2xl border border-border shadow-sm max-w-3xl mx-auto mt-8">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <div className="pt-8 space-y-4">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (isError || !formConfig) {
    return <div className="text-center p-8 text-destructive font-semibold mt-10">Error loading form.</div>;
  }

  if (!isReady) {
    return null; // wait for effect to process searchParams
  }

  const handleProgressSave = async (answers: Record<string, any>) => {
    try {
      const fp = getFingerprint();
      if (!fp) return;
      const res = await fetch(`${API_BASE_URL}/public-forms/${slug}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint: fp, answers }),
      });
    } catch (e) {
      console.warn('Failed to save draft progress', e);
    }
  };

  // Unwrap data envelope if present
  const actualFormConfig = (formConfig as any).data ?? formConfig;

  // The API now returns the active version already flattened (questions, pages,
  // logic, theme) plus formVersionId. Fall back to the old `versions[0]` shape
  // so a cached response from an older deploy still renders.
  const legacyVersion = actualFormConfig.versions?.[0];
  const parsedForm = {
    ...actualFormConfig,
    questions: actualFormConfig.questions ?? legacyVersion?.questionsJson ?? [],
    pages: actualFormConfig.pages ?? legacyVersion?.pagesJson ?? [],
    logic: actualFormConfig.logic ?? legacyVersion?.logicJson ?? [],
    theme: actualFormConfig.theme ?? legacyVersion?.themeJson ?? actualFormConfig.themeConfig ?? {},
  };

  const theme: FormTheme = parsedForm.theme ?? {};

  // PORTAL has no renderer; anything unrecognised falls back to the plain
  // document layout rather than rendering nothing.
  const layoutMode: RunnerLayoutMode = (['DOCUMENT', 'CONVERSATIONAL', 'GRID'] as const).includes(
    actualFormConfig.layoutMode,
  )
    ? actualFormConfig.layoutMode
    : 'DOCUMENT';

  const orgLogo = theme.logoUrl || actualFormConfig.organization?.logoUrl || null;

  return (
    <FormThemeScope
      theme={theme}
      className={cn('min-h-screen', formFontVariables)}
    >
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      {/* `requireAuth` is enforced at ingest: the API rejects a submission with
          no user attached. Saying so up front beats letting someone fill in
          twenty questions and then bounce off a 403 they cannot act on. */}
      {actualFormConfig.requireAuth && (
        <div
          role="status"
          className="mb-6 flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-border bg-card p-4 text-sm"
        >
          <LogIn className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-muted-foreground">
            This form only accepts responses from signed-in users.
          </span>
          <a
            href={`/login?next=${encodeURIComponent(`/f/${slug}`)}`}
            className="font-semibold text-primary underline underline-offset-4"
          >
            Sign in
          </a>
        </div>
      )}

      <FormRunner
        form={parsedForm as any}
        initialAnswers={prefilledAnswers}
        onProgressSave={handleProgressSave}
        layoutMode={layoutMode}
        requiresPassword={!!actualFormConfig.isPasswordProtected}
        header={
          <FormHeader
            title={parsedForm.title}
            description={parsedForm.description}
            coverImageUrl={theme.coverImageUrl}
            logoUrl={orgLogo}
            cardVariant={theme.cardVariant}
          />
        }
        onSubmitResponse={async (submission) => {
          const res = await fetch(`${API_BASE_URL}/forms/${actualFormConfig.id}/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              answers: submission.answers,
              completionTimeMs: submission.completionTimeMs,
              // Binds the answers to the exact schema the respondent saw, so a
              // publish mid-session cannot re-attribute them to a new version.
              formVersionId: actualFormConfig.formVersionId,
              // Bot trap — must stay empty for a real user.
              honeypot: (submission as any).honeypot ?? '',
              fingerprint: getFingerprint(),
              ...((submission as any).formPassword
                ? { formPassword: (submission as any).formPassword }
                : {}),
            }),
          });

          if (!res.ok) {
            const body = await res.json().catch(() => null);
            const raw = body?.error?.message ?? body?.message;
            const message = Array.isArray(raw) ? raw.join(', ') : raw;

            // Field-level issues from the server-side answer validator.
            const issues = body?.error?.issues ?? body?.issues;
            const err = new Error(message || 'Failed to submit form. Please try again.');
            (err as any).issues = issues;
            (err as any).status = res.status;
            throw err;
          }

          // Clear the server-side draft now that it has been submitted. The old
          // code removed a localStorage key (`draft_${slug}`) that was never
          // written, so drafts survived submission and reappeared on reload.
          const fp = getFingerprint();
          if (fp) {
            fetch(`${API_BASE_URL}/public-forms/${slug}/draft?fp=${encodeURIComponent(fp)}`, {
              method: 'DELETE',
            }).catch(() => undefined);
          }
        }}
      />
      </div>
    </FormThemeScope>
  );
}

/**
 * The form's masthead.
 *
 * `coverImageUrl` and `logoUrl` were editable in the theme panel, saved,
 * published and returned by the public endpoint — and never rendered anywhere,
 * so setting a cover image did nothing at all.
 */
function FormHeader({
  title,
  description,
  coverImageUrl,
  logoUrl,
  cardVariant,
}: {
  title: string;
  description?: string;
  coverImageUrl?: string;
  logoUrl?: string | null;
  cardVariant?: FormTheme['cardVariant'];
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[var(--radius)] bg-card',
        cardVariantClass(cardVariant),
      )}
    >
      {coverImageUrl && (
        // A plain <img>, not next/image: the URL is author-supplied and can
        // point at any host, which the image optimiser refuses to load unless
        // that host is in next.config's allowlist.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coverImageUrl}
          alt=""
          className="h-40 w-full object-cover sm:h-52"
          loading="eager"
        />
      )}

      <div className={cn('space-y-2 p-6', logoUrl && 'pt-0')}>
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            className={cn(
              'h-12 w-auto object-contain',
              // Overlaps the cover, the way a brand mark normally sits.
              coverImageUrl ? '-mt-9 rounded-lg bg-card p-1.5 shadow-sm' : 'mt-6',
            )}
          />
        )}
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}
