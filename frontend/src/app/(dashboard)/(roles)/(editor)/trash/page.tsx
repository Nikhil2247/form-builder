'use client';

import React from 'react';
import { Trash2, RotateCcw, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTrashedForms, useRestoreForm } from '@/hooks/use-forms';
import { useUser } from '@/hooks/use-auth';
import { toast } from 'sonner';

export default function TrashPage() {
  const { data: session } = useUser();
  const orgId = session?.activeOrganization?.id;

  const { data: forms, isLoading } = useTrashedForms();
  const restoreMutation = useRestoreForm();

  const handleRestore = (id: string) => {
    restoreMutation.mutate(id, {
      onSuccess: () => {
        toast.success('Form restored successfully');
      },
      onError: (err: any) => {
        toast.error(err.message || 'Failed to restore form');
      }
    });
  };

  return (
    <div className="w-full space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Trash2 className="text-muted-foreground" size={24} />
            Trash
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Deleted forms are kept here for 30 days before permanent removal.</p>
        </div>
      </div>

      <div className="space-y-4">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="font-medium text-muted-foreground">Form Name</TableHead>
              <TableHead className="font-medium text-muted-foreground">Deleted On</TableHead>
              <TableHead className="font-medium text-muted-foreground">Status</TableHead>
              <TableHead className="text-right font-medium text-muted-foreground">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : forms && forms.length > 0 ? (
              forms.map((form) => (
                <TableRow key={form.id}>
                  <TableCell className="font-medium">{form.title}</TableCell>
                  <TableCell>{new Date(form.deletedAt!).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-destructive border-destructive">Deleted</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRestore(form.id)}
                      disabled={restoreMutation.isPending}
                      className="text-primary hover:text-primary/90"
                    >
                      <RotateCcw size={16} className="mr-2" />
                      Restore
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-12">
                  <div className="flex flex-col items-center justify-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                      <Trash2 size={20} className="text-muted-foreground opacity-50" />
                    </div>
                    <p>Trash is empty.</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
