'use client';

import React, { useState } from 'react';
import { CheckCircle2, Loader2, UploadCloud, X as XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { API_BASE_URL } from '@/lib/config';
import { cn } from '@/lib/utils';

/**
 * File upload for the public form.
 *
 * ── What changed ───────────────────────────────────────────────────────────
 *   • `accept` is now derived from the author's `validation.allowedTypes`, and
 *     the size limit is checked BEFORE the presign round-trip. Previously the
 *     picker offered every file on the machine and an over-large file was
 *     discovered only after a request to the API — or worse, after the whole
 *     body had been PUT to object storage.
 *   • State changes are announced (`role="status"`, `aria-live`). "Uploading…",
 *     success and failure were purely visual.
 *   • The control is a real labelled input rather than a bare `<input>` inside
 *     a `<label>` with no name.
 */

export interface FileUploaderProps {
  formId: string;
  questionId: string;
  inputId: string;
  describedBy?: string;
  /** `validation.allowedTypes` — extensions or MIME types, as authored. */
  accept?: string[];
  maxSizeMb?: number;
  value: string;
  onChange: (fileId: string) => void;
}

/** Turn the author's list into something an `accept` attribute understands. */
function toAcceptAttribute(allowed?: string[]): string | undefined {
  if (!allowed || allowed.length === 0) return undefined;
  const parts = allowed
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry.includes('/')) return entry; // already a MIME type
      return entry.startsWith('.') ? entry : `.${entry}`;
    });
  return parts.length > 0 ? parts.join(',') : undefined;
}

export function FileUploader({
  formId,
  questionId,
  inputId,
  describedBy,
  accept,
  maxSizeMb,
  value,
  onChange,
}: FileUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');

  const acceptAttr = toAcceptAttribute(accept);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');

    // Checked here so an over-large file costs nothing. The API enforces the
    // same limit and binds it into the S3 signature — this is a courtesy, not
    // the control.
    if (typeof maxSizeMb === 'number' && maxSizeMb > 0 && file.size > maxSizeMb * 1024 * 1024) {
      setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${maxSizeMb} MB.`);
      e.target.value = '';
      return;
    }

    setIsUploading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/storage/presigned-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formId,
          questionId,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          // Bytes, not megabytes — the API validates an integer byte count and
          // binds it into the S3 signature.
          fileSizeBytes: file.size,
        }),
      });

      if (!res.ok) {
        // Surface the real reason (type not permitted, over the size limit,
        // quota exceeded) instead of a generic failure.
        const body = await res.json().catch(() => null);
        const raw = body?.error?.message ?? body?.message;
        throw new Error(
          (Array.isArray(raw) ? raw.join(', ') : raw) || 'Failed to start upload.',
        );
      }

      const { data } = await res.json();

      const uploadRes = await fetch(data.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });

      if (!uploadRes.ok) throw new Error('Failed to upload file.');

      setFileName(file.name);
      onChange(data.fileId);
    } catch (err: unknown) {
      setError(err instanceof Error && err.message ? err.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  };

  if (value) {
    return (
      <div className="max-w-md space-y-2">
        <div className="flex items-center justify-between rounded-xl border border-border bg-background p-4">
          <div className="flex items-center space-x-3 truncate">
            <CheckCircle2 size={20} className="text-emerald-500" aria-hidden />
            <span className="truncate text-sm font-medium text-foreground">
              {fileName || 'File uploaded'}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${fileName || 'uploaded file'}`}
            onClick={() => {
              onChange('');
              setFileName('');
            }}
          >
            <XIcon size={16} aria-hidden />
          </Button>
        </div>
        <p role="status" className="sr-only">
          {fileName || 'File'} uploaded successfully.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-md space-y-2">
      <label
        htmlFor={inputId}
        className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-background p-8 text-center transition-colors hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring"
      >
        {isUploading ? (
          <Loader2 size={32} className="mx-auto mb-3 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <UploadCloud size={32} className="mx-auto mb-3 text-muted-foreground" aria-hidden />
        )}
        <span className="text-sm font-semibold text-foreground">
          {isUploading ? 'Uploading…' : 'Choose a file'}
        </span>
        {!isUploading && (
          <span className="mt-1 text-xs text-muted-foreground">
            {acceptAttr ? acceptAttr.replace(/,/g, ', ') : 'Any file type'}
            {typeof maxSizeMb === 'number' ? ` · up to ${maxSizeMb} MB` : ''}
          </span>
        )}
        <input
          id={inputId}
          type="file"
          accept={acceptAttr}
          aria-describedby={describedBy}
          className="sr-only"
          onChange={handleFileChange}
          disabled={isUploading}
        />
      </label>

      {/* Announced, not merely shown. */}
      <p role="status" aria-live="polite" className="sr-only">
        {isUploading ? 'Uploading file, please wait.' : ''}
      </p>

      {error && (
        <p role="alert" className={cn('mt-1 text-xs font-semibold text-destructive')}>
          {error}
        </p>
      )}
    </div>
  );
}
