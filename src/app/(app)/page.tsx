import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KPI } from '@/components/ui/kpi';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Dashboard</h1>
        <p className="text-sm text-ink-3">
          Phase 0 placeholder. Real KPIs + sections land with TASK-070 (deferred from MVP).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPI label="Active projects" value="—" sub="Seed pending (TASK-020)" trend="flat" />
        <KPI label="Cash on hand" value="—" sub="Xero sync — TASK-050" trend="flat" />
        <KPI label="AR overdue" value="—" sub="Xero sync — TASK-050" trend="flat" />
        <KPI label="Utilisation" value="—" sub="Timesheets — TASK-040" trend="flat" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Approvals queue</CardTitle>
            <CardDescription>Decisions awaiting you</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-ink-3">
            Nothing to approve. Approvals UI lands in TASK-048.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Last 24h across the firm</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-ink-3">
            Activity feed populates once the first mutations land (audit writer is ready,
            TASK-007).
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
