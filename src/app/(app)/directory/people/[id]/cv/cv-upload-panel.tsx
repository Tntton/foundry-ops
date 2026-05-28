'use client';

import { useRef, useState, useTransition } from 'react';
import {
  extractCv,
  commitCvExtraction,
  type CvExtractState,
} from './actions';
import { Button } from '@/components/ui/button';

/**
 * CV upload + LLM extraction.
 *
 * Flow:
 *   1. User picks a PDF and clicks "Extract".
 *   2. Server action sends the PDF to Claude with a structured-output
 *      prompt, returns parsed education / work history.
 *   3. Preview renders editable cards — user can adjust any field
 *      inline before committing.
 *   4. "Save to profile" replaces the existing education / work
 *      entries with the previewed set.
 *
 * Errors surface inline. The original PDF isn't persisted — we only
 * keep the extracted structured data.
 */
export function CvUploadPanel({
  personId,
  canEdit,
}: {
  personId: string;
  canEdit: boolean;
}) {
  const [state, setState] = useState<CvExtractState>({ status: 'idle' });
  const [pending, startTransition] = useTransition();
  const [committing, startCommit] = useTransition();
  const [filename, setFilename] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Local editable copies of the preview so the user can tweak before
  // committing without round-tripping to Claude again.
  const [education, setEducation] = useState<
    Extract<CvExtractState, { status: 'preview' }>['education']
  >([]);
  const [work, setWork] = useState<
    Extract<CvExtractState, { status: 'preview' }>['work']
  >([]);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFilename(f?.name ?? null);
  }

  function extract() {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.set('cvFile', file);
    startTransition(async () => {
      const result = await extractCv(personId, state, fd);
      setState(result);
      if (result.status === 'preview') {
        setEducation(result.education);
        setWork(result.work);
      }
    });
  }

  function commit() {
    startCommit(async () => {
      const result = await commitCvExtraction(personId, { education, work });
      if (result.ok) {
        setState({
          status: 'committed',
          education: education.length,
          work: work.length,
        });
        setFilename(null);
        if (inputRef.current) inputRef.current.value = '';
      } else {
        setState({
          status: 'error',
          message: result.message ?? 'Save failed',
        });
      }
    });
  }

  function cancelPreview() {
    setState({ status: 'idle' });
    setEducation([]);
    setWork([]);
  }

  if (!canEdit) {
    return (
      <div className="rounded-md border border-dashed border-line bg-card p-3 text-xs text-ink-3">
        CV upload + extraction is available to the person themselves and
        admins / partners. No edit access on this profile.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-line bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">CV upload</h3>
        <p className="text-[11px] text-ink-3">
          Drop a PDF CV — Claude extracts education + work history,
          shows you a preview, and you can tweak anything before saving
          to the profile. Replaces existing entries on save.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={onFileChange}
          disabled={pending || state.status === 'preview'}
          className="block w-full max-w-sm cursor-pointer rounded border border-line bg-surface-elev px-2 py-1.5 text-xs text-ink-2 file:mr-2 file:rounded file:border-0 file:bg-brand file:px-2 file:py-1 file:text-xs file:text-brand-ink hover:file:bg-brand/90"
        />
        <Button
          type="button"
          size="sm"
          onClick={extract}
          disabled={pending || !filename || state.status === 'preview'}
        >
          {pending ? 'Extracting…' : 'Extract'}
        </Button>
        {filename && state.status !== 'preview' && (
          <span className="text-[11px] text-ink-3">{filename}</span>
        )}
      </div>

      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-xs text-status-red">
          {state.message}
        </div>
      )}
      {state.status === 'committed' && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-xs text-status-green">
          Saved · {state.education} education entr
          {state.education === 1 ? 'y' : 'ies'} + {state.work} work entr
          {state.work === 1 ? 'y' : 'ies'} written to the profile.
        </div>
      )}

      {state.status === 'preview' && (
        <div className="space-y-3">
          <div className="rounded-md border border-status-amber bg-status-amber-soft/40 px-3 py-2 text-xs text-status-amber">
            <strong>Preview only</strong> — review and edit the
            extracted data, then click <em>Save to profile</em>. Saving
            replaces any existing education / work entries.
          </div>

          <PreviewSection
            title="Education"
            empty="No education extracted."
            rows={education}
            onChange={setEducation}
            fields={[
              { key: 'institution', label: 'Institution', required: true },
              { key: 'degree', label: 'Degree' },
              { key: 'field', label: 'Field' },
              { key: 'startYear', label: 'Start' },
              { key: 'endYear', label: 'End' },
              { key: 'notes', label: 'Notes', multiline: true },
            ]}
          />

          <PreviewSection
            title="Work history"
            empty="No work history extracted."
            rows={work}
            onChange={setWork}
            fields={[
              { key: 'company', label: 'Company', required: true },
              { key: 'title', label: 'Title' },
              { key: 'location', label: 'Location' },
              { key: 'startYear', label: 'Start' },
              { key: 'endYear', label: 'End' },
              {
                key: 'current',
                label: 'Current',
                kind: 'boolean',
              },
              { key: 'description', label: 'Description', multiline: true },
            ]}
          />

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={cancelPreview}
              disabled={committing}
            >
              Discard
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={commit}
              disabled={committing}
            >
              {committing ? 'Saving…' : 'Save to profile'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

type FieldDef = {
  key: string;
  label: string;
  required?: boolean;
  multiline?: boolean;
  kind?: 'string' | 'boolean';
};

function PreviewSection<T extends Record<string, unknown>>({
  title,
  empty,
  rows,
  onChange,
  fields,
}: {
  title: string;
  empty: string;
  rows: T[];
  onChange: (next: T[]) => void;
  fields: FieldDef[];
}) {
  function update(idx: number, key: string, value: unknown) {
    onChange(
      rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)),
    );
  }
  function remove(idx: number) {
    onChange(rows.filter((_, i) => i !== idx));
  }
  function add() {
    const blank: Record<string, unknown> = {};
    for (const f of fields) {
      blank[f.key] = f.kind === 'boolean' ? false : null;
    }
    onChange([...rows, blank as T]);
  }
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          {title} ({rows.length})
        </h4>
        <button
          type="button"
          onClick={add}
          className="text-[11px] text-brand hover:underline"
        >
          + Add row
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-line p-3 text-center text-xs text-ink-3">
          {empty}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, idx) => (
            <li
              key={idx}
              className="rounded-md border border-line bg-surface-subtle/40 p-2"
            >
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {fields.map((f) => {
                  if (f.kind === 'boolean') {
                    return (
                      <label
                        key={f.key}
                        className="flex items-center gap-1.5 text-[11px] text-ink-3"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(r[f.key])}
                          onChange={(e) =>
                            update(idx, f.key, e.target.checked)
                          }
                          className="h-3.5 w-3.5"
                        />
                        <span>{f.label}</span>
                      </label>
                    );
                  }
                  const val = (r[f.key] ?? '') as string;
                  return (
                    <label
                      key={f.key}
                      className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide text-ink-3"
                    >
                      <span>
                        {f.label}
                        {f.required && (
                          <span className="ml-0.5 text-status-amber">*</span>
                        )}
                      </span>
                      {f.multiline ? (
                        <textarea
                          rows={2}
                          value={val}
                          onChange={(e) =>
                            update(idx, f.key, e.target.value || null)
                          }
                          className="rounded border border-line bg-surface-elev px-1.5 py-1 text-xs normal-case text-ink focus:border-brand"
                        />
                      ) : (
                        <input
                          type="text"
                          value={val}
                          onChange={(e) =>
                            update(idx, f.key, e.target.value || null)
                          }
                          className="rounded border border-line bg-surface-elev px-1.5 py-1 text-xs normal-case text-ink focus:border-brand"
                        />
                      )}
                    </label>
                  );
                })}
              </div>
              <div className="mt-1.5 flex justify-end">
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="text-[10px] text-ink-3 hover:text-status-red"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
