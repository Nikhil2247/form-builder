'use client';

import React, { useState } from 'react';
import { Database, Download, Search, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

import { useOrgSubmissions } from '@/hooks/use-submissions';
import { useUser } from '@/hooks/use-auth';
import { SubmissionDetailsDialog } from '@/components/SubmissionDetailsDialog';

export default function SubmissionsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedSubmission, setSelectedSubmission] = useState<any>(null);
  
  const { data: session } = useUser();
  const orgId = session?.activeOrganization?.id;

  const { data: submissionsData, isLoading } = useOrgSubmissions(page, 50);

  const handleExport = () => {
    toast.success('Export feature coming soon!');
  };

  return (
    <div className="w-full space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Database className="text-primary" size={24} /> 
            Submissions Explorer
          </h1>
          <p className="text-sm text-muted-foreground mt-1">View and export all form submissions across your organization.</p>
        </div>
        
        <Button onClick={handleExport} variant="outline" className="gap-2 bg-background">
          <Download size={16} />
          Export CSV
        </Button>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex gap-2 flex-1">
            <div className="relative w-full max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input 
                type="text" 
                placeholder="Search submissions..." 
                className="pl-8 h-9 text-xs bg-background"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button variant="outline" size="sm" className="h-9 gap-2">
              <Filter size={14} /> Filter
            </Button>
          </div>
        </div>

        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="font-medium text-muted-foreground">Form</TableHead>
              <TableHead className="font-medium text-muted-foreground">Respondent</TableHead>
              <TableHead className="font-medium text-muted-foreground">Submitted At</TableHead>
              <TableHead className="font-medium text-muted-foreground">Status</TableHead>
              <TableHead className="text-right font-medium text-muted-foreground">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                  Loading submissions...
                </TableCell>
              </TableRow>
            ) : submissionsData?.submissions && submissionsData.submissions.length > 0 ? (
              submissionsData.submissions.map((sub: any) => (
                <TableRow key={sub.id}>
                  <TableCell className="font-medium">{sub.form?.name || sub.formId}</TableCell>
                  <TableCell>
                    {sub.respondent 
                      ? `${sub.respondent.firstName} ${sub.respondent.lastName}` 
                      : sub.ipAddress || 'Anonymous'
                    }
                  </TableCell>
                  <TableCell>{new Date(sub.submittedAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-emerald-500 border-emerald-500/20 bg-emerald-500/10">
                      Completed
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedSubmission(sub)}>
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-12">
                  No submissions found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {!isLoading && submissionsData?.submissions?.length > 0 && (
          <div className="pt-2">
            {(() => {
              const totalItems = submissionsData?.pagination?.total ?? submissionsData.submissions.length;
              const totalPages = Math.ceil(totalItems / 50);
              return (
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious 
                        href="#" 
                        onClick={(e) => { e.preventDefault(); setPage(Math.max(1, page - 1)); }} 
                        className={page === 1 ? 'pointer-events-none opacity-50' : ''} 
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <span className="text-sm font-medium mx-2">Page {page} of {totalPages || 1}</span>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext 
                        href="#" 
                        onClick={(e) => { e.preventDefault(); setPage(Math.min(totalPages, page + 1)); }} 
                        className={page === totalPages || totalPages === 0 ? 'pointer-events-none opacity-50' : ''} 
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              );
            })()}
          </div>
        )}
      </div>

      <SubmissionDetailsDialog
        submission={selectedSubmission}
        open={!!selectedSubmission}
        onOpenChange={(open) => !open && setSelectedSubmission(null)}
      />
    </div>
  );
}
