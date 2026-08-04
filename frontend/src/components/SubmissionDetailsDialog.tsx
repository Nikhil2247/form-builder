import React from 'react';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface SubmissionDetailsDialogProps {
  submission: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SubmissionDetailsDialog({
  submission,
  open,
  onOpenChange,
}: SubmissionDetailsDialogProps) {
  if (!submission) return null;

  const answers = submission.answers || submission.data || {};
  const respondentName = submission.respondent 
    ? `${submission.respondent.firstName || ''} ${submission.respondent.lastName || ''}`.trim()
    : null;
  const email = submission.respondent?.email || submission.respondentEmail;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden bg-card border-border shadow-xl sm:rounded-2xl">
        <DialogHeader className="p-6 border-b border-border bg-muted/20">
          <DialogTitle className="text-xl">Submission Details</DialogTitle>
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <Badge variant="outline" className="bg-background">
              {respondentName ? `${respondentName} (${email})` : email || 'Anonymous'}
            </Badge>
            <Badge variant="outline" className="bg-background">
              {format(new Date(submission.submittedAt), 'MMM dd, yyyy HH:mm:ss')}
            </Badge>
            {submission.completionTimeMs && (
              <Badge variant="outline" className="bg-background">
                {Math.round(submission.completionTimeMs / 1000)}s to complete
              </Badge>
            )}
          </div>
        </DialogHeader>
        
        <ScrollArea className="flex-1 p-6">
          <div className="space-y-6">
            {Object.keys(answers).length > 0 ? (
              Object.entries(answers).map(([key, value]) => (
                <div key={key} className="space-y-2 border-b border-border/50 pb-5 last:border-0">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{key}</h4>
                  <div className="text-base text-foreground font-medium p-3 rounded-xl bg-muted/30 border border-border/50">
                    {typeof value === 'object' && value !== null 
                      ? <pre className="text-xs overflow-auto whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
                      : String(value) || <span className="text-muted-foreground italic">No answer provided</span>
                    }
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-10 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                No answer data found in this submission.
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
