'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Modal } from '@/components/shared';
import { cn } from '@/lib/utils';
import {
  usePreviewCsv,
  useImportCsv,
  useTemplateCsv,
  type ChoiceListSummary,
  type CsvMapping,
  type CsvPreview,
  type DictionaryScope,
  type ImportResult,
} from '@/hooks/use-dictionary';

/**
 * Bulk CSV import, as three steps the user can always back out of.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   1. CHOOSE   — pick or drop a file. Read as text in the browser.
 *   2. MAP      — say which column is the value, the label, the parent, and
 *                 which extra columns to carry as metadata.
 *   3. CONFIRM  — choose replace vs add, see what will happen, commit.
 *
 * THE FILE IS PARSED ON THE SERVER, not here, and the preview in step 2 comes
 * from that same parse. Parsing locally for the preview and again server-side
 * for the commit is two implementations of RFC 4180 that agree right up until
 * someone uploads a district called `Kadapa, YSR` — at which point the columns
 * the user mapped are not the columns that get imported, silently.
 *
 * The cost is that the file is uploaded twice, once per step. For a dictionary
 * — bounded at 20 000 rows — that is a few megabytes, and it buys the guarantee
 * that what was shown is what is stored.
 */

/** Bigger than the API accepts. Caught here so the user is not made to wait. */
const MAX_FILE_BYTES = 12 * 1024 * 1024;

type Step = 'choose' | 'map' | 'done';

/** How the file's rows meet the rows already in the list. */
type ImportMode = 'replace' | 'merge';

export interface CsvImportDialogProps {
  scope: DictionaryScope;
  list: ChoiceListSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Mounted only while open (see DictionaryPage), so every field starts at its
 * initial value and a second import cannot inherit the first one's file,
 * mapping, or success banner. `reset` below exists for the in-dialog "choose
 * another file" path, which stays on the same mount.
 */
export function CsvImportDialog({ scope, list, open, onOpenChange }: CsvImportDialogProps) {
  const preview = usePreviewCsv(scope);
  const importCsv = useImportCsv(scope);
  const template = useTemplateCsv(scope);

  const [step, setStep] = React.useState<Step>('choose');
  const [fileName, setFileName] = React.useState('');
  const [csv, setCsv] = React.useState('');
  const [parsed, setParsed] = React.useState<CsvPreview | null>(null);
  const [mapping, setMapping] = React.useState<CsvMapping>({ value: '' });
  const [mode, setMode] = React.useState<ImportMode>('replace');
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const reset = React.useCallback(() => {
    setStep('choose');
    setFileName('');
    setCsv('');
    setParsed(null);
    setMapping({ value: '' });
    setMode('replace');
    setResult(null);
    setError(null);
    setIsDragging(false);
    preview.reset();
    importCsv.reset();
  }, [preview, importCsv]);

  const acceptFile = React.useCallback(
    async (file: File) => {
      setError(null);

      if (file.size > MAX_FILE_BYTES) {
        setError(
          `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the ${MAX_FILE_BYTES / 1024 / 1024} MB limit. Split it and upload each part with "Add and update".`,
        );
        return;
      }

      let text: string;
      try {
        text = await file.text();
      } catch {
        setError('That file could not be read. Try re-saving it as CSV and uploading again.');
        return;
      }

      setFileName(file.name);
      setCsv(text);

      try {
        const result = await preview.mutateAsync(text);
        setParsed(result);
        setMapping(guessMapping(result.columns, list));
        setStep('map');
      } catch (err) {
        setError(messageOf(err, 'That file could not be read as CSV.'));
      }
    },
    [preview, list],
  );

  const onCommit = async () => {
    setError(null);
    try {
      const outcome = await importCsv.mutateAsync({ slug: list.slug, csv, mapping, mode });
      setResult(outcome);
      setStep('done');
    } catch (err) {
      setError(messageOf(err, 'The import failed. Nothing was changed.'));
    }
  };

  const canCommit = !!mapping.value && (!list.parentListId || !!mapping.parentValue);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={`Upload data to ${list.name}`}
      description={
        step === 'done'
          ? undefined
          : 'A CSV or tab-separated file with a header row. Columns can be in any order — you choose what each one means next.'
      }
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            {fileName && step !== 'done' ? fileName : null}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {step === 'map' && (
              <Button variant="ghost" onClick={reset} disabled={importCsv.isPending}>
                Choose another file
              </Button>
            )}
            {step === 'done' ? (
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={importCsv.isPending}
                >
                  Cancel
                </Button>
                {step === 'map' && (
                  <Button onClick={onCommit} disabled={!canCommit || importCsv.isPending}>
                    {importCsv.isPending ? (
                      <>
                        <Loader2 className="size-4 animate-spin" strokeWidth={1.5} />
                        Importing…
                      </>
                    ) : (
                      `Import ${parsed?.rowCount.toLocaleString() ?? ''} rows`
                    )}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
            <span>{error}</span>
          </p>
        )}

        {step === 'choose' && (
          <ChooseStep
            isBusy={preview.isPending}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            onFile={acceptFile}
            list={list}
            onDownloadTemplate={() =>
              template.mutate({ slug: list.slug, name: list.name })
            }
            isDownloadingTemplate={template.isPending}
          />
        )}

        {step === 'map' && parsed && (
          <MapStep
            parsed={parsed}
            list={list}
            mapping={mapping}
            onMappingChange={setMapping}
            mode={mode}
            onModeChange={setMode}
          />
        )}

        {step === 'done' && result && <DoneStep result={result} listName={list.name} />}
      </div>
    </Modal>
  );
}

// ── Step 1: choose ───────────────────────────────────────────────────────────

function ChooseStep({
  isBusy,
  isDragging,
  setIsDragging,
  onFile,
  list,
  onDownloadTemplate,
  isDownloadingTemplate,
}: {
  isBusy: boolean;
  isDragging: boolean;
  setIsDragging: (dragging: boolean) => void;
  onFile: (file: File) => void;
  list: ChoiceListSummary;
  onDownloadTemplate: () => void;
  isDownloadingTemplate: boolean;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-4">
      {/* Offered BEFORE the drop zone, not after it. Someone opening this
          dialog for the first time has no file yet; putting "start from a
          template" below the upload area means they only find it after
          guessing at the format and failing. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Not sure about the format?
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Download a starter file with this list&apos;s exact columns
            {list.parentListId ? ' and real parent values' : ''}, fill it in, and upload it back.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={onDownloadTemplate}
          disabled={isDownloadingTemplate}
        >
          {isDownloadingTemplate ? (
            <Loader2 className="size-4 animate-spin" strokeWidth={1.5} />
          ) : (
            <Download className="size-4" strokeWidth={1.5} />
          )}
          Download template
        </Button>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors',
          isDragging ? 'border-primary bg-primary/5' : 'border-border bg-muted/30',
        )}
      >
        {isBusy ? (
          <>
            <Loader2 className="size-7 animate-spin text-muted-foreground" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">Reading the file…</p>
          </>
        ) : (
          <>
            <FileUp className="size-7 text-muted-foreground" strokeWidth={1.5} />
            <div>
              <p className="text-sm font-medium text-foreground">
                Drop a CSV here, or choose a file
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Up to 20,000 rows. Comma, semicolon or tab separated.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              <Upload className="size-4" strokeWidth={1.5} />
              Choose file
            </Button>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Cleared so choosing the same file twice in a row still fires a
            // change event — otherwise a failed import cannot be retried with
            // the corrected file of the same name.
            e.target.value = '';
            if (file) onFile(file);
          }}
        />
      </div>

      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          What this list needs
        </h3>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
          <li>
            <strong className="font-medium text-foreground">A value column</strong> — the code
            stored in the answer. It must stay the same across re-imports; changing it orphans
            every response that already used it.
          </li>
          <li>
            <strong className="font-medium text-foreground">A label column</strong> — what people
            see in the dropdown. Optional; the value is used when it is missing.
          </li>
          {list.parentListId && (
            <li>
              <strong className="font-medium text-foreground">A parent column</strong> — required,
              because this list cascades from{' '}
              <span className="text-foreground">{list.parentList?.name ?? 'another list'}</span>.
              Each row names the item it sits under, using that list&apos;s <em>value</em>.
            </li>
          )}
          <li>Any other columns can be carried along and read by rules for auto-fill.</li>
        </ul>
      </div>
    </div>
  );
}

// ── Step 2: map ──────────────────────────────────────────────────────────────

const UNMAPPED = '__none__';

function MapStep({
  parsed,
  list,
  mapping,
  onMappingChange,
  mode,
  onModeChange,
}: {
  parsed: CsvPreview;
  list: ChoiceListSummary;
  mapping: CsvMapping;
  onMappingChange: (mapping: CsvMapping) => void;
  mode: ImportMode;
  onModeChange: (mode: ImportMode) => void;
}) {
  const assigned = new Set(
    [mapping.value, mapping.label, mapping.parentValue].filter(Boolean) as string[],
  );

  const toggleMetadata = (column: string, on: boolean) => {
    const metadata = { ...(mapping.metadata ?? {}) };
    if (on) metadata[metadataKeyFor(column)] = column;
    else {
      for (const [key, value] of Object.entries(metadata)) {
        if (value === column) delete metadata[key];
      }
    }
    onMappingChange({ ...mapping, metadata });
  };

  const carried = new Set(Object.values(mapping.metadata ?? {}));

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Found <strong className="font-medium text-foreground">{parsed.rowCount.toLocaleString()}</strong>{' '}
        rows and {parsed.columns.length} columns
        {parsed.delimiter !== ',' && (
          <>
            , separated by{' '}
            <span className="text-foreground">
              {parsed.delimiter === ';' ? 'semicolons' : parsed.delimiter === '\t' ? 'tabs' : 'pipes'}
            </span>
          </>
        )}
        .
      </p>

      {/* ── Field mapping ───────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <ColumnPicker
          label="Value"
          hint="Stored in the answer. Must be unique."
          required
          columns={parsed.columns}
          value={mapping.value}
          onChange={(column) => onMappingChange({ ...mapping, value: column ?? '' })}
          sample={parsed.sample}
        />
        <ColumnPicker
          label="Label"
          hint="Shown in the dropdown."
          columns={parsed.columns}
          value={mapping.label}
          onChange={(column) => onMappingChange({ ...mapping, label: column })}
          sample={parsed.sample}
        />
        {list.parentListId && (
          <ColumnPicker
            label="Parent value"
            hint={`The ${list.parentList?.name ?? 'parent'} item each row sits under.`}
            required
            columns={parsed.columns}
            value={mapping.parentValue}
            onChange={(column) => onMappingChange({ ...mapping, parentValue: column })}
            sample={parsed.sample}
          />
        )}
      </div>

      {/* ── Extra columns ───────────────────────────────────────────────── */}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Carry other columns
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Stored alongside each item. A rule can read these to fill a field in automatically — a
          UDISE code from a school, say.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {parsed.columns.filter((column) => !assigned.has(column)).length === 0 ? (
            <p className="text-sm text-muted-foreground">Every column is already mapped above.</p>
          ) : (
            parsed.columns
              .filter((column) => !assigned.has(column))
              .map((column) => {
                const on = carried.has(column);
                return (
                  <button
                    key={column}
                    type="button"
                    onClick={() => toggleMetadata(column, !on)}
                    aria-pressed={on}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                      on
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:border-border-strong hover:text-foreground',
                    )}
                  >
                    {column}
                  </button>
                );
              })
          )}
        </div>
      </div>

      {/* ── Preview ─────────────────────────────────────────────────────── */}
      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          First rows, as they will be stored
        </h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Value</th>
                <th className="px-3 py-2 text-left font-medium">Label</th>
                {list.parentListId && (
                  <th className="px-3 py-2 text-left font-medium">Parent</th>
                )}
                {Object.keys(mapping.metadata ?? {}).length > 0 && (
                  <th className="px-3 py-2 text-left font-medium">Extra</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {parsed.sample.slice(0, 5).map((row, index) => {
                const value = mapping.value ? row[mapping.value] : '';
                return (
                  <tr key={index} className={cn(!value && 'bg-destructive/5')}>
                    <td className="px-3 py-1.5 font-mono text-xs">
                      {value || (
                        <span className="text-destructive">empty — row will be skipped</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {(mapping.label ? row[mapping.label] : '') || (
                        <span className="text-muted-foreground">{value}</span>
                      )}
                    </td>
                    {list.parentListId && (
                      <td className="px-3 py-1.5 font-mono text-xs">
                        {(mapping.parentValue ? row[mapping.parentValue] : '') || (
                          <span className="text-destructive">missing</span>
                        )}
                      </td>
                    )}
                    {Object.keys(mapping.metadata ?? {}).length > 0 && (
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">
                        {Object.entries(mapping.metadata ?? {})
                          .map(([key, column]) => `${key}=${row[column] ?? ''}`)
                          .join('  ')}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Mode ────────────────────────────────────────────────────────── */}
      <fieldset>
        <legend className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          What to do with rows already in the list
        </legend>
        <div className="mt-2.5 flex flex-col gap-2">
          <ModeOption
            checked={mode === 'replace'}
            onSelect={() => onModeChange('replace')}
            title="Replace the list"
            description={
              list.itemCount > 0
                ? `Items not in this file stop being offered. They are kept, not deleted, so the ${list.itemCount.toLocaleString()} existing responses that reference them still read correctly.`
                : 'Items not in this file stop being offered. They are kept, not deleted, so past responses still read correctly.'
            }
          />
          <ModeOption
            checked={mode === 'merge'}
            onSelect={() => onModeChange('merge')}
            title="Add and update"
            description="Rows in this file are added or updated. Everything already in the list is left alone. Use this to upload a large dictionary in parts."
          />
        </div>
      </fieldset>
    </div>
  );
}

function ModeOption({
  checked,
  onSelect,
  title,
  description,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer gap-3 rounded-lg border px-3.5 py-3 transition-colors',
        checked ? 'border-primary bg-primary/5' : 'border-border hover:border-border-strong',
      )}
    >
      <input
        type="radio"
        name="import-mode"
        checked={checked}
        onChange={onSelect}
        className="mt-1 size-4 shrink-0 accent-primary"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function ColumnPicker({
  label,
  hint,
  required,
  columns,
  value,
  onChange,
  sample,
}: {
  label: string;
  hint: string;
  required?: boolean;
  columns: string[];
  value: string | undefined;
  onChange: (column: string | undefined) => void;
  sample: Array<Record<string, string>>;
}) {
  const example = value ? sample.find((row) => row[value])?.[value] : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      <Select
        value={value ?? UNMAPPED}
        onValueChange={(next) => onChange(next === UNMAPPED ? undefined : (next ?? undefined))}
      >
        <SelectTrigger className={cn('h-9', required && !value && 'border-destructive')}>
          <SelectValue placeholder="Choose a column" />
        </SelectTrigger>
        <SelectContent>
          {!required && <SelectItem value={UNMAPPED}>Not in this file</SelectItem>}
          {columns.map((column) => (
            <SelectItem key={column} value={column}>
              {column}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {example ? (
          <>
            {hint} e.g. <span className="font-mono text-foreground">{example}</span>
          </>
        ) : (
          hint
        )}
      </p>
    </div>
  );
}

// ── Step 3: done ─────────────────────────────────────────────────────────────

function DoneStep({ result, listName }: { result: ImportResult; listName: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <CheckCircle2 className="size-9 text-emerald-600 dark:text-emerald-500" strokeWidth={1.5} />
      <div>
        <h3 className="text-sm font-semibold text-foreground">{listName} is up to date</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {result.itemCount.toLocaleString()} options are now available in dropdowns bound to this
          list.
        </p>
      </div>

      <dl className="grid w-full max-w-md grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border text-left sm:grid-cols-4">
        <Stat label="Added" value={result.created} />
        <Stat label="Updated" value={result.updated} />
        <Stat label="Retired" value={result.retired} tone={result.retired > 0 ? 'warn' : undefined} />
        <Stat label="Skipped" value={result.skipped} tone={result.skipped > 0 ? 'warn' : undefined} />
      </dl>

      {result.skipped > 0 && (
        <p className="max-w-md text-xs text-muted-foreground">
          {result.skipped.toLocaleString()} rows had no value
          {result.mode === 'replace' ? '' : ''} — or, on a cascading list, no parent — and were not
          imported. Everything else was.
        </p>
      )}
      {result.retired > 0 && (
        <p className="max-w-md text-xs text-muted-foreground">
          {result.retired.toLocaleString()} options are no longer offered because the file did not
          contain them. They were kept rather than deleted, so existing responses still show their
          labels.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return (
    <div className="bg-background px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-lg font-semibold tabular-nums',
          tone === 'warn' ? 'text-amber-600 dark:text-amber-500' : 'text-foreground',
        )}
      >
        {value.toLocaleString()}
      </dd>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Pre-select the columns whose names make their meaning obvious.
 *
 * A guess only — every field stays changeable. The point is that the common
 * case (a file exported from this very dictionary, or one with sensibly named
 * headers) needs no mapping work at all.
 */
function guessMapping(columns: string[], list: ChoiceListSummary): CsvMapping {
  const find = (...candidates: string[]): string | undefined => {
    const normalised = columns.map((column) => ({ column, key: column.toLowerCase().trim() }));
    for (const candidate of candidates) {
      const exact = normalised.find((entry) => entry.key === candidate);
      if (exact) return exact.column;
    }
    for (const candidate of candidates) {
      const partial = normalised.find((entry) => entry.key.includes(candidate));
      if (partial) return partial.column;
    }
    return undefined;
  };

  const value = find('value', 'code', 'id', 'key') ?? columns[0];
  const label = find('label', 'name', 'title', 'description');
  const parentValue = list.parentListId
    ? find('parent_value', 'parentvalue', 'parent', 'state_code', 'state')
    : undefined;

  // Anything the list already declares as a metadata column and that the file
  // happens to carry under the same name is carried automatically.
  const metadata: Record<string, string> = {};
  for (const column of list.metadataSchema ?? []) {
    const match = columns.find((name) => name.toLowerCase().trim() === column.key.toLowerCase());
    if (match && match !== value && match !== label && match !== parentValue) {
      metadata[column.key] = match;
    }
  }

  return {
    value,
    label: label === value ? undefined : label,
    parentValue,
    metadata,
  };
}

/** A CSV header turned into a stable metadata key. Mirrors the server's rule. */
function metadataKeyFor(column: string): string {
  return (
    column
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'column'
  );
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
