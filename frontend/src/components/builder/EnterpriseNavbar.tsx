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
  // Once live, "Republish" only means something when the draft has actually
  // moved since the last published version — otherwise it would ship a new
  // FormVersion that is byte-for-byte the one already public.
  const canPublish = !isPublished || hasUnpublishedChanges;

  /**
   * The save button doubles as the only save-status indicator — it used to be
   * duplicated by a second "Saved" pill next to the title. Distinguishing a
   * failed save from a queued one from a completed one is still the point
   * (see the old `SaveIndicator`), it just lives in one place now: no label at
   * all for the default "saved" case, since there is nothing to tell the user
   * that they don't already expect.
   */
  const savedTime = lastSavedAt
    ? lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  const saveView: { icon: React.ElementType; label: string | null; title: string; className?: string } =
    {
      saving: { icon: Loader2, label: 'Saving…', title: 'Saving your changes…' },
      unsaved: { icon: Save, label: 'Save now', title: 'Save now' },
      saved: {
        icon: Check,
        label: null,
        title: savedTime ? `Saved ${savedTime}` : 'Everything is saved',
      },
      idle: { icon: Check, label: null, title: 'Everything is saved' },
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
        title: 'Reload first — this form changed elsewhere',
      },
      error: {
        icon: TriangleAlert,
        label: 'Not saved',
        className: 'text-destructive',
        title: saveError ?? 'This form could not be saved.',
      },
    }[saveStatus];
  const SaveIcon = saveView.icon;

  return (
    // Flex-wrap rather than a fixed three-column grid: below `sm` the view
    // switcher drops to its own row (`order-3 w-full`) instead of squeezing the
    // title and actions into whatever width is left. At `sm` and up it returns
    // to its natural position between two equal-growth flex tracks, which is
    // what centres it without a long form title shoving it off-centre.
    <header className="flex w-full flex-wrap items-center gap-x-2 gap-y-2 border-b border-border bg-background px-3 py-2.5 shadow-sm sm:flex-nowrap sm:gap-x-3 sm:px-4 sm:py-3">
      {/* Left: Breadcrumb & Inline Title Edit */}
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
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
          {isEditing ? (
            <Input
              type="text"
              value={formTitle}
              onChange={(e) => onTitleChange(e.target.value)}
              onBlur={() => setIsEditing(false)}
              onKeyDown={(e) => e.key === 'Enter' && setIsEditing(false)}
              autoFocus
              className="h-8 w-36 px-2 py-1 text-sm font-semibold text-foreground bg-accent sm:w-48"
            />
          ) : (
            <span
              onClick={() => setIsEditing(true)}
              className="max-w-[9rem] cursor-pointer truncate font-semibold text-foreground transition-colors hover:text-primary sm:max-w-[16rem]"
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
        </div>
      </div>

      {/* Centre track — reads as "where am I", not as another action.
          `order-3 w-full` drops it to its own row on mobile so it never
          competes with the title or the actions for space; `sm:order-none
          sm:w-auto` restores its natural place between the two equal-growth
          side tracks once there is room for it. */}
      <div className="order-3 flex w-full justify-center sm:order-none sm:w-auto sm:flex-none">
        <ViewSwitcher
          activeView={activeView}
          onChangeView={onChangeView}
          logicRuleCount={logicRuleCount}
        />
      </div>

      {/* Right actions.
          Five outline buttons of equal weight sat here — Logic, Theme,
          Settings, Preview, Save — and nothing distinguished a view switch
          from a dialog from a write. Logic became the segmented switcher on
          the left; Theme folded into Settings as its Design tab; what is left
          is one dialog, one preview, and the two actions that change something. */}
      <div className="flex flex-1 items-center justify-end gap-1 sm:gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenSettings}
          title="Design, access, limits and notifications"
        >
          <Settings className="h-4 w-4" />
          <span className="sr-only">Settings</span>
        </Button>

        <Button variant="ghost" size="icon-sm" onClick={onPreview} title="Preview">
          <Eye className="h-4 w-4" />
          <span className="sr-only">Preview</span>
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
            failure, which is exactly when someone reaches for it. No label at
            all once settled: "Saved" next to an already-saved form has nothing
            to tell anyone. */}
        <Button
          variant={isSettled ? 'secondary' : 'outline'}
          size="sm"
          onClick={onSaveChanges}
          disabled={isSaving || isSettled || isBlocked}
          title={saveView.title}
          className={cn('gap-2', saveView.className)}
        >
          <SaveIcon className={cn('h-4 w-4', isSaving && 'animate-spin')} />
          {saveView.label && <span className="hidden md:inline">{saveView.label}</span>}
        </Button>

        {/* THE missing action. Saving only writes the draft columns; until this
            runs, no FormVersion exists, so the public page 404s and the
            submission worker has nothing to bind answers to. Hidden entirely
            once live with nothing new saved, rather than shown disabled —
            republishing an unchanged draft would just stamp out an identical
            FormVersion, so there is nothing here worth a permanent button for.
            Kept through an in-flight publish so it doesn't vanish mid-spin. */}
        {(canPublish || isPublishing) && (
          <Button
            variant="default"
            size="sm"
            onClick={onPublish}
            disabled={isPublishing || isBlocked}
            className="gap-2"
            title={
              isPublished ? 'Publish a new version of this form' : 'Make this form live at its public URL'
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
        )}
      </div>
    </header>
  );
}
