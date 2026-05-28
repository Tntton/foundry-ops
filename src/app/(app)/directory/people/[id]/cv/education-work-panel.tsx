/**
 * Read-only display of the person's education + work history. Edits
 * happen through `CvUploadPanel` (replace-all on commit). A future
 * iteration could allow inline edits per row.
 */

export type EducationRow = {
  id: string;
  institution: string;
  degree: string | null;
  field: string | null;
  startYear: string | null;
  endYear: string | null;
  notes: string | null;
};

export type WorkRow = {
  id: string;
  company: string;
  title: string | null;
  location: string | null;
  startYear: string | null;
  endYear: string | null;
  current: boolean;
  description: string | null;
};

function rangeLabel(start: string | null, end: string | null, current: boolean) {
  if (current) return start ? `${start} – present` : 'present';
  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  if (end) return end;
  return null;
}

export function EducationWorkPanel({
  education,
  work,
}: {
  education: EducationRow[];
  work: WorkRow[];
}) {
  if (education.length === 0 && work.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-line bg-card p-4 text-center text-xs text-ink-3">
        No education or work history on file. Upload a CV above to
        populate.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div className="rounded-lg border border-line bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-ink">Education</h3>
        {education.length === 0 ? (
          <p className="text-xs text-ink-3">No education on file.</p>
        ) : (
          <ul className="space-y-3">
            {education.map((e) => {
              const r = rangeLabel(e.startYear, e.endYear, false);
              return (
                <li key={e.id} className="border-l-2 border-line pl-3">
                  <div className="text-sm font-medium text-ink">
                    {e.institution}
                  </div>
                  {(e.degree || e.field) && (
                    <div className="text-xs text-ink-2">
                      {[e.degree, e.field].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {r && (
                    <div className="text-[11px] tabular-nums text-ink-3">
                      {r}
                    </div>
                  )}
                  {e.notes && (
                    <div className="mt-1 whitespace-pre-wrap text-[11px] text-ink-3">
                      {e.notes}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-line bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-ink">Work history</h3>
        {work.length === 0 ? (
          <p className="text-xs text-ink-3">No work history on file.</p>
        ) : (
          <ul className="space-y-3">
            {work.map((w) => {
              const r = rangeLabel(w.startYear, w.endYear, w.current);
              return (
                <li key={w.id} className="border-l-2 border-line pl-3">
                  <div className="text-sm font-medium text-ink">
                    {w.company}
                  </div>
                  {(w.title || w.location) && (
                    <div className="text-xs text-ink-2">
                      {[w.title, w.location].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {r && (
                    <div className="text-[11px] tabular-nums text-ink-3">
                      {r}
                      {w.current && (
                        <span className="ml-1 inline-flex items-center rounded-full bg-status-green-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-status-green">
                          current
                        </span>
                      )}
                    </div>
                  )}
                  {w.description && (
                    <div className="mt-1 whitespace-pre-wrap text-[11px] text-ink-3">
                      {w.description}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
