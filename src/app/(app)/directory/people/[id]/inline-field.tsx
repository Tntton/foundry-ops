'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  updatePersonField,
  type InlineFieldState,
} from './inline-actions';

/**
 * Inline-editable field on the personnel file. Renders the value as
 * read-only text by default; clicking turns it into an `<input>` (or
 * `<textarea>` when `multiline`). Saving fires `updatePersonField` and
 * the new value persists in place.
 *
 *   - **Enter** saves and exits edit mode (single-line); **Shift+Enter**
 *     inserts a newline in multiline mode.
 *   - **Esc** cancels and reverts to the previous value.
 *   - **Blur** also commits — keeps the flow Excel-like (click out to
 *     persist).
 *
 * If the underlying user can't edit (no permission or non-self read-
 * only field), the value renders without an editable affordance — no
 * cursor change, no chrome.
 */
export function InlineField({
  personId,
  field,
  initialValue,
  placeholder,
  canEdit,
  multiline = false,
  type = 'text',
  emptyLabel = '—',
}: {
  personId: string;
  field: string;
  initialValue: string | null;
  placeholder?: string;
  canEdit: boolean;
  multiline?: boolean;
  type?: 'text' | 'tel' | 'email' | 'url';
  emptyLabel?: string;
}) {
  // Read-only display formatting is driven by `type` — keeping it
  // here (inside the client component) instead of a `format` prop
  // because functions can't cross the RSC boundary. URL values
  // render as a clickable link with the protocol/host prefix
  // stripped for readability; email values get a `mailto:`; tel
  // values get a `tel:`; everything else is plain text.
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue ?? '');
  const [savedValue, setSavedValue] = useState(initialValue ?? '');
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<InlineFieldState>({ ok: true });
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select?.();
    }
  }, [editing]);

  function commit() {
    if (value === savedValue) {
      setEditing(false);
      return;
    }
    const fd = new FormData();
    fd.set('field', field);
    fd.set('value', value);
    startTransition(async () => {
      const result = await updatePersonField(
        personId,
        { ok: true } as InlineFieldState,
        fd,
      );
      setState(result);
      if (result.ok) {
        setSavedValue(value);
        setEditing(false);
      } else {
        // Keep editor open so the user can fix and retry.
      }
    });
  }

  function cancel() {
    setValue(savedValue);
    setEditing(false);
    setState({ ok: true });
  }

  function onKeyDown(
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }

  // ── Read-only display ─────────────────────────────────────────
  if (!editing) {
    const isEmpty = !savedValue || savedValue.trim() === '';
    return (
      <span
        onClick={() => canEdit && setEditing(true)}
        className={`group inline-flex items-baseline gap-1 ${
          canEdit
            ? 'cursor-text rounded px-0.5 -mx-0.5 hover:bg-surface-hover'
            : ''
        }`}
        title={canEdit ? 'Click to edit' : undefined}
      >
        {isEmpty ? (
          <span className="text-ink-4 italic">
            {placeholder ?? emptyLabel}
          </span>
        ) : type === 'url' ? (
          <a
            href={
              savedValue.match(/^https?:\/\//)
                ? savedValue
                : `https://${savedValue}`
            }
            target="_blank"
            rel="noreferrer"
            className="text-brand hover:underline"
            // Stop the click from bubbling up to the wrapper span's
            // onClick (which would otherwise flip the field into edit
            // mode instead of following the link).
            onClick={(e) => e.stopPropagation()}
          >
            {savedValue.replace(/^https?:\/\/(www\.)?/, '')}
          </a>
        ) : type === 'email' ? (
          <a
            href={`mailto:${savedValue}`}
            className="text-brand hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {savedValue}
          </a>
        ) : type === 'tel' ? (
          <a
            href={`tel:${savedValue.replace(/\s+/g, '')}`}
            className="text-ink hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {savedValue}
          </a>
        ) : (
          <span className="text-ink whitespace-pre-wrap">{savedValue}</span>
        )}
        {canEdit && (
          <span className="text-[9px] text-ink-4 opacity-0 transition-opacity group-hover:opacity-100">
            ✎
          </span>
        )}
      </span>
    );
  }

  // ── Edit mode ─────────────────────────────────────────────────
  const commonProps = {
    value,
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => setValue(e.target.value),
    onKeyDown,
    onBlur: () => commit(),
    disabled: pending,
    placeholder,
    className:
      'w-full min-w-[160px] rounded border border-line bg-surface-elev px-1.5 py-0.5 text-sm text-ink focus:border-brand focus:bg-white disabled:bg-surface-subtle',
  };
  return (
    <span className="inline-flex flex-col items-stretch gap-0.5">
      {multiline ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          rows={3}
          {...commonProps}
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type={type}
          {...commonProps}
        />
      )}
      {!state.ok && (
        <span className="text-[10px] text-status-red">
          {state.message}
        </span>
      )}
    </span>
  );
}
