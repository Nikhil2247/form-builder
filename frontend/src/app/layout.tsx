import type { Metadata, Viewport } from 'next';
import { Baloo_2, Merienda, Open_Sans } from 'next/font/google';
import { Toaster } from 'sonner';

import './globals.css';
import { cn } from '@/lib/utils';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { QueryProvider } from '@/providers/query-provider';
import { AuthProvider } from '@/providers/auth-provider';
import { ErrorBoundary } from '@/components/common/error-boundary';
import { CommandMenu } from '@/components/common/command-menu';

/* The three faces vibha.org uses, in the same roles: Open Sans for body and
   UI, Baloo 2 for display/headings, Merienda for script accents. All three are
   variable fonts, so each ships one file rather than a weight per cut.
   `display: 'swap'` avoids the invisible-text flash while they load. */
const openSans = Open_Sans({
  subsets: ['latin'],
  variable: '--font-open-sans',
  display: 'swap',
});

const baloo2 = Baloo_2({
  subsets: ['latin'],
  variable: '--font-baloo2',
  display: 'swap',
});

// Script accents only — loaded lazily by the browser since nothing in the
// dashboard chrome references it.
const merienda = Merienda({
  subsets: ['latin'],
  variable: '--font-merienda',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'FormBuilder — Enterprise Form Suite',
    template: '%s · FormBuilder',
  },
  description:
    'Build, publish, and analyse forms with conditional logic, versioning, and team collaboration.',
};

export const viewport: Viewport = {
  // Matches --background in each scheme, so the mobile browser chrome does not
  // sit against a colour the app never uses.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbf9f6' },
    { media: '(prefers-color-scheme: dark)', color: '#0a1924' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={cn('font-sans', openSans.variable, baloo2.variable, merienda.variable)}
      suppressHydrationWarning
    >
      <body
        className="min-h-screen bg-background font-sans text-foreground antialiased"
        suppressHydrationWarning
      >
        {/* Keyboard users land here first and can jump past the sidebar and
            header, which are otherwise ~20 tab stops on every page. */}
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>

        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            {/* Order matters: AuthProvider needs the query client for cache
                invalidation, and every data hook waits on its bootstrap. */}
            <AuthProvider>
              <ErrorBoundary>{children}</ErrorBoundary>
              <CommandMenu />
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>

        <Toaster
          position="bottom-right"
          closeButton
          // `richColors` paints toasts in saturated greens and reds that fight
          // the neutral palette. The default surface plus our own icon colour
          // is enough signal.
          toastOptions={{
            classNames: {
              toast: 'border-border bg-popover text-popover-foreground shadow-overlay',
              description: 'text-muted-foreground',
            },
          }}
        />
      </body>
    </html>
  );
}
