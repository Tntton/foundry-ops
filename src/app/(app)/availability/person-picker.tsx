'use client';

type PersonOption = {
  id: string;
  initials: string;
  firstName: string;
  lastName: string;
};

/**
 * Mirror of the timesheet's person-picker but routes back to
 * /availability so on-behalf admin/partner edits land on the right
 * surface. Kept as a separate component (rather than parameterising
 * the timesheet one) so neither flow needs to special-case the other.
 */
export function AvailabilityPersonPicker({
  selfId,
  selfFirstName,
  selfLastName,
  selectedPersonId,
  options,
}: {
  selfId: string;
  selfFirstName: string;
  selfLastName: string;
  selectedPersonId: string;
  options: PersonOption[];
}) {
  return (
    <form action="/availability" method="get">
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
