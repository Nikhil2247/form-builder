'use client';

import React from 'react';
import Link from 'next/link';
import type { VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

/**
 * A link that looks like a button.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The pattern in use was `<Button render={<Link href="…" />}>`, which Base UI
 * rejects at runtime:
 *
 *   "A component that acts as a button expected a native <button> because the
 *    `nativeButton` prop is true. Rendering a non-<button> removes native
 *    button semantics…"
 *
 * Base UI is right, and silencing it with `nativeButton={false}` would be the
 * wrong fix — that just tells the library to stop complaining while still
 * putting `role="button"` machinery on an anchor. The real distinction is
 * semantic:
 *
 *   • A <button> performs an action. It fires on Space and Enter, and it can
 *     submit a form.
 *   • An <a href> navigates. It fires on Enter only, and it supports every
 *     affordance users expect of a link — middle-click, Cmd/Ctrl-click to open
 *     a new tab, right-click "copy link address", and hover preview.
 *
 * Wrapping a Link in a Button broke all of those. This component applies the
 * button *styling* to a real anchor, so it looks identical and behaves the way
 * a link should.
 *
 * Use `<Button onClick={…}>` for actions; use this for navigation.
 */

export interface ButtonLinkProps
  extends Omit<React.ComponentProps<typeof Link>, 'className'>,
    VariantProps<typeof buttonVariants> {
  className?: string;
  /** Opens in a new tab and applies the correct rel for untrusted targets. */
  external?: boolean;
}

export function ButtonLink({
  className,
  variant = 'default',
  size = 'default',
  external,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      {...props}
      {...(external
        ? // noopener is the security-relevant half: without it the opened page
          // can reach back through window.opener and navigate this one.
          { target: '_blank', rel: 'noopener noreferrer' }
        : {})}
      className={cn(buttonVariants({ variant, size }), className)}
    >
      {children}
    </Link>
  );
}

/** The same treatment for a plain external URL that is not a Next route. */
export function ButtonAnchor({
  className,
  variant = 'default',
  size = 'default',
  external,
  children,
  ...props
}: React.ComponentProps<'a'> & VariantProps<typeof buttonVariants> & { external?: boolean }) {
  return (
    <a
      {...props}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cn(buttonVariants({ variant, size }), className)}
    >
      {children}
    </a>
  );
}
