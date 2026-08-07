'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Eye,
  Palette,
  Save,
  Check,
  Menu,
  GitFork,
  Rocket,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export type FormStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'CLOSED';

interface EnterpriseNavbarProps {
  formTitle: string;
  onTitleChange: (newTitle: string) => void;
  onPreview: () => void;
  onOpenTheme: () => void;
  onOpenLogic: () => void;
  hasUnsavedChanges: boolean;
  onSaveChanges: () => void;
  onToggleLeftPanel?: () => void;
  /** Publish creates an immutable FormVersion — without it the form is not
   *  reachable at its public URL and cannot accept submissions. */
  onPublish: () => void;
  isPublishing?: boolean;
  isSaving?: boolean;
  status?: FormStatus;
  /** True when the draft has changed since the last publish. */
  hasUnpublishedChanges?: boolean;
  publicUrl?: string | null;
  /** Timestamp of the last successful autosave, for the "Saved" affordance. */
  lastSavedAt?: Date | null;
}

export function EnterpriseNavbar({
  formTitle,
  onTitleChange,
  onPreview,
  onOpenTheme,
  onOpenLogic,
  hasUnsavedChanges,
  onSaveChanges,
  onToggleLeftPanel,
  onPublish,
  isPublishing = false,
  isSaving = false,
  status = 'DRAFT',
  hasUnpublishedChanges = false,
  publicUrl,
  lastSavedAt = null,
}: EnterpriseNavbarProps) {
  const [isEditing, setIsEditing] = useState(false);
  const isPublished = status === 'PUBLISHED';

  return (
    <header className="w-full bg-background border-b border-border px-4 py-3 flex items-center justify-between shadow-sm">
      {/* Left: Breadcrumb & Inline Title Edit */}
      <div className="flex items-center gap-3">
        {onToggleLeftPanel && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleLeftPanel}
            className="md:hidden"
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}
        <Link href="/forms" title="Back to My Forms" className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'hidden md:flex' })}>
            <ArrowLeft className="h-4 w-4" />
        </Link>

        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <span>Form Builder</span>
          <span>/</span>
          {isEditing ? (
            <Input
              type="text"
              value={formTitle}
              onChange={(e) => onTitleChange(e.target.value)}
              onBlur={() => setIsEditing(false)}
              onKeyDown={(e) => e.key === 'Enter' && setIsEditing(false)}
              autoFocus
              className="h-8 px-2 py-1 w-48 text-sm font-semibold text-foreground bg-accent"
            />
          ) : (
            <span
              onClick={() => setIsEditing(true)}
              className="font-semibold text-foreground cursor-pointer hover:text-primary transition-colors"
              title="Click to rename form"
            >
              {formTitle}
            </span>
          )}

          {/* Publish state is the single most important thing to surface here:
              a DRAFT form 404s at its public URL and rejects all submissions. */}
          <Badge
            variant={isPublished ? 'default' : 'secondary'}
            className="ml-1 hidden sm:inline-flex"
          >
            {status === 'PUBLISHED' ? 'Live' : status === 'DRAFT' ? 'Draft' : status}
          </Badge>

          {isPublished && hasUnpublishedChanges && (
            <span
              className="hidden text-xs font-medium text-warning lg:inline"
              title="Your saved edits are not yet live. Publish to update the public form."
            >
              • Unpublished changes
            </span>
          )}

          {/* Autosave is silent by design; without a timestamp the user has no
              way to tell whether their work is safe. */}
          {!hasUnsavedChanges && lastSavedAt && (
            <span
              className="hidden text-xs text-muted-foreground xl:inline"
              title={lastSavedAt.toLocaleString()}
            >
              Saved {lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* Right Actions: Theme, Preview, Save */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenLogic}
          title="Conditional Logic"
          className="gap-2"
        >
          <GitFork className="h-4 w-4" />
          <span className="hidden md:inline">Logic</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onOpenTheme}
          title="Theme & Styling Options"
          className="gap-2"
        >
          <Palette className="h-4 w-4" />
          <span className="hidden md:inline">Theme</span>
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={onPreview}
          className="gap-2"
        >
          <Eye className="h-4 w-4" />
          <span className="hidden md:inline">Preview</span>
        </Button>

        {isPublished && publicUrl && (
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the live form"
            className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'gap-2' })}
          >
            <ExternalLink className="h-4 w-4" />
            <span className="hidden lg:inline">View live</span>
          </a>
        )}

        <Button
          variant={hasUnsavedChanges ? 'outline' : 'secondary'}
          size="sm"
          onClick={onSaveChanges}
          disabled={isSaving || !hasUnsavedChanges}
          className="gap-2"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : hasUnsavedChanges ? (
            <Save className="h-4 w-4" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          <span className="hidden md:inline">
            {isSaving ? 'Saving…' : hasUnsavedChanges ? 'Save Draft' : 'Saved'}
          </span>
        </Button>

        {/* THE missing action. Saving only writes the draft columns; until this
            runs, no FormVersion exists, so the public page 404s and the
            submission worker has nothing to bind answers to. */}
        <Button
          variant="default"
          size="sm"
          onClick={onPublish}
          disabled={isPublishing}
          className="gap-2"
          title={
            isPublished
              ? 'Publish a new version of this form'
              : 'Make this form live at its public URL'
          }
        >
          {isPublishing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Rocket className="h-4 w-4" />
          )}
          <span className="hidden md:inline">
            {isPublishing ? 'Publishing…' : isPublished ? 'Republish' : 'Publish'}
          </span>
        </Button>
      </div>
    </header>
  );
}
