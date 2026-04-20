'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { saveProjectTeam, type TeamEditState } from './actions';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type PersonOpt = { id: string; initials: string; firstName: string; lastName: string; band: string };
type TeamMember = {
  personId: string;
  roleOnProject: string;
  allocationPct: number;
};

export function TeamEditForm({
  projectId,
  initialMembers,
  allPeople,
}: {
  projectId: string;
  initialMembers: (TeamMember & PersonOpt)[];
  allPeople: PersonOpt[];
}) {
  const [state, action] = useFormState<TeamEditState, FormData>(saveProjectTeam, {
    status: 'idle',
  });
  const [members, setMembers] = useState(initialMembers);
  const [picker, setPicker] = useState('');

  const used = new Set(members.map((m) => m.personId));
  const available = allPeople.filter((p) => !used.has(p.id));
  const totalAlloc = members.reduce((s, m) => s + (m.allocationPct || 0), 0);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="projectId" value={projectId} />

      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </div>
      )}

      <div className="rounded-lg border border-line bg-card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-subtle text-xs text-ink-3">
            <tr>
              <th className="px-3 py-2 text-left">Person</th>
              <th className="px-3 py-2 text-left">Role on project</th>
              <th className="px-3 py-2 text-right">Allocation %</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-sm text-ink-3">
                  No team members yet — add one below.
                </td>
              </tr>
            ) : (
              members.map((m) => (
                <tr key={m.personId} className="border-t border-line">
                  <td className="px-3 py-2">
                    <input type="hidden" name="personId" value={m.personId} />
                    <div className="flex items-center gap-2">
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="text-[10px]">{m.initials}</AvatarFallback>
                      </Avatar>
                      <span className="text-ink">
                        {m.firstName} {m.lastName}
                      </span>
                      <span className="text-xs text-ink-3">({m.band})</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      name="roleOnProject"
                      value={m.roleOnProject}
                      onChange={(e) =>
                        setMembers((prev) =>
                          prev.map((x) =>
                            x.personId === m.personId
                              ? { ...x, roleOnProject: e.target.value }
                              : x,
                          ),
                        )
                      }
                      placeholder="Lead / Analyst / SME / …"
                      className="h-8 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      name="allocationPct"
                      type="number"
                      min="0"
                      max="100"
                      step="5"
                      value={m.allocationPct}
                      onChange={(e) =>
                        setMembers((prev) =>
                          prev.map((x) =>
                            x.personId === m.personId
                              ? { ...x, allocationPct: Number(e.target.value) || 0 }
                              : x,
                          ),
                        )
                      }
                      className="h-8 w-24 text-right"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setMembers((prev) => prev.filter((x) => x.personId !== m.personId))
                      }
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot className="bg-surface-subtle">
            <tr>
              <td colSpan={2} className="px-3 py-2 text-right text-xs uppercase text-ink-3">
                Total allocation
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{totalAlloc}%</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={picker}
          onChange={(e) => setPicker(e.target.value)}
          className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
        >
          <option value="">— Add team member —</option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>
              {p.initials} · {p.firstName} {p.lastName} ({p.band})
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!picker}
          onClick={() => {
            const p = allPeople.find((x) => x.id === picker);
            if (!p) return;
            setMembers((prev) => [
              ...prev,
              { personId: p.id, roleOnProject: '', allocationPct: 0, ...p },
            ]);
            setPicker('');
          }}
        >
          Add
        </Button>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" asChild variant="ghost">
          <a href={`/projects/back`}>Cancel</a>
        </Button>
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save team'}
    </Button>
  );
}
