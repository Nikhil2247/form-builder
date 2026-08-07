import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import { Toaster } from 'sonner';

import './globals.css';
import { cn } from '@/lib/utils';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { QueryProvider } from '@/providers/query-provider';
import { AuthProvider } from '@/providers/auth-provider';
import { ErrorBoundary } from '@/components/common/error-boundary';
import { CommandMenu } from '@/components/common/command-menu';

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-sans',
  // Avoids the invisible-text flash while the webfont loads.
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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1a1c' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn('font-sans', geist.variable)} suppressHydrationWarning>
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
