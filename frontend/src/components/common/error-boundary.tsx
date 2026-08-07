'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  /** Optional custom fallback. Receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * ErrorBoundary — stops one render-time throw from blanking the whole app.
 *
 * React unmounts the entire tree when a render error escapes to the root, so
 * without a boundary anywhere in the app, a single bad value (a null form, an
 * unexpected API shape) turns into a white screen with no recovery path.
 *
 * Class component by necessity: componentDidCatch has no hooks equivalent.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Replace with your error reporter (Sentry, etc.) when one is wired up.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            This section failed to render. The rest of the app is still usable.
          </p>
        </div>
        {process.env.NODE_ENV !== 'production' && (
          <pre className="max-w-xl overflow-x-auto rounded-md bg-muted p-3 text-left text-xs text-muted-foreground">
            {error.message}
          </pre>
        )}
        <Button onClick={this.reset} variant="outline" className="gap-2">
          <RotateCcw size={14} /> Try again
        </Button>
      </div>
    );
  }
}
