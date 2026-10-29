'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import {
  createChecklist,
  deleteChecklist,
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
  assignChecklistItem,
  type ChecklistActionState,
} from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PersonAvatar } from '@/components/person-avatar';

export type PersonOpt = {
  id: string;
  initials: string;
  headshotUrl: string | null;
  firstName: string;
  lastName: string;
};

export type ChecklistDTO = {
  id: string;
  label: string;
  items: Array<{
    id: string;
    label: string;
    done: boolean;
    doneAt: Date | null;
    assigneeId: string | null;
  }>;
};

export function ProjectChecklistsPanel({
  projectId,
  checklists,
  people,
  canEdit,
}: {
  projectId: string;
  checklists: ChecklistDTO[];
  people: PersonOpt[];
  canEdit: boolean;
}) {
  const peopleById = new Map(people.map((p) => [p.id, p]));
  return (
    <div className="space-y-4">
      {checklists.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-ink-3">
            No checklists yet. Add one to track delivery gates, sign-offs, or
            admin to-dos on this project.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {checklists.map((cl) => (
            <ChecklistCard
              key={cl.id}
              projectId={projectId}
              checklist={cl}
              people={people}
              peopleById={peopleById}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}
      {canEdit && <NewChecklistForm projectId={projectId} />}
    </div>
  );
}

function ChecklistCard({
  projectId,
  checklist,
  people,
  peopleById,
  canEdit,
}: {
  projectId: string;
  checklist: ChecklistDTO;
  people: PersonOpt[];
  peopleById: Map<string, PersonOpt>;
  canEdit: boolean;
}) {
  const done = checklist.items.filter((i) => i.done).length;
  const total = checklist.items.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle>{checklist.label}</CardTitle>
          <p className="mt-0.5 text-xs text-ink-3">
            {done} / {total} done ({pct}%)
          </p>
        </div>
        {canEdit && <DeleteListBtn projectId={projectId} checklistId={checklist.id} />}
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-subtle">
          <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
        <ul className="space-y-1">
          {checklist.items.map((item) => (
            <ItemRow
              key={item.id}
              projectId={projectId}
              item={item}
              people={people}
              peopleById={peopleById}
              canEdit={canEdit}
            />
          ))}
          {checklist.items.length === 0 && (
            <li className="text-xs text-ink-4">No items yet.</li>
          )}
        </ul>
        {canEdit && <AddItemForm projectId={projectId} checklistId={checklist.id} />}
      </CardContent>
    </Card>
  );
}

function ItemRow({
  projectId,
  item,
  people,
  peopleById,
  canEdit,
}: {
  projectId: string;
  item: ChecklistDTO['items'][number];
  people: PersonOpt[];
  peopleById: Map<string, PersonOpt>;
  canEdit: boolean;
}) {
  const toggleBound = toggleChecklistItem.bind(null, projectId, item.id);
  const [, toggleAction] = useFormState<ChecklistActionState, FormData>(toggleBound, {
    status: 'idle',
  });
  const deleteBound = deleteChecklistItem.bind(null, projectId, item.id);
  const [, deleteAction] = useFormState<ChecklistActionState, FormData>(deleteBound, {
    status: 'idle',
  });

  const assignee = (item.assigneeId ? peopleById.get(item.assigneeId) : null) ?? null;

  return (
    <li className="flex items-start gap-2 text-sm">
      {canEdit ? (
        <form action={toggleAction as unknown as (fd: FormData) => void}>
          <button
            type="submit"
            className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
              item.done
                ? 'border-brand bg-brand text-brand-ink'
                : 'border-line bg-surface-elev text-transparent hover:border-ink-3'
            }`}
            aria-label={item.done ? 'Mark as not done' : 'Mark as done'}
          >
            ✓
          </button>
        </form>
      ) : (
        <span
          className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
            item.done ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface-elev'
          }`}
        >
          {item.done ? '✓' : ''}
        </span>
      )}
      <span
        className={
          item.done
            ? 'flex-1 text-ink-3 line-through'
            : 'flex-1 text-ink'
        }
      >
        {item.label}
      </span>
      <AssigneeControl
        projectId={projectId}
        item={item}
        assignee={assignee}
        people={people}
        canEdit={canEdit}
      />
      {canEdit && (
        <form action={deleteAction as unknown as (fd: FormData) => void}>
          <button
            type="submit"
            className="text-[10px] text-ink-4 hover:text-status-red"
            onClick={(e) => {
              if (!confirm('Remove this item?')) e.preventDefault();
            }}
          >
            ×
          </button>
        </form>
      )}
    </li>
  );
}

/**
 * Per-item ownership control. Editors get an inline person picker that
 * auto-submits on change (mirroring the risk register's inline selects);
 * everyone else sees the assignee's avatar, or nothing when unassigned.
 */
function AssigneeControl({
  projectId,
  item,
  assignee,
  people,
  canEdit,
}: {
  projectId: string;
  item: ChecklistDTO['items'][number];
  assignee: PersonOpt | null;
  people: PersonOpt[];
  canEdit: boolean;
}) {
  const assignBound = assignChecklistItem.bind(null, projectId, item.id);
  const [, assignAction] = useFormState<ChecklistActionState, FormData>(assignBound, {
    status: 'idle',
  });

  if (!canEdit) {
    return assignee ? (
      <PersonAvatar
        className="mt-0.5 h-5 w-5 shrink-0"
        fallbackClassName="text-[9px]"
        initials={assignee.initials}
        headshotUrl={assignee.headshotUrl}
        title={`${assignee.firstName} ${assignee.lastName}`}
      />
    ) : null;
  }

  return (
    <div className="mt-0.5 flex shrink-0 items-center gap-1">
      {assignee && (
        <PersonAvatar
          className="h-5 w-5"
          fallbackClassName="text-[9px]"
          initials={assignee.initials}
          headshotUrl={assignee.headshotUrl}
          title={`${assignee.firstName} ${assignee.lastName}`}
        />
      )}
      <form action={assignAction as unknown as (fd: FormData) => void} className="inline">
        <select
          name="assigneeId"
          defaultValue={item.assigneeId ?? ''}
          onChange={(e) => {
            const form = e.currentTarget.closest('form');
            if (form) form.requestSubmit();
          }}
          aria-label="Assign owner"
          className="h-6 max-w-[7.5rem] rounded-md border border-line bg-surface-elev px-1 text-[11px] text-ink"
        >
          <option value="">Unassigned</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.initials} · {p.firstName} {p.lastName}
            </option>
          ))}
        </select>
      </form>
    </div>
  );
}

function DeleteListBtn({
  projectId,
  checklistId,
}: {
  projectId: string;
  checklistId: string;
}) {
  const bound = deleteChecklist.bind(null, projectId, checklistId);
  const [, action] = useFormState<ChecklistActionState, FormData>(bound, { status: 'idle' });
  return (
    <form action={action as unknown as (fd: FormData) => void}>
      <button
        type="submit"
        className="text-xs text-ink-4 hover:text-status-red"
        onClick={(e) => {
          if (!confirm('Delete this checklist and all its items?')) e.preventDefault();
        }}
      >
        Delete
      </button>
    </form>
  );
}

function AddItemForm({
  projectId,
  checklistId,
}: {
  projectId: string;
  checklistId: string;
}) {
  const bound = addChecklistItem.bind(null, projectId, checklistId);
  const [state, action] = useFormState<ChecklistActionState, FormData>(bound, {
    status: 'idle',
  });
  return (
    <form
      action={action}
      className="flex items-center gap-1"
      onSubmit={(e) => {
        const input = e.currentTarget.querySelector<HTMLInputElement>('input[name=label]');
        if (input && !input.value.trim()) e.preventDefault();
        else setTimeout(() => input && (input.value = ''), 0);
      }}
    >
      <Input
        name="label"
        placeholder="New item…"
        className="h-8 flex-1 text-sm"
      />
      <AddSubmit />
      {state.status === 'error' && (
        <span className="text-[10px] text-status-red">{state.message}</span>
      )}
    </form>
  );
}

function AddSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? '…' : 'Add'}
    </Button>
  );
}

function NewChecklistForm({ projectId }: { projectId: string }) {
  const bound = createChecklist.bind(null, projectId);
  const [state, action] = useFormState<ChecklistActionState, FormData>(bound, {
    status: 'idle',
  });
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        + New checklist
      </Button>
    );
  }

  return (
    <form
      action={action}
      onSubmit={(e) => {
        const input = e.currentTarget.querySelector<HTMLInputElement>('input[name=label]');
        if (input && !input.value.trim()) {
          e.preventDefault();
          return;
        }
        setTimeout(() => {
          if (input) input.value = '';
          setOpen(false);
        }, 0);
      }}
      className="flex items-center gap-2 rounded-md border border-line bg-card p-3"
    >
      <Input name="label" placeholder="Checklist name (e.g. Kickoff, Delivery gates)" required className="flex-1" />
      <CreateSubmit />
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {state.status === 'error' && (
        <span className="text-xs text-status-red">{state.message}</span>
      )}
    </form>
  );
}

function CreateSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Creating…' : 'Create'}
    </Button>
  );
}
