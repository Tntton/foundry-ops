import { notFound } from 'next/navigation';
import { Bell, Mail, Search, Settings, User as UserIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KPI } from '@/components/ui/kpi';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Icon } from '@/components/ui/icon';

export default function PlaygroundPage() {
  if (process.env['NODE_ENV'] === 'production') {
    notFound();
  }

  return (
    <main className="mx-auto max-w-6xl space-y-12 p-12">
      <header>
        <h1 className="text-2xl font-semibold text-ink">UI primitive playground</h1>
        <p className="mt-1 text-ink-3">
          Dev-only. Visual reference for the ported shadcn primitives.
        </p>
      </header>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" aria-label="settings">
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Default</Badge>
          <Badge variant="green">Approved</Badge>
          <Badge variant="amber">Pending</Badge>
          <Badge variant="red">Overdue</Badge>
          <Badge variant="blue">Info</Badge>
          <Badge variant="outline">Draft</Badge>
          <Badge variant="destructive">Failed</Badge>
          <Badge variant="secondary">Secondary</Badge>
        </div>
      </Section>

      <Section title="Inputs">
        <div className="max-w-md space-y-2">
          <Input placeholder="Search clients, projects, people…" />
          <Input type="email" placeholder="you@foundry.health" />
        </div>
      </Section>

      <Section title="Icons (lucide-react via Icon wrapper)">
        <div className="flex items-center gap-3 text-ink-2">
          <Icon icon={Bell} />
          <Icon icon={Mail} />
          <Icon icon={Search} />
          <Icon icon={Settings} />
          <Icon icon={UserIcon} className="h-6 w-6 text-brand" />
        </div>
      </Section>

      <Section title="Avatars">
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>TT</AvatarFallback>
          </Avatar>
          <Avatar className="h-7 w-7">
            <AvatarFallback className="text-[10px]">JN</AvatarFallback>
          </Avatar>
          <Avatar className="h-12 w-12">
            <AvatarFallback className="text-base">MB</AvatarFallback>
          </Avatar>
        </div>
      </Section>

      <Section title="KPIs">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <KPI label="Cash on hand" value="$482k" trend="up" sub="+$24k vs last month" />
          <KPI label="AR overdue" value="$73k" trend="down" sub="2 invoices >30d" />
          <KPI label="Utilisation" value="87%" trend="flat" sub="target 85%" />
          <KPI label="Pipeline" value="$1.2M" trend="up" sub="4 deals in proposal" />
        </div>
      </Section>

      <Section title="Cards">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>Last 24h across the firm</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-ink-2">
              No activity yet. Seed will populate this once TASK-020 lands.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Approvals queue</CardTitle>
              <CardDescription>Items awaiting decision</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-ink-2">
              <span className="text-2xl font-semibold text-ink">0</span> pending
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title="Table">
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Contract value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-mono">IFM001</TableCell>
                <TableCell>Market landscape</TableCell>
                <TableCell>
                  <Badge variant="green">Delivery</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">$180,000</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-mono">ACM002</TableCell>
                <TableCell>Pricing diligence</TableCell>
                <TableCell>
                  <Badge variant="amber">Kickoff</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">$95,000</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="brief" className="max-w-2xl">
          <TabsList>
            <TabsTrigger value="brief">Brief</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
            <TabsTrigger value="milestones">Milestones</TabsTrigger>
            <TabsTrigger value="pnl">P&amp;L</TabsTrigger>
          </TabsList>
          <TabsContent value="brief">
            Project brief content — description, contract, dates, SharePoint link.
          </TabsContent>
          <TabsContent value="team">Team allocation rows.</TabsContent>
          <TabsContent value="milestones">Milestone CRUD grid.</TabsContent>
          <TabsContent value="pnl">Revenue vs cost vs margin.</TabsContent>
        </Tabs>
      </Section>

      <Section title="Modal (center dialog)">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Open modal</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Approve invoice?</DialogTitle>
              <DialogDescription>
                IFM001 · $12,450 incl. GST · Imperial Medical. Once approved, it will be
                pushed to Xero as a draft.
              </DialogDescription>
            </DialogHeader>
            <div className="text-sm text-ink-2">Approval note (optional):</div>
            <Input placeholder="Add a note for the audit trail…" />
            <DialogFooter>
              <Button variant="ghost">Cancel</Button>
              <Button>Approve</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      <Section title="Drawer (right-side, ~640px)">
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="outline">Open drawer</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Tony Trung · Managing Partner</DrawerTitle>
              <DrawerDescription>tt@foundry.health · Sydney, AU</DrawerDescription>
            </DrawerHeader>
            <DrawerBody>
              <Tabs defaultValue="profile">
                <TabsList>
                  <TabsTrigger value="profile">Profile</TabsTrigger>
                  <TabsTrigger value="employment">Employment</TabsTrigger>
                  <TabsTrigger value="pay">Pay</TabsTrigger>
                </TabsList>
                <TabsContent value="profile">
                  <p className="text-sm text-ink-2">Profile detail goes here (TASK-022).</p>
                </TabsContent>
                <TabsContent value="employment">
                  <p className="text-sm text-ink-2">Employment tab.</p>
                </TabsContent>
                <TabsContent value="pay">
                  <p className="text-sm text-ink-2">Pay tab — Admin+ only.</p>
                </TabsContent>
              </Tabs>
            </DrawerBody>
            <DrawerFooter>
              <Button variant="ghost">Cancel</Button>
              <Button>Save</Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h2>
      {children}
    </section>
  );
}
