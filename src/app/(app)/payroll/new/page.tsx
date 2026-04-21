import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { listUnbatchedApprovedBills } from '@/server/payruns';
import { NewPayRunForm } from './form';

export default async function NewPayRunPage() {
  const session = await getSession();
  if (!hasCapability(session, 'payrun.create')) notFound();

  const bills = await listUnbatchedApprovedBills();
  const options = bills.map((b) => ({
    id: b.id,
    supplierName: b.supplierName,
    supplierInvoiceNumber: b.supplierInvoiceNumber,
    amountTotalCents: b.amountTotalCents,
    dueDate: b.dueDate,
    category: b.category,
    hasBankDetails: Boolean(b.supplierPersonId && b.supplierBsb && b.supplierAcc),
    supplierPersonId: b.supplierPersonId,
  }));

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/payroll" className="text-ink-3 hover:text-ink">
          ← Back to Pay runs
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">New pay run</h1>
        <p className="text-sm text-ink-3">
          Batches approved bills into a single payable. Each selected bill becomes a line in
          the resulting ABA file. Bills without bank details on the supplier Person are
          excluded — add details to the person first.
        </p>
      </header>
      <NewPayRunForm bills={options} />
    </div>
  );
}
