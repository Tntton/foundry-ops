'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useRef, useState, useTransition } from 'react';
import {
  uploadEngagementDoc,
  generateWorkOrderDraft,
  saveWorkOrderDraft,
  type PaperworkState,
} from './actions';
import { Button } from '@/components/ui/button';

const initial: PaperworkState = { status: 'idle' };

export type ProjectPaperworkSnapshot = {
  id: string;
  code: string;
  csaSharepointUrl: string | null;
  csaUploadedAt: Date | null;
  workOrderSharepointUrl: string | null;
  workOrderUploadedAt: Date | null;
  workOrderDraftText: string | null;
  workOrderGeneratedAt: Date | null;
};

/**
 * Two halves: CSA (master agreement, usually pre-existing) and Work Order
 * (per-project scope under the CSA). For each, the partner can either
 * upload a signed PDF or — for the WO — auto-generate a Markdown draft
 * from the project's commercial fields.
 */
export function ProjectPaperworkPanel({
  project,
  canEdit,
}: {
  project: ProjectPaperworkSnapshot;
  canEdit: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DocBlock
          title="Client Services Agreement (CSA)"
          subtitle="Master legal framework with the client. Reused across every Work Order."
          kind="csa"
          projectId={project.id}
          uploadedAt={project.csaUploadedAt}
          docDataUrl={project.csaSharepointUrl}
          canEdit={canEdit}
          allowGenerate={false}
          generatedAt={null}
          draftText={null}
        />
        <DocBlock
          title="Work Order (WO)"
          subtitle="Per-project scope under the CSA. Auto-generate a draft, edit, then upload the signed PDF."
          kind="workOrder"
          projectId={project.id}
          uploadedAt={project.workOrderUploadedAt}
          docDataUrl={project.workOrderSharepointUrl}
          canEdit={canEdit}
          allowGenerate
          generatedAt={project.workOrderGeneratedAt}
          draftText={project.workOrderDraftText}
        />
      </div>
    </div>
  );
}

function DocBlock({
  title,
  subtitle,
  kind,
  projectId,
  uploadedAt,
  docDataUrl,
  canEdit,
  allowGenerate,
  generatedAt,
  draftText,
}: {
  title: string;
  subtitle: string;
  kind: 'csa' | 'workOrder';
  projectId: string;
  uploadedAt: Date | null;
  docDataUrl: string | null;
  canEdit: boolean;
  allowGenerate: boolean;
  generatedAt: Date | null;
  draftText: string | null;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-line bg-card p-4">
      <header>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="text-[11px] text-ink-3">{subtitle}</p>
      </header>

      {/* State 1: a signed/uploaded doc exists. Show it inline if it's a
          PDF data URL; otherwise just link out. */}
      {docDataUrl ? (
        <UploadedDocView
          docDataUrl={docDataUrl}
          uploadedAt={uploadedAt}
          title={title}
        />
      ) : draftText ? (
        // State 2: a generated Markdown draft (WO only) — show editable.
        <DraftEditor
          projectId={projectId}
          draftText={draftText}
          generatedAt={generatedAt}
          canEdit={canEdit}
        />
      ) : (
        <div className="rounded-md border border-dashed border-line bg-surface-subtle/40 p-4 text-center text-xs text-ink-3">
          Nothing on file yet.
        </div>
      )}

      {/* Actions: always allow re-upload; for WO also allow regenerate. */}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <UploadButton kind={kind} projectId={projectId} />
          {allowGenerate && (
            <GenerateDraftButton
              projectId={projectId}
              hasDraft={Boolean(draftText)}
            />
          )}
        </div>
      )}
    </section>
  );
}

function UploadedDocView({
  docDataUrl,
  uploadedAt,
  title,
}: {
  docDataUrl: string;
  uploadedAt: Date | null;
  title: string;
}) {
  const isDataUrl = docDataUrl.startsWith('data:');
  const dataMime = isDataUrl ? docDataUrl.slice(5, docDataUrl.indexOf(';')) : null;
  const isPdf = isDataUrl && dataMime === 'application/pdf';
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] text-ink-3">
        <span>
          Uploaded{' '}
          {uploadedAt
            ? uploadedAt.toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })
            : '—'}
        </span>
        <a
          href={docDataUrl}
          target="_blank"
          rel="noreferrer"
          className="text-brand hover:underline"
        >
          Open in new tab ↗
        </a>
      </div>
      {isPdf ? (
        <div className="overflow-hidden rounded-md border border-line">
          <iframe
            src={docDataUrl}
            title={title}
            className="h-[420px] w-full"
          />
        </div>
      ) : (
        <div className="rounded-md border border-line bg-surface-subtle/40 p-3 text-center text-xs text-ink-3">
          Document attached. Open in new tab to view.
        </div>
      )}
    </div>
  );
}

function DraftEditor({
  projectId,
  draftText,
  generatedAt,
  canEdit,
}: {
  projectId: string;
  draftText: string;
  generatedAt: Date | null;
  canEdit: boolean;
}) {
  const [state, action] = useFormState(saveWorkOrderDraft, initial);
  const [text, setText] = useState(draftText);

  function copyToClipboard() {
    void navigator.clipboard.writeText(text);
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex items-center justify-between text-[11px] text-ink-3">
        <span>
          Draft generated{' '}
          {generatedAt
            ? generatedAt.toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })
            : '—'}{' '}
          · markdown
        </span>
        <button
          type="button"
          onClick={copyToClipboard}
          className="text-brand hover:underline"
        >
          Copy to clipboard
        </button>
      </div>
      <textarea
        name="workOrderDraftText"
        value={text}
        onChange={(e) => setText(e.target.value)}
        readOnly={!canEdit}
        rows={16}
        className="block w-full rounded-md border border-line bg-surface-elev p-3 font-mono text-[11px] leading-relaxed text-ink"
      />
      {state.status === 'error' && (
        <p className="text-[11px] text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-[11px] text-status-green">{state.message}</p>
      )}
      {canEdit && <SaveDraftButton />}
    </form>
  );
}

function SaveDraftButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? 'Saving…' : 'Save draft edits'}
    </Button>
  );
}

function GenerateDraftButton({
  projectId,
  hasDraft,
}: {
  projectId: string;
  hasDraft: boolean;
}) {
  const [state, action] = useFormState(generateWorkOrderDraft, initial);
  return (
    <form action={action} className="contents">
      <input type="hidden" name="projectId" value={projectId} />
      <GenerateSubmit hasDraft={hasDraft} />
      {state.status === 'error' && (
        <span className="text-[11px] text-status-red">{state.message}</span>
      )}
      {state.status === 'success' && (
        <span className="text-[11px] text-status-green">{state.message}</span>
      )}
    </form>
  );
}

function GenerateSubmit({ hasDraft }: { hasDraft: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending
        ? 'Generating…'
        : hasDraft
          ? 'Regenerate draft from project fields'
          : 'Generate draft from template'}
    </Button>
  );
}

function UploadButton({
  kind,
  projectId,
}: {
  kind: 'csa' | 'workOrder';
  projectId: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, action] = useFormState(uploadEngagementDoc, initial);
  const [pending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function readFile(file: File): Promise<{ base64: string; mime: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const comma = result.indexOf(',');
        const base64 = comma >= 0 ? result.slice(comma + 1) : result;
        const mime = file.type || 'application/pdf';
        resolve({ base64, mime });
      };
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(file);
    });
  }

  async function onPick(file: File) {
    setErrorMsg(null);
    if (file.size > 12 * 1024 * 1024) {
      setErrorMsg('Max 12 MB.');
      return;
    }
    let body: { base64: string; mime: string };
    try {
      body = await readFile(file);
    } catch {
      setErrorMsg('Could not read file.');
      return;
    }
    const fd = new FormData();
    fd.set('projectId', projectId);
    fd.set('kind', kind);
    fd.set('fileBase64', body.base64);
    fd.set('fileMime', body.mime);
    fd.set('fileName', file.name);
    startTransition(() => {
      action(fd);
    });
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onPick(f);
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => fileInputRef.current?.click()}
        disabled={pending}
      >
        {pending ? 'Uploading…' : 'Upload PDF'}
      </Button>
      {(state.status === 'error' || errorMsg) && (
        <span className="text-[11px] text-status-red">
          {errorMsg ?? (state.status === 'error' ? state.message : '')}
        </span>
      )}
      {state.status === 'success' && (
        <span className="text-[11px] text-status-green">{state.message}</span>
      )}
    </>
  );
}
