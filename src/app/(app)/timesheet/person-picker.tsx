'use client';

type PersonOption = {
  id: string;
  initials: string;
  firstName: string;
  lastName: string;
};

export function TimesheetPersonPicker({
  view,
  selfId,
  selfFirstName,
  selfLastName,
  selectedPersonId,
  options,
}: {
  view: 'week' | 'month';
  selfId: string;
  selfFirstName: string;
  selfLastName: string;
  selectedPersonId: string;
  options: PersonOption[];
}) {
  return (
    <form action="/timesheet" method="get">
      <input type="hidden" name="view" value={view} />
      <select
        name="personId"
        defaultValue={selectedPersonId}
        onChange={(e) => {
          (e.target.form as HTMLFormElement | null)?.submit();
        }}
        className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
      >
        <option value={selfId}>
          Me — {selfFirstName} {selfLastName}
        </option>
        {options
          .filter((p) => p.id !== selfId)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.initials} · {p.firstName} {p.lastName}
            </option>
          ))}
      </select>
    </form>
  );
}
