export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="h-8 w-56 animate-pulse rounded bg-surface-hover" />
      <div className="h-16 animate-pulse rounded-lg bg-surface-hover" />
      <div className="grid grid-cols-3 gap-3">
        <div className="h-20 animate-pulse rounded-lg bg-surface-hover" />
        <div className="h-20 animate-pulse rounded-lg bg-surface-hover" />
        <div className="h-20 animate-pulse rounded-lg bg-surface-hover" />
      </div>
      <div className="h-96 animate-pulse rounded-lg bg-surface-hover" />
    </div>
  );
}
