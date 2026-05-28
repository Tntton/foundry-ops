'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  processIntakeUpload,
  type IntakeUploadResult,
  type IntakeKind,
} from './actions';
import { tagExpenseProject } from '../../expenses/[id]/actions';
import { Button } from '@/components/ui/button';

/**
 * Batch drop zone — up to MAX_FILES concurrent uploads. Each file is read
 * to base64 in the browser, then handed to `processIntakeUpload` (a
 * non-redirecting server action). We fan out CONCURRENCY parallel calls so
 * Sonnet's vision endpoint stays under its per-key rate limit while still
 * making good use of the wait time per file (~3-5s each).
 *
 * Accepted formats: PDF + JPEG + PNG + HEIC / HEIF + WebP, up to MAX_FILE_BYTES
 * each. HEIC is queued + Bill row created, but the OCR call itself returns
 * "format not supported by claude-sonnet directly" — surfaces in the per-file
 * status as a yellow warning.
 */
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
]);
const ALLOWED_EXT = ['.pdf', '.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp'];
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_FILES = 10;
const CONCURRENCY = 3; // parallel OCR calls — keep under Sonnet rate limits

type FileKind = 'pdf' | 'image' | 'heic' | 'unknown';
type ItemStatus =
  | 'queued'
  | 'reading'
  | 'extracting'
  | 'done'
  | 'failed';

type QueueItem = {
  /** stable id so React keys stay aligned across re-renders */
  id: string;
  file: File;
  fileName: string;
  kind: FileKind;
  /**
   * Where this row will land on submit:
   *   - 'expense' — personal reimbursement (any staff member)
   *   - 'bill'    — vendor AP (admin / partner only)
   * Defaulted by the user's role on the parent page; togglable per row.
   */
  intakeKind: IntakeKind;
  size: number;
  mime: string;
  base64: string; // empty until reading completes
  /**
   * `URL.createObjectURL` blob URL for the file. Browser-displayable images
   * use it as the <img src> for the thumbnail; HEIC + PDF fall back to a
   * format icon since browsers can't render those inline. Revoked when the
   * item is removed / batch is cleared (URL.revokeObjectURL frees memory).
   */
  thumbnailUrl: string | null;
  status: ItemStatus;
  message?: string;
  /** Bill.id when intakeKind='bill', Expense.id when 'expense'. */
  subjectId?: string;
  extractionOk?: boolean;
  confidencePct?: number;
  validationError?: string;
};

function classify(file: File): { ok: boolean; kind: FileKind; reason?: string } {
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      kind: 'unknown',
      reason: `${(file.size / 1024 / 1024).toFixed(1)} MB — max 25 MB`,
    };
  }
  const lowerName = file.name.toLowerCase();
  const ext = ALLOWED_EXT.find((e) => lowerName.endsWith(e));
  const mimeOk = ALLOWED_MIME.has(file.type.toLowerCase());
  if (!mimeOk && !ext) {
    return {
      ok: false,
      kind: 'unknown',
      reason: 'unsupported format',
    };
  }
  if (lowerName.endsWith('.pdf') || file.type === 'application/pdf') {
    return { ok: true, kind: 'pdf' };
  }
  if (
    lowerName.endsWith('.heic') ||
    lowerName.endsWith('.heif') ||
    file.type === 'image/heic' ||
    file.type === 'image/heif'
  ) {
    return { ok: true, kind: 'heic' };
  }
  return { ok: true, kind: 'image' };
}

function resolveMime(f: File): string {
  if (f.type) return f.type;
  const lower = f.name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.heif')) return 'image/heif';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileToBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(f);
  });
}

export function IntakeDropzone({
  defaultKind,
  canCreateBill,
  projectOptions,
}: {
  /** Initial per-row kind for new uploads. Set by the page based on session role. */
  defaultKind: IntakeKind;
  /** Whether the current user can create vendor bills. If false, the per-row toggle is locked to 'expense'. */
  canCreateBill: boolean;
  /** Eligible projects for the inline project-tag picker shown on
   *  done-state expense rows. Empty array hides the picker (e.g. for
   *  pages that haven't loaded project options yet). The picker only
   *  renders for personal-expense rows, since vendor bills get full
   *  classification flow in the review pane. */
  projectOptions: Array<{ id: string; code: string; name: string }>;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [hovering, setHovering] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [batchSummary, setBatchSummary] = useState<string | null>(null);
  const [batchKind, setBatchKind] = useState<IntakeKind>(defaultKind);

  function setItemKind(id: string, intakeKind: IntakeKind) {
    if (!canCreateBill && intakeKind === 'bill') return;
    setItems((prev) =>
      prev.map((p) =>
        p.id === id && (p.status === 'queued' || p.status === 'failed')
          ? { ...p, intakeKind }
          : p,
      ),
    );
  }

  /**
   * Reset a failed row back to `queued` so the next `processQueue()`
   * picks it up. Clears `message` so the row's status pill stops
   * showing the stale failure reason. Caller fires `processQueue`
   * after — typically wrapped in `startTransition`.
   */
  function retryItem(id: string) {
    setItems((prev) =>
      prev.map((p) =>
        p.id === id && p.status === 'failed'
          ? { ...p, status: 'queued', message: undefined, validationError: undefined }
          : p,
      ),
    );
  }

  /**
   * Open the file in a new tab. Image / PDF blob URLs render inline;
   * unsupported formats trigger a download. Once the row has a
   * subjectId (post-extraction), we navigate to the bill / expense
   * detail page instead so the user can edit fields there.
   */
  function openItem(item: QueueItem) {
    if (item.subjectId) {
      const href =
        item.intakeKind === 'bill'
          ? `/bills/intake?id=${item.subjectId}`
          : `/expenses/${item.subjectId}`;
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    // Local preview — re-create the object URL on demand for non-image
    // kinds (their thumbnailUrl is null) so the tab can render PDFs
    // inline. We don't revoke; the URL gets GC'd at page unload, and
    // the file is small (capped at MAX_FILE_BYTES).
    const url = item.thumbnailUrl ?? URL.createObjectURL(item.file);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function appendFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    setItems((prev) => {
      const remaining = MAX_FILES - prev.length;
      const accepted = incoming.slice(0, Math.max(0, remaining));
      const skipped = incoming.length - accepted.length;
      const next: QueueItem[] = [...prev];
      for (const f of accepted) {
        const verdict = classify(f);
        const id = `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2, 6)}`;
        // Object URL only for browser-displayable images. HEIC + PDF would
        // produce a valid URL but render as a broken-image icon; the row
        // shows a format-icon fallback for those.
        const thumbnailUrl =
          verdict.ok && verdict.kind === 'image'
            ? URL.createObjectURL(f)
            : null;
        next.push({
          id,
          file: f,
          fileName: f.name,
          kind: verdict.kind,
          intakeKind: batchKind,
          size: f.size,
          mime: resolveMime(f),
          base64: '',
          thumbnailUrl,
          status: verdict.ok ? 'queued' : 'failed',
          ...(verdict.ok ? {} : { validationError: verdict.reason ?? 'invalid' }),
        });
      }
      if (skipped > 0) {
        setBatchSummary(
          `${skipped} file${skipped === 1 ? '' : 's'} skipped — max ${MAX_FILES} per batch.`,
        );
      } else {
        setBatchSummary(null);
      }
      return next;
    });
  }

  function clearAll() {
    if (isPending) return;
    for (const item of items) {
      if (item.thumbnailUrl) URL.revokeObjectURL(item.thumbnailUrl);
    }
    setItems([]);
    setBatchSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeItem(id: string) {
    if (isPending) return;
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target?.thumbnailUrl) URL.revokeObjectURL(target.thumbnailUrl);
      return prev.filter((i) => i.id !== id);
    });
  }

  // Free any leftover object URLs when the dropzone unmounts (page navigate
  // / component teardown). Important — without this every dropped photo
  // pins its blob in browser memory until the tab closes.
  useEffect(() => {
    return () => {
      for (const item of items) {
        if (item.thumbnailUrl) URL.revokeObjectURL(item.thumbnailUrl);
      }
    };
    // We intentionally read items only on unmount via the closure value
    // captured at last render — the cleanup runs once when the component
    // is destroyed, not on every items change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function processQueue() {
    const pending = items.filter((i) => i.status === 'queued');
    if (pending.length === 0) return;

    setBatchSummary(null);

    // Phase 1: read every queued file to base64 in parallel (memory-bound,
    // not network-bound — cheap to do all at once).
    setItems((prev) =>
      prev.map((i) => (i.status === 'queued' ? { ...i, status: 'reading' } : i)),
    );
    const reads = await Promise.allSettled(
      pending.map(async (item) => ({
        id: item.id,
        base64: await fileToBase64(item.file),
      })),
    );
    setItems((prev) => {
      const next = [...prev];
      for (const r of reads) {
        if (r.status === 'fulfilled') {
          const idx = next.findIndex((i) => i.id === r.value.id);
          if (idx >= 0)
            next[idx] = {
              ...next[idx]!,
              base64: r.value.base64,
              status: 'extracting',
            };
        } else {
          // Match by index of pending — best effort; reads run in same order.
          const reasonMessage = r.reason instanceof Error ? r.reason.message : 'read failed';
          const idx = next.findIndex(
            (i) => i.status === 'reading' && pending.some((p) => p.id === i.id),
          );
          if (idx >= 0)
            next[idx] = {
              ...next[idx]!,
              status: 'failed',
              message: reasonMessage,
            };
        }
      }
      return next;
    });

    // Phase 2: fan out OCR calls with a small concurrency cap so we don't
    // hammer Sonnet's per-key rate limit when 10 files land at once.
    //
    // CRITICAL: build the ready list from `pending` (which we have in
    // closure) merged with the freshly read base64 strings. Don't read
    // from `items` here — that's the React state captured at function
    // entry, before the setItems call above ran, so its base64 is still
    // empty. Using items.base64 here was the cause of empty-body uploads
    // hitting the server with fileBase64Length=0.
    const readsById = new Map<string, string>();
    for (const r of reads) {
      if (r.status === 'fulfilled') {
        readsById.set(r.value.id, r.value.base64);
      }
    }
    const readyItems: QueueItem[] = pending
      .filter((item) => readsById.has(item.id))
      .map((item) => ({ ...item, base64: readsById.get(item.id)!, status: 'extracting' as const }));

    // Track per-run outcomes locally so we can navigate to the newest
    // bill after the batch finishes (auto-populates the review pane on the
    // right). React state isn't reliable for this — setItems calls
    // serialise but we don't get to read the final values inside runOne.
    type RunOutcome = { id: string; subjectId: string; kind: IntakeKind };
    const outcomes: RunOutcome[] = [];
    async function runOne(item: QueueItem): Promise<void> {
      const result: IntakeUploadResult = await processIntakeUpload({
        fileName: item.fileName,
        fileBase64: item.base64,
        fileMime: item.mime,
        kind: item.intakeKind,
      });
      if (result.ok) {
        outcomes.push({
          id: item.id,
          subjectId: result.subjectId,
          kind: result.kind,
        });
      }
      setItems((prev) =>
        prev.map((p) =>
          p.id === item.id
            ? result.ok
              ? {
                  ...p,
                  status: 'done',
                  subjectId: result.subjectId,
                  extractionOk: result.extractionOk,
                  ...(result.confidencePct !== undefined
                    ? { confidencePct: result.confidencePct }
                    : {}),
                  message: result.extractionOk
                    ? `Extracted${
                        result.confidencePct
                          ? ` at ${result.confidencePct}%`
                          : ''
                      }`
                    : (result.extractionReason ?? 'No extraction'),
                }
              : { ...p, status: 'failed', message: result.error }
            : p,
        ),
      );
    }

    // Run with concurrency cap. Keep advancing as slots free up.
    const queue = [...readyItems];
    const inflight: Promise<void>[] = [];
    while (queue.length > 0 || inflight.length > 0) {
      while (inflight.length < CONCURRENCY && queue.length > 0) {
        const next = queue.shift()!;
        const p = runOne(next).finally(() => {
          const idx = inflight.indexOf(p);
          if (idx >= 0) inflight.splice(idx, 1);
        });
        inflight.push(p);
      }
      if (inflight.length > 0) {
        await Promise.race(inflight);
      }
    }

    // Final summary + refresh the queue list on the right so the new bills
    // appear without a hard navigation.
    setItems((prev) => {
      const done = prev.filter((i) => i.status === 'done').length;
      const failed = prev.filter((i) => i.status === 'failed').length;
      const total = done + failed;
      setBatchSummary(
        `${done} processed${failed ? ` · ${failed} failed` : ''} · ${total} total.`,
      );
      return prev;
    });

    // If we created any vendor bills, navigate to the newest one so its
    // review pane auto-populates with the extracted fields. Without this,
    // when the URL already had `?id=oldBillId` from a previous review, the
    // new upload silently lands in the queue without switching the active
    // bill — the user reported this as "uploads not autopopulating the
    // review section". Expense uploads stay on the same URL since there's
    // no review pane for them on this page.
    const newestBill = [...outcomes].reverse().find((o) => o.kind === 'bill');
    if (newestBill) {
      router.push(`/bills/intake?id=${newestBill.subjectId}`);
    } else {
      router.refresh();
    }
  }

  const queuedCount = items.filter((i) => i.status === 'queued').length;
  const runnableCount = queuedCount;
  const someInFlight = items.some(
    (i) => i.status === 'reading' || i.status === 'extracting',
  );

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setHovering(true);
        }}
        onDragLeave={() => setHovering(false)}
        onDrop={(e) => {
          e.preventDefault();
          setHovering(false);
          if (e.dataTransfer.files?.length) {
            appendFiles(e.dataTransfer.files);
          }
        }}
        className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
          hovering
            ? 'border-brand bg-surface-hover'
            : 'border-line bg-surface-subtle/40'
        }`}
      >
        <span className="text-3xl">↑</span>
        <div>
          <div className="text-sm font-medium text-ink">
            Drop PDFs or photos here · up to {MAX_FILES} at a time
          </div>
          <div className="mt-1 text-xs text-ink-3">
            PDF · PNG · JPEG · HEIC · WebP up to 25 MB each · paste from
            clipboard · forward to email · sync from{' '}
            <span className="font-mono">/Invoices/Inbox/</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <Chip label="Receipts → expenses" />
          {canCreateBill && <Chip label="Vendor invoices → bills" />}
        </div>

        {canCreateBill && (
          <div
            role="radiogroup"
            aria-label="Default cost kind"
            className="flex items-center gap-2 rounded-full border border-line bg-card p-1 text-[11px]"
          >
            <KindToggle
              active={batchKind === 'expense'}
              onClick={() => setBatchKind('expense')}
              label="Expense for reimbursement"
              hint="we owe you"
            />
            <KindToggle
              active={batchKind === 'bill'}
              onClick={() => setBatchKind('bill')}
              label="FH paid"
              hint="for recording"
            />
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={[
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/heic',
            'image/heif',
            'image/webp',
            ...ALLOWED_EXT,
          ].join(',')}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) appendFiles(e.target.files);
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={items.length >= MAX_FILES || isPending}
          >
            Choose files
          </Button>
          {items.length > 0 && (
            <>
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  startTransition(() => {
                    void processQueue();
                  })
                }
                disabled={runnableCount === 0 || isPending || someInFlight}
              >
                {isPending || someInFlight
                  ? `Extracting…`
                  : runnableCount > 0
                    ? `Extract & queue ${runnableCount} file${runnableCount === 1 ? '' : 's'} →`
                    : 'Nothing queued'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={clearAll}
                disabled={isPending}
              >
                Clear
              </Button>
            </>
          )}
        </div>

        {batchSummary && (
          <p className="text-[11px] text-ink-3">{batchSummary}</p>
        )}
      </div>

      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((item) => {
            // Pressable when the file is valid to open. Once the
            // backend has produced a subjectId we land in the detail
            // page; otherwise we open the local preview in a new tab.
            const pressable = item.kind !== 'unknown';
            return (
              <li
                key={item.id}
                role={pressable ? 'button' : undefined}
                tabIndex={pressable ? 0 : undefined}
                onClick={pressable ? () => openItem(item) : undefined}
                onKeyDown={
                  pressable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openItem(item);
                        }
                      }
                    : undefined
                }
                className={`flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-card px-3 py-2 text-xs ${
                  pressable
                    ? 'cursor-pointer hover:border-brand hover:bg-surface-hover'
                    : ''
                }`}
                title={
                  pressable
                    ? item.subjectId
                      ? 'Click to open the saved row'
                      : 'Click to preview the file in a new tab'
                    : undefined
                }
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Thumbnail item={item} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <KindBadge kind={item.kind} />
                      <span className="truncate font-mono text-ink">
                        {item.fileName}
                      </span>
                    </div>
                    <div
                      className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-3"
                      // Inner controls (kind toggle, retry) shouldn't
                      // re-trigger the row's open-on-click handler.
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span>{formatBytes(item.size)}</span>
                      <span aria-hidden>·</span>
                      <RowKindToggle
                        item={item}
                        canCreateBill={canCreateBill}
                        onChange={(k) => setItemKind(item.id, k)}
                      />
                      {item.status === 'failed' && (
                        <>
                          <span aria-hidden>·</span>
                          <button
                            type="button"
                            onClick={() => {
                              retryItem(item.id);
                              startTransition(() => {
                                void processQueue();
                              });
                            }}
                            className="rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-2 hover:border-brand hover:text-brand"
                          >
                            ↻ Try again
                          </button>
                        </>
                      )}
                    </div>
                    {item.status === 'failed' && item.message && (
                      <div
                        className="mt-1 text-[11px] text-status-red"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {item.message}
                      </div>
                    )}
                    {/* Inline project tag — appears the moment an
                        expense row lands in 'done' state. Saves one
                        navigation step that previously forced the
                        user to open the expense detail page just to
                        pick a project. Bills get full classification
                        on the review pane instead, so we skip the
                        picker for them. */}
                    {item.status === 'done' &&
                      item.subjectId &&
                      item.intakeKind === 'expense' &&
                      projectOptions.length > 0 && (
                        <div
                          className="mt-1.5 text-[11px]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <InlineExpenseProjectTag
                            expenseId={item.subjectId}
                            projectOptions={projectOptions}
                          />
                        </div>
                      )}
                  </div>
                </div>
                <div
                  className="flex items-center gap-2"
                  // Status pill / open / remove are independent of the
                  // row-level open handler.
                  onClick={(e) => e.stopPropagation()}
                >
                  <StatusPill item={item} />
                  {item.subjectId && (
                    <a
                      href={
                        item.intakeKind === 'bill'
                          ? `/bills/intake?id=${item.subjectId}`
                          : `/expenses/${item.subjectId}`
                      }
                      className="text-brand hover:underline"
                    >
                      Open →
                    </a>
                  )}
                  {item.status !== 'reading' && item.status !== 'extracting' && (
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="text-ink-3 hover:text-status-red"
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Thumbnail({ item }: { item: QueueItem }) {
  const base =
    'h-12 w-12 shrink-0 overflow-hidden rounded-md border border-line bg-surface-subtle';
  if (item.thumbnailUrl) {
    return (
      <div className={`${base} relative`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.thumbnailUrl}
          alt={`Preview · ${item.fileName}`}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }
  // PDF / HEIC / unknown — show a labelled icon tile so the user still
  // sees a per-row affordance (just not the literal pixels).
  const label =
    item.kind === 'pdf'
      ? 'PDF'
      : item.kind === 'heic'
        ? 'HEIC'
        : item.kind === 'image'
          ? 'IMG'
          : '?';
  const tone =
    item.kind === 'pdf'
      ? 'text-status-green'
      : item.kind === 'heic'
        ? 'text-status-amber'
        : 'text-ink-3';
  return (
    <div
      className={`${base} flex items-center justify-center text-[10px] font-semibold uppercase tracking-wide ${tone}`}
    >
      {label}
    </div>
  );
}

function StatusPill({ item }: { item: QueueItem }) {
  if (item.status === 'queued') {
    return (
      <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3">
        queued
      </span>
    );
  }
  if (item.status === 'reading') {
    return (
      <span className="rounded-full bg-status-blue-soft px-2 py-0.5 text-[10px] text-status-blue">
        reading…
      </span>
    );
  }
  if (item.status === 'extracting') {
    return (
      <span className="rounded-full bg-status-amber-soft px-2 py-0.5 text-[10px] text-status-amber">
        extracting…
      </span>
    );
  }
  if (item.status === 'done') {
    return (
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] ${
          item.extractionOk
            ? 'bg-status-green-soft text-status-green'
            : 'bg-status-amber-soft text-status-amber'
        }`}
        title={item.message ?? ''}
      >
        {item.extractionOk
          ? `✓ ${item.confidencePct ?? '—'}%`
          : 'queued · review'}
      </span>
    );
  }
  return (
    <span
      className="rounded-full bg-status-red-soft px-2 py-0.5 text-[10px] text-status-red"
      title={item.message ?? item.validationError ?? ''}
    >
      failed{item.validationError ? ` · ${item.validationError}` : ''}
    </span>
  );
}

function KindBadge({ kind }: { kind: FileKind }) {
  const map: Record<FileKind, { label: string; tone: string }> = {
    pdf: { label: 'PDF', tone: 'bg-status-green-soft text-status-green' },
    image: { label: 'Photo', tone: 'bg-status-blue-soft text-status-blue' },
    heic: { label: 'HEIC', tone: 'bg-status-amber-soft text-status-amber' },
    unknown: { label: '?', tone: 'bg-surface-subtle text-ink-3' },
  };
  const m = map[kind];
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${m.tone}`}
    >
      {m.label}
    </span>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-2 py-1 text-ink-3">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-green" />
      {label}
    </span>
  );
}

function KindToggle({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`rounded-full px-3 py-1 transition-colors ${
        active
          ? 'bg-brand text-white shadow-sm'
          : 'text-ink-2 hover:bg-surface-hover'
      }`}
    >
      <span className="font-medium">{label}</span>{' '}
      <span className={active ? 'text-white/70' : 'text-ink-3'}>
        · {hint}
      </span>
    </button>
  );
}

/**
 * Inline project picker on a done-state expense row. Auto-saves on
 * change via the existing `tagExpenseProject` server action — no
 * extra Save click. Tiny status text fades in next to the picker
 * during the tag-saving round trip.
 *
 * This is the staff "consultant on the couch with their phone"
 * affordance: drop receipt → wait 5s for OCR → tap project from
 * dropdown → done, no detail page round-trip needed.
 */
function InlineExpenseProjectTag({
  expenseId,
  projectOptions,
}: {
  expenseId: string;
  projectOptions: Array<{ id: string; code: string; name: string }>;
}) {
  const [projectId, setProjectId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string) {
    setProjectId(next);
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const fd = new FormData();
      fd.set('projectId', next);
      const res = await tagExpenseProject(expenseId, { status: 'idle' }, fd);
      if (res.status === 'success') {
        setSaved(true);
        // Fade the success affordance after a moment so consecutive
        // edits don't pile up "Saved" markers.
        setTimeout(() => setSaved(false), 2000);
      } else if (res.status === 'error') {
        setError(res.message);
      }
    } catch (err) {
      setError((err as Error).message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-ink-3">Project:</span>
      <select
        value={projectId}
        onChange={(e) => void save(e.target.value)}
        disabled={saving}
        className="h-6 max-w-[200px] rounded-md border border-line bg-surface-elev px-1.5 text-[11px] text-ink"
      >
        <option value="">— Pick project —</option>
        {projectOptions.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code} · {p.name}
          </option>
        ))}
      </select>
      {saving && <span className="text-ink-3">saving…</span>}
      {saved && <span className="text-status-green">✓ saved</span>}
      {error && <span className="text-status-red">{error}</span>}
    </span>
  );
}

/**
 * Per-row pill that lets the user flip a single file between expense
 * (personal reimbursement) and bill (vendor AP). Locked to 'expense' if the
 * viewer doesn't have bill-create capability — they see the badge as a
 * non-interactive label so they know what's happening.
 */
function RowKindToggle({
  item,
  canCreateBill,
  onChange,
}: {
  item: QueueItem;
  canCreateBill: boolean;
  onChange: (k: IntakeKind) => void;
}) {
  const editable =
    canCreateBill && (item.status === 'queued' || item.status === 'failed');
  // Short per-row chips. Match the batch toggle copy.
  const labelExpense = '↩ reimburse';
  const labelBill = '🏷 FH paid';
  if (!editable) {
    return (
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
          item.intakeKind === 'bill'
            ? 'bg-status-amber-soft text-status-amber'
            : 'bg-status-blue-soft text-status-blue'
        }`}
      >
        {item.intakeKind === 'bill' ? labelBill : labelExpense}
      </span>
    );
  }
  return (
    <span
      role="radiogroup"
      aria-label="Where this row lands"
      className="inline-flex items-center gap-0.5 rounded-full border border-line bg-card p-0.5 text-[10px]"
    >
      <button
        type="button"
        role="radio"
        aria-checked={item.intakeKind === 'expense'}
        onClick={() => onChange('expense')}
        className={`rounded-full px-2 py-0.5 ${
          item.intakeKind === 'expense'
            ? 'bg-status-blue-soft text-status-blue'
            : 'text-ink-3 hover:bg-surface-hover'
        }`}
      >
        {labelExpense}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={item.intakeKind === 'bill'}
        onClick={() => onChange('bill')}
        className={`rounded-full px-2 py-0.5 ${
          item.intakeKind === 'bill'
            ? 'bg-status-amber-soft text-status-amber'
            : 'text-ink-3 hover:bg-surface-hover'
        }`}
      >
        {labelBill}
      </button>
    </span>
  );
}
