'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Eye,
  Save,
  Check,
  CloudOff,
  LayoutGrid,
  Menu,
  GitFork,
  Rocket,
  Loader2,
  ExternalLink,
  Settings,
  TriangleAlert,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { SaveStatus } from '@/hooks/use-form-autosave';

export type FormStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'CLOSED';

export type BuilderView = 'BUILDER' | 'LOGIC';

interface EnterpriseNavbarProps {
  formTitle: string;
  onTitleChange: (newTitle: string) => void;
  onPreview: () => void;
  onOpenSettings: () => void;
  /** Which editor surface is showing. */
  activeView: BuilderView;
  onChangeView: (view: BuilderView) => void;
  /** Shown on the Logic tab so the count is visible without switching to it. */
  logicRuleCount?: number;
  onSaveChanges: () => void;
  onToggleLeftPanel?: () => void;
  /** Publish creates an immutable FormVersion — without it the form is not
   *  reachable at its public URL and cannot accept submissions. */
  onPublish: () => void;
  isPublishing?: boolean;
  /** Autosave state. Drives the whole save affordance. */
  saveStatus: SaveStatus;
  saveError?: string | null;
  status?: FormStatus;
  /** True when the draft has changed since the last publish. */
  hasUnpublishedChanges?: boolean;
  publicUrl?: string | null;
  /** Timestamp of the last successful autosave, for the "Saved" affordance. */
  lastSavedAt?: Date | null;
}

/**
 * Autosave indicator.
 *
 * Saving is silent and continuous, so this is the only thing telling the user
 * whether their work is safe. It has to distinguish "not written yet, but it
 * will be" from "not written, and it is not going to be without help" — the
 * previous single `isSaving` boolean collapsed a failed save, a queued save and
 * a completed save into the same "Saved" pill.
 */
function SaveIndicator({
  saveStatus,
  saveError,
  lastSavedAt,
}: {
  saveStatus: SaveStatus;
  saveError?: string | null;
  lastSavedAt: Date | null;
}) {
  const savedTime = lastSavedAt
    ? lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  const view: { icon: React.ElementType; label: string; className: string; title?: string } =
    {
      saving: { icon: Loader2, label: 'Saving…', className: 'text-muted-foreground' },
      unsaved: { icon: Save, label: 'Unsaved changes', className: 'text-muted-foreground' },
      saved: {
        icon: Check,
        label: savedTime ? `Saved ${savedTime}` : 'Saved',
        className: 'text-muted-foreground',
        title: lastSavedAt?.toLocaleString(),
      },
      retrying: {
        icon: CloudOff,
        label: 'Reconnecting…',
        className: 'text-warning',
        title: saveError ?? 'The last save failed. Retrying automatically.',
      },
      offline: {
        icon: CloudOff,
        label: 'Offline',
        className: 'text-warning',
        title: 'Your changes are kept here and will save when the connection returns.',
      },
      conflict: {
        icon: TriangleAlert,
        label: 'Not saving',
        className: 'text-destructive',
        title: saveError ?? 'This form changed elsewhere.',
      },
      error: {
        icon: TriangleAlert,
        label: 'Not saved',
        className: 'text-destructive',
        title: saveError ?? 'This form could not be saved.',
      },
      idle: { icon: Check, label: '', className: 'text-muted-foreground' },
    }[saveStatus];

  if (!view.label) return null;
  const Icon = view.icon;

  return (
    <span
      role="status"
      aria-live="polite"
      title={view.title}
      className={cn('hidden items-center gap-1.5 text-xs lg:inline-flex', view.className)}
    >
      <Icon className={cn('size-3.5', saveStatus === 'saving' && 'animate-spin')} />
      {view.label}
    </span>
  );
}

/**
 * Build / Logic switcher.
 *
 * This was a single "Logic" button that toggled `activeView`. It rendered
 * identically in both states, so once you were on the logic canvas nothing on
 * screen indicated which view you were in or that the same button was the way
 * back — the only exit was the browser's back button, which left the builder
 * entirely. A segmented control makes the current surface visible and the other
 * one reachable, which is what a toggle needed to be all along.
 */
function ViewSwitcher({
  activeView,
  onChangeView,
  logicRuleCount = 0,
}: {
  activeView: BuilderView;
  onChangeView: (view: BuilderView) => void;
  logicRuleCount?: number;
}) {
  const tabs: Array<{ value: BuilderView; label: string; icon: React.ElementType }> = [
    { value: 'BUILDER', label: 'Build', icon: LayoutGrid },
    { value: 'LOGIC', label: 'Logic', icon: GitFork },
  ];

  return (
    <div
      role="tablist"
      aria-label="Editor view"
      className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeView === tab.value;

        return (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChangeView(tab.value)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{tab.label}</span>
            {tab.value === 'LOGIC' && logicRuleCount > 0 && (
              <span className="tabular ml-0.5 rounded bg-foreground/10 px-1 text-[10px] font-semibold">
                {logicRuleCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function EnterpriseNavbar({
  formTitle,
  onTitleChange,
  onPreview,
  onOpenSettings,
  activeView,
  onChangeView,
  logicRuleCount,
  onSaveChanges,
  onToggleLeftPanel,
  onPublish,
  isPublishing = false,
  saveStatus,
  saveError,
  status = 'DRAFT',
  hasUnpublishedChanges = false,
  publicUrl,
  lastSavedAt = null,
}: EnterpriseNavbarProps) {
  const [isEditing, setIsEditing] = useState(false);
  const isPublished = status === 'PUBLISHED';
  const isSaving = saveStatus === 'saving';
  const isSettled = saveStatus === 'saved' || saveStatus === 'idle';
  // A conflict means the server holds a newer copy. Saving is refused until the
  // user reloads, so the button must not look like it will do something.
  const isBlocked = saveStatus === 'conflict';

  return (
    // Three explicit tracks rather than `justify-between`: with the switcher in
    // the middle, space-between would let a long form title shove it off-centre.
    // `min-w-0` on the title track is what actually allows it to truncate.
    <header className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-border bg-background px-4 py-3 shadow-sm">
      {/* Left: Breadcrumb & Inline Title Edit */}
      <div className="flex min-w-0 items-center gap-3">
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

        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground">
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
              className="max-w-[16rem] cursor-pointer truncate font-semibold text-foreground transition-colors hover:text-primary"
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

          <SaveIndicator
            saveStatus={saveStatus}
            saveError={saveError}
            lastSavedAt={lastSavedAt}
          />
        </div>
      </div>

      {/* Centre track — reads as "where am I", not as another action. */}
      <ViewSwitcher
        activeView={activeView}
        onChangeView={onChangeView}
        logicRuleCount={logicRuleCount}
      />

      {/* Right actions.
          Five outline buttons of equal weight sat here — Logic, Theme,
          Settings, Preview, Save — and nothing distinguished a view switch
          from a dialog from a write. Logic became the segmented switcher on
          the left; Theme folded into Settings as its Design tab; what is left
          is one dialog, one preview, and the two actions that change something. */}
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenSettings}
          title="Design, access, limits and notifications"
          className="gap-2"
        >
          <Settings className="h-4 w-4" />
          <span className="hidden md:inline">Settings</span>
        </Button>

        <Button variant="ghost" size="sm" onClick={onPreview} className="gap-2">
          <Eye className="h-4 w-4" />
          <span className="hidden md:inline">Preview</span>
        </Button>

        {isPublished && publicUrl && (
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the live form"
            className={buttonVariants({ variant: 'ghost', size: 'icon-sm', className: 'shrink-0' })}
          >
            <ExternalLink className="h-4 w-4" />
            <span className="sr-only">View live form</span>
          </a>
        )}

        <div className="mx-0.5 h-5 w-px bg-border" aria-hidden />

        {/* Autosave covers the normal case, so this is a manual escape hatch:
            enabled whenever there is anything outstanding — including after a
            failure, which is exactly when someone reaches for it. */}
        <Button
          variant={isSettled ? 'secondary' : 'outline'}
          size="sm"
          onClick={onSaveChanges}
          disabled={isSaving || isSettled || isBlocked}
          title={
            isBlocked
              ? 'Reload first — this form changed elsewhere'
              : isSettled
                ? 'Everything is saved'
                : 'Save now'
          }
          className="gap-2"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isSettled ? (
            <Check className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          <span className="hidden md:inline">
            {isSaving ? 'Saving…' : isSettled ? 'Saved' : 'Save now'}
          </span>
        </Button>

        {/* THE missing action. Saving only writes the draft columns; until this
            runs, no FormVersion exists, so the public page 404s and the
            submission worker has nothing to bind answers to. */}
        <Button
          variant="default"
          size="sm"
          onClick={onPublish}
          disabled={isPublishing || isBlocked}
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
