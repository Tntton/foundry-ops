export default function AppLoading() {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-ink-3">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand" />
        <span>Loading…</span>
      </div>
    </div>
  );
}
