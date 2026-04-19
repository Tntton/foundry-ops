import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl p-12">
      <header className="mb-8 flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-ink">Foundry Ops</h1>
        <Badge variant="green">Phase 0</Badge>
      </header>

      <p className="mb-8 text-ink-2">
        Scaffold + DB + tokens in place. Next up: TASK-004 (auth).
      </p>

      <section className="space-y-4 rounded-lg border border-line bg-card p-6 shadow-sm">
        <h2 className="text-sm font-medium text-ink-2">Primitive preview</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Default</Badge>
          <Badge variant="green">Approved</Badge>
          <Badge variant="amber">Pending</Badge>
          <Badge variant="red">Overdue</Badge>
          <Badge variant="blue">Info</Badge>
          <Badge variant="outline">Draft</Badge>
        </div>
        <Input placeholder="Search clients, projects, people…" />
      </section>
    </main>
  );
}
