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
  GitFork
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface EnterpriseNavbarProps {
  formTitle: string;
  onTitleChange: (newTitle: string) => void;
  onPreview: () => void;
  onOpenTheme: () => void;
  onOpenLogic: () => void;
  hasUnsavedChanges: boolean;
  onSaveChanges: () => void;
  onToggleLeftPanel?: () => void;
}

export function EnterpriseNavbar({
  formTitle,
  onTitleChange,
  onPreview,
  onOpenTheme,
  onOpenLogic,
  hasUnsavedChanges,
  onSaveChanges,
  onToggleLeftPanel
}: EnterpriseNavbarProps) {
  const [isEditing, setIsEditing] = useState(false);

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

        <Button
          variant={hasUnsavedChanges ? "default" : "secondary"}
          size="sm"
          onClick={onSaveChanges}
          className="gap-2"
        >
          {hasUnsavedChanges ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          <span className="hidden md:inline">{hasUnsavedChanges ? 'Save Changes' : 'Saved'}</span>
        </Button>
      </div>
    </header>
  );
}
