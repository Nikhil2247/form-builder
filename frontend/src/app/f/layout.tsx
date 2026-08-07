import React from 'react';

/**
 * The public form route owns its own full-height surface.
 *
 * The centering and max-width that used to live here have moved into the page,
 * because the form's theme paints the *page* background — a fixed
 * `bg-muted/20` wrapper sat on top of it and the author's chosen background
 * colour was only ever visible as a strip nobody noticed.
 */
export default function PublicFormLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen">{children}</div>;
}
