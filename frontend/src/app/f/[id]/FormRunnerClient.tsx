'use client';

import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FormRunner } from '@/components/builder/FormRunner';
import { FormConfig } from '@/types/form';
import { Skeleton } from '@/components/ui/skeleton';
import { useSearchParams } from 'next/navigation';

async function fetchForm(slug: string): Promise<FormConfig> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100/v1'}/public-forms/${slug}`);
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
      fp = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
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
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100/v1'}/public-forms/${slug}/draft?fp=${fp}`);
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
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100/v1'}/public-forms/${slug}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint: fp, answers }),
      });
    } catch (e) {
      console.warn('Failed to save draft progress', e);
    }
  };

  if (!isReady || !formConfig) {
    return (
      <div className="flex flex-col space-y-4 max-w-3xl mx-auto p-4 sm:p-8 mt-10">
        <Skeleton className="h-12 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-64 w-full mt-8" />
      </div>
    );
  }

  // Unwrap data envelope if present
  const actualFormConfig = (formConfig as any).data ?? formConfig;
  
  // Extract the actual questions, pages, logic, and theme from the backend version snapshot
  const version = actualFormConfig.versions?.[0] || {};
  const parsedForm = {
    ...actualFormConfig,
    questions: version.questionsJson || [],
    pages: version.pagesJson || [],
    logic: version.logicJson || [],
    theme: version.themeJson || actualFormConfig.themeConfig || {},
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-3xl mx-auto p-4 sm:p-8">
      <FormRunner 
        form={parsedForm as any} 
        initialAnswers={prefilledAnswers} 
        onProgressSave={handleProgressSave}
        layoutMode={actualFormConfig.layoutMode || 'DOCUMENT'}
        onSubmitResponse={async (submission) => {
          try {
            await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100/v1'}/submissions/${actualFormConfig.id}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ answers: submission.answers, completionTimeMs: submission.completionTimeMs })
            });
            // Clear draft after successful submission
            const fp = getFingerprint();
            if (fp) localStorage.removeItem(`draft_${slug}`);
          } catch (e) {
            console.error('Failed to submit form', e);
          }
        }}
      />
    </div>
  );
}
