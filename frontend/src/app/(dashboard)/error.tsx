"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Home, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { captureSegmentError } from "@/lib/report-error";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    console.error("Dashboard error boundary caught:", error);
    // No-op unless NEXT_PUBLIC_SENTRY_DSN is set — see lib/report-error.ts.
    // Keyed on the error object, so a reset that throws again reports again
    // while a re-render of the same failure does not.
    captureSegmentError(error);
  }, [error]);

  return (
    <div className="flex min-h-[80vh] w-full flex-col items-center justify-center p-4 animate-in zoom-in-95 duration-500">
      <div className="max-w-md w-full bg-card border border-border shadow-lg rounded-2xl p-8 text-center space-y-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-8 w-8 text-destructive" />
        </div>
        
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Something went wrong</h2>
          <p className="text-sm text-muted-foreground">
            {error.message || "An unexpected error occurred while loading this page."}
          </p>
        </div>

        {error.digest && (
          <div className="text-xs text-muted-foreground bg-muted p-2 rounded-md">
            Error ID: <span className="font-mono">{error.digest}</span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Button onClick={() => reset()} className="gap-2">
            <RefreshCw size={16} />
            Try again
          </Button>
          <Button onClick={() => window.location.href = '/dashboard'} variant="outline" className="gap-2">
            <Home size={16} />
            Dashboard
          </Button>
        </div>

        <div className="pt-4 border-t border-border text-left">
          <button 
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors"
          >
            {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showDetails ? 'Hide details' : 'Show technical details'}
          </button>
          
          {showDetails && (
            <div className="mt-2 p-3 bg-muted rounded-lg border border-border overflow-auto max-h-48 text-xs font-mono text-muted-foreground">
              {error.stack || "No stack trace available."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
