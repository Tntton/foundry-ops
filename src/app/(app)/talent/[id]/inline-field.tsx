'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { patchRecruitField, type PatchFieldState } from '../actions';

/**
 * Click-to-edit field on the talent detail page. Two variants:
 *   - 'input'    → single-line text/email/url with Enter to save
 *   - 'textarea' → multi-line, ⌘+Enter (or Ctrl+Enter) to save
 *
 * Both: Escape cancels, blur commits, brief "✓ Saved" badge flashes
 * on success. Errors surface inline below the field so admin sees
 * what failed without leaving the row.
 *
 * Read-mode display formats the value by `type`:
 *   - email → mailto link
 *   - url   → external link with the host stripped for readability
 *   - text  → plain text
 *   - textarea → whitespace-preserved paragraph
 *
 * Disabled (read-only) when canEdit=false — used for converted
 * recruits where the Person record is now the source of truth.
 */
export function InlineRecruitField({
  recruitId,
  field,
  initialValue,
  variant = 'input',
  inputType = 'text',
  placeholder,
  emptyLabel = '—',
  canEdit = true,
}: {
  recruitId: string;
  field:
    | 'email'
    | 'linkedinUrl'
    | 'cvSharepointUrl'
    | 'notes'
    | 'phone'
    | 'location'
    | 'source'
    | 'stage';
  initialValue: string | null;
  variant?: 'input' | 'textarea';
  /** Only used when variant='input'. Drives display formatting + the
   *  HTML input type attribute. */
  inputType?: 'text' | 'email' | 'url';
  placeholder?: string;
  emptyLabel?: string;
  canEdit?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue ?? '');
  const [savedValue, setSavedValue] = useState(initialValue ?? '');
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<PatchFieldState>({ status: 'idle' });
  const [showSaved, setShowSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Focus the input/textarea when entering edit mode + select-all so
  // a quick second click replaces the existing value cleanly.
  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (typeof el.select === 'function') el.select();
  }, [editing]);

  function commit() {
    if (value === savedValue) {
      setEditing(false);
      setState({ status: 'idle' });
      return;
    }
    const fd = new FormData();
    fd.set('field', field);
    fd.set('value', value);
    startTransition(async () => {
      const res = await patchRecruitField(recruitId, { status: 'idle' }, fd);
      setState(res);
      if (res.status === 'success') {
        setSavedValue(value);
        setEditing(false);
        setShowSaved(true);
        window.setTimeout(() => setShowSaved(false), 1800);
      }
    });
  }

  function cancel() {
    setValue(savedValue);
    setEditing(false);
    setState({ status: 'idle' });
  }

  function onKeyDown(
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    if (variant === 'input' && e.key === 'Enter') {
      e.preventDefault();
      commit();
      return;
    }
    if (variant === 'textarea' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    }
  }

  // ── Read-mode display ─────────────────────────────────────────
  if (!editing) {
    const isEmpty = !savedValue || savedValue.trim() === '';
    const baseSpan =
      'group inline-flex items-baseline gap-1 max-w-full ' +
      (canEdit
        ? 'cursor-text rounded px-1 -mx-1 hover:bg-surface-hover'
        : '');
    const display = (() => {
      if (isEmpty) {
        return (
          <span className="italic text-ink-4">
            {placeholder ?? emptyLabel}
          </span>
        );
      }
      if (variant === 'textarea') {
        return (
          <span className="whitespace-pre-wrap text-ink">{savedValue}</span>
        );
      }
      if (inputType === 'email') {
        return (
          <a
            href={`mailto:${savedValue}`}
            className="text-brand hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {savedValue}
          </a>
        );
      }
      if (inputType === 'url') {
        const href = /^https?:\/\//.test(savedValue)
          ? savedValue
          : `https://${savedValue}`;
        return (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-brand hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {savedValue.replace(/^https?:\/\/(www\.)?/, '')}
          </a>
        );
      }
      return <span className="text-ink">{savedValue}</span>;
    })();
    return (
      <span
        onClick={() => canEdit && setEditing(true)}
        className={baseSpan}
        title={canEdit ? 'Click to edit' : undefined}
      >
        {display}
        {canEdit && (
          <span className="text-[9px] text-ink-4 opacity-0 transition-opacity group-hover:opacity-100">
            ✎
          </span>
        )}
        {showSaved && (
          <span className="text-[10px] text-status-green">✓ saved</span>
        )}
      </span>
    );
  }

  // ── Edit mode ────────────────────────────────────────────────
  const commonProps = {
    value,
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => setValue(e.target.value),
    onKeyDown,
    onBlur: () => commit(),
    disabled: pending,
    placeholder,
  };
  return (
    <span className="inline-flex w-full flex-col gap-1">
      {variant === 'textarea' ? (
        <textarea
          {...commonProps}
          ref={(r) => {
            inputRef.current = r;
          }}
          rows={6}
          className="w-full rounded-md border border-line bg-surface-elev px-3 py-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      ) : (
        <input
          {...commonProps}
          ref={(r) => {
            inputRef.current = r;
          }}
          type={inputType}
          className="h-8 w-full max-w-md rounded-md border border-line bg-surface-elev px-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      )}
      <span className="flex items-center gap-2 text-[10px] text-ink-3">
        {pending ? (
          <span>Saving…</span>
        ) : (
          <span>
            {variant === 'textarea'
              ? '⌘+Enter to save · Esc to cancel'
              : 'Enter to save · Esc to cancel'}
          </span>
        )}
        {state.status === 'error' && (
          <span className="text-status-red">{state.message}</span>
        )}
      </span>
    </span>
  );
}
