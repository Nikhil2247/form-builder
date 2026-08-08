'use client';

import React from 'react';
import { cn } from '@/lib/utils';

/**
 * A phone-shaped viewport for previewing a data-entry app.
 *
 * Data Apps are used almost entirely on a phone in the field, while they are
 * authored on a desktop. Without a device frame an author sizes the app to a
 * 1400px column and only discovers on site that the record list needs three
 * taps of horizontal scrolling. The frame makes the real constraint — a 390pt
 * viewport — visible while configuring.
 *
 * The frame is chrome, not content: everything inside `children` lays out
 * against a plain `bg-background` surface, exactly as it would in a browser on
 * the device. The viewport is a fixed 390×844 on purpose — a frame that
 * stretched to its container would preview a layout no phone has.
 *
 * Every colour comes from the semantic tokens, so the frame follows the app
 * theme in both light and dark mode. Nothing here is hardcoded — a `#111`
 * bezel would vanish against a dark page and a white one would glare on it.
 */

/** Logical viewport of the reference device, in CSS pixels. */
const VIEWPORT_WIDTH = 390;
const VIEWPORT_HEIGHT = 844;

export interface PhonePreviewProps {
  children?: React.ReactNode;
  /** Small caption under the frame — e.g. the app name, or "Mobile preview". */
  label?: React.ReactNode;
  /** Text in the faux status bar. Defaults to a neutral placeholder time. */
  statusBarTime?: string;
  /** Hides the status bar for previews that render their own chrome. */
  showStatusBar?: boolean;
  /** Applied to the outer bezel. */
  className?: string;
  /** Applied to the scrolling viewport. */
  contentClassName?: string;
}

export function PhonePreview({
  children,
  label,
  statusBarTime = '9:41',
  showStatusBar = true,
  className,
  contentClassName,
}: PhonePreviewProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={cn(
          // The bezel. `shadow-overlay` is the one elevation step the design
          // system defines for floating surfaces.
          'relative shrink-0 rounded-[2.75rem] border border-border-strong bg-card p-2.5 shadow-overlay',
          className,
        )}
        // Not `role="img"`: the preview holds real, focusable content.
        aria-label="Mobile preview"
      >
        {/* Side buttons — pure decoration, hidden from assistive tech. */}
        <span
          aria-hidden
          className="absolute -left-0.5 top-28 h-12 w-0.5 rounded-full bg-border-strong"
        />
        <span
          aria-hidden
          className="absolute -left-0.5 top-44 h-12 w-0.5 rounded-full bg-border-strong"
        />
        <span
          aria-hidden
          className="absolute -right-0.5 top-36 h-16 w-0.5 rounded-full bg-border-strong"
        />

        <div
          className="relative overflow-hidden rounded-[2.25rem] bg-background"
          style={{ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT }}
        >
          {/* Dynamic island. Sits above the content and never intercepts a click.
              Dark mode uses `bg-card` rather than the inverted foreground: on a
              dark screen the island reads as a slightly lighter cutout, exactly
              as it does on the device, where a near-white pill would look like a
              highlight bar instead of a hole. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-2.5 z-20 h-7 w-[6.5rem]
                       -translate-x-1/2 rounded-full bg-foreground/85 dark:bg-card"
          />

          {showStatusBar && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-11 items-center
                         justify-between px-6 text-[0.6875rem] font-medium text-muted-foreground"
            >
              <span className="tabular">{statusBarTime}</span>
              <span className="flex items-center gap-1">
                {/* Signal, wifi, battery — drawn from the current text colour so
                    they stay legible in either theme. */}
                <span className="flex items-end gap-px">
                  {[3, 5, 7, 9].map((height) => (
                    <span
                      key={height}
                      className="w-0.5 rounded-sm bg-current"
                      style={{ height }}
                    />
                  ))}
                </span>
                <span className="ml-0.5 h-2 w-3.5 rounded-sm border border-current" />
              </span>
            </div>
          )}

          <div
            className={cn(
              'h-full w-full overflow-y-auto overflow-x-hidden overscroll-contain',
              showStatusBar ? 'pt-11' : 'pt-0',
              // Home-indicator gutter, so the last row of content is not sitting
              // under the bar the way it does on a real device.
              'pb-8',
              contentClassName,
            )}
          >
            {children}
          </div>

          {/* Home indicator. */}
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-2 left-1/2 h-1 w-32 -translate-x-1/2
                       rounded-full bg-foreground/25"
          />
        </div>
      </div>

      {label && <p className="text-xs text-muted-foreground">{label}</p>}
    </div>
  );
}

/**
 * The app shell as it renders on the device.
 *
 * Kept beside the frame rather than inside it so the frame stays a dumb
 * container: other previews (a single form, an empty state) can use the same
 * device without inheriting this header.
 */
export function PhonePreviewApp({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
        <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </header>
      <div className="flex-1 space-y-3 p-4">{children}</div>
    </div>
  );
}
