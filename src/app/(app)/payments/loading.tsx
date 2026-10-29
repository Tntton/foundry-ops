export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="h-8 w-40 animate-pulse rounded bg-surface-hover" />
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-7 w-28 animate-pulse rounded-full bg-surface-hover" />
        ))}
      </div>
      <div className="h-16 animate-pulse rounded-lg bg-surface-hover" />
      <div className="h-96 animate-pulse rounded-lg bg-surface-hover" />
    </div>
  );
}
