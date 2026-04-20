import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function AppNotFound() {
  return (
    <div className="mx-auto max-w-lg space-y-4 p-12 text-center">
      <h1 className="text-xl font-semibold text-ink">Not found.</h1>
      <p className="text-sm text-ink-2">
        Either this thing doesn&apos;t exist or you don&apos;t have access to it.
      </p>
      <Button asChild variant="outline">
        <Link href="/">Back to dashboard</Link>
      </Button>
    </div>
  );
}
