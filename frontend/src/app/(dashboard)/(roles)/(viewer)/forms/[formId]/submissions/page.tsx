'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, Download, Search, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useFormSubmissions, useExportSubmissions } from '@/hooks/use-submissions';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { SubmissionDetailsDialog } from '@/components/SubmissionDetailsDialog';

export default function FormSubmissionsPage() {
  const params = useParams();
  const router = useRouter();
  const formId = params.formId as string;
  const [selectedSubmission, setSelectedSubmission] = useState<any>(null);

  const { data, isLoading } = useFormSubmissions(formId);
  const exportMutation = useExportSubmissions(formId);

  const submissions = data?.data ?? [];

  const handleExport = (format: 'csv' | 'json') => {
    exportMutation.mutate(format, {
      onSuccess: () => toast.success(`Exported as ${format.toUpperCase()}`),
      onError: () => toast.error('Failed to export submissions'),
    });
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/forms/${formId}`)} className="h-8 w-8 shrink-0">
            <ChevronLeft size={16} />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Form Submissions</h1>
            <p className="mt-1 text-sm text-muted-foreground">View and manage all responses for this form.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => handleExport('csv')} disabled={exportMutation.isPending || submissions.length === 0} className="gap-2">
            <Download size={14} /> Export CSV
          </Button>
        </div>
      </div>

      <Card className="rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between bg-muted/20">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search submissions..." className="h-9 pl-9 w-64 text-sm bg-background" />
          </div>
          <div className="text-sm text-muted-foreground">
            {submissions.length} total responses
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Respondent</TableHead>
              <TableHead>Submitted At</TableHead>
              <TableHead>Completion Time</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-6 w-16 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : submissions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <FileText size={24} className="text-muted-foreground/50" />
                    <p>No submissions found for this form.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              submissions.map((sub: any) => (
                <TableRow key={sub.id} className="group">
                  <TableCell className="font-medium">
                    {sub.respondentEmail || 'Anonymous'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {format(new Date(sub.submittedAt), 'MMM dd, yyyy HH:mm')}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {sub.completionTime ? `${sub.completionTime}s` : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setSelectedSubmission(sub)}>
                      View Data
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <SubmissionDetailsDialog
        submission={selectedSubmission}
        open={!!selectedSubmission}
        onOpenChange={(open) => !open && setSelectedSubmission(null)}
      />
    </div>
  );
}
