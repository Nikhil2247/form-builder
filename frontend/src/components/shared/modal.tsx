'use client';

import React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * The standard modal.
 *
 * Three different overlay patterns were in use: the shadcn `Dialog`, a
 * hand-rolled `fixed inset-0` div in the form builder (no focus trap, no
 * Escape handling, no `role="dialog"`, and background content still
 * tabbable — a keyboard user could tab straight out of the "modal" and
 * interact with the page behind it), and a third variant on the settings
 * pages. Everything now routes through this component, which is the Base UI
 * dialog with a fixed header/body/footer skeleton.
 *
 * Long content scrolls in the body only, so the title and the action buttons
 * stay visible — the builder's theme panel used to scroll the whole dialog,
 * pushing "Done" off-screen.
 */

const SIZES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
  full: 'sm:max-w-[min(72rem,calc(100vw-4rem))]',
} as const;

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Rendered in the footer bar. Omit for a body-only modal. */
  footer?: React.ReactNode;
  size?: keyof typeof SIZES;
  /** Adds padding + scroll to the body. Turn off for edge-to-edge content. */
  padded?: boolean;
  className?: string;
  contentClassName?: string;
  showCloseButton?: boolean;
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  padded = true,
  className,
  contentClassName,
  showCloseButton = true,
}: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={showCloseButton}
        className={cn(
          'grid max-h-[calc(100dvh-4rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0',
          SIZES[size],
          className,
        )}
      >
        <DialogHeader className="gap-1.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
          {description && (
            <DialogDescription className="text-xs">{description}</DialogDescription>
          )}
        </DialogHeader>

        <div
          className={cn(
            'min-h-0 overflow-y-auto',
            padded && 'px-5 py-4',
            contentClassName,
          )}
        >
          {children}
        </div>

        {footer && (
          <DialogFooter className="m-0 flex-row justify-end gap-2 rounded-none border-t border-border bg-muted/40 px-5 py-3">
            {footer}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** `<Modal footer={<ModalActions .../>}>` — the common cancel/confirm pair. */
export function ModalActions({
  onCancel,
  cancelLabel = 'Cancel',
  confirmLabel = 'Save',
  onConfirm,
  isPending,
  disabled,
  variant = 'default',
}: {
  onCancel?: () => void;
  cancelLabel?: string;
  confirmLabel?: string;
  onConfirm?: () => void;
  isPending?: boolean;
  disabled?: boolean;
  variant?: 'default' | 'destructive';
}) {
  return (
    <>
      {onCancel ? (
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
          {cancelLabel}
        </Button>
      ) : (
        <DialogClose render={<Button variant="ghost" size="sm" />}>{cancelLabel}</DialogClose>
      )}
      <Button
        size="sm"
        variant={variant}
        onClick={onConfirm}
        disabled={disabled || isPending}
        className="gap-2"
      >
        {isPending && <Loader2 className="size-3.5 animate-spin" />}
        {confirmLabel}
      </Button>
    </>
  );
}

/**
 * Destructive confirmation.
 *
 * Delete flows were previously a plain `Dialog` whose confirm button was the
 * default variant and, on the trash and team pages, `window.confirm()` — which
 * is unstyled, blocks the main thread, and is suppressed entirely by some
 * browsers when it fires outside a user gesture, silently turning "delete" into
 * a no-op.
 *
 * Pass `confirmText` to require the user to type a value (an org name, say)
 * before the action unlocks.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  isPending,
  variant = 'destructive',
  confirmText,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  isPending?: boolean;
  variant?: 'default' | 'destructive';
  confirmText?: string;
  children?: React.ReactNode;
}) {
  const [typed, setTyped] = React.useState('');

  // Reset the confirmation input whenever the dialog reopens, so a previous
  // successful entry cannot arm a different target.
  React.useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const unlocked = !confirmText || typed.trim() === confirmText.trim();

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          {variant === 'destructive' && (
            <span className="flex size-6 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="size-3.5" />
            </span>
          )}
          {title}
        </span>
      }
      description={description}
      footer={
        <ModalActions
          onCancel={() => onOpenChange(false)}
          cancelLabel={cancelLabel}
          confirmLabel={confirmLabel}
          onConfirm={() => void onConfirm()}
          isPending={isPending}
          disabled={!unlocked}
          variant={variant}
        />
      }
    >
      {children}
      {confirmText && (
        <div className="space-y-2">
          <label htmlFor="confirm-input" className="block text-xs text-muted-foreground">
            Type <span className="font-semibold text-foreground">{confirmText}</span> to confirm
          </label>
          <input
            id="confirm-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}
    </Modal>
  );
}
