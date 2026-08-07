'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useFormSubmissions } from '@/hooks/use-submissions';
import { useForm } from '@/hooks/use-forms';
import { SubmissionsView } from '@/components/builder/SubmissionsView';

export default function FormSubmissionsPage() {
  const params = useParams();
  const router = useRouter();
  const formId = params.formId as string;

  const { data: formData, isLoading: formLoading } = useForm(formId);
  const { data: submissionsRes, isLoading: subLoading } = useFormSubmissions(formId);

  const submissions = submissionsRes?.data ?? submissionsRes?.submissions ?? [];
  const form = formData?.form ?? formData;

  const submissions = data?.data ?? [];

  if (formLoading || subLoading) {
    return (
      <div className="w-full space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!form) {
    return <div className="text-center p-8 text-destructive">Form not found.</div>;
  }

  return (
    <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <Button variant="ghost" size="icon" onClick={() => router.push(`/forms/${formId}`)} className="h-8 w-8 shrink-0">
          <ChevronLeft size={16} />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{form.title} - Submissions</h1>
        </div>
      </div>

      <SubmissionsView form={form} submissions={submissions} />
    </div>
  );
}
