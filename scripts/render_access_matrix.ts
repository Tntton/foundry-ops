import { CAPABILITY_ROLES, type Capability } from '@/server/capabilities';
import { NAV_GROUPS } from '@/components/shell/nav-config';
import type { Role } from '@prisma/client';

const ROLES: readonly Role[] = ['super_admin', 'admin', 'partner', 'associate_partner', 'manager', 'staff'];
const LABEL: Record<Role, string> = {
  super_admin: 'SuperA',
  admin: 'Admin',
  partner: 'Partner',
  associate_partner: 'AssocP',
  manager: 'Mgr',
  staff: 'Staff',
};

function row(name: string, roles: readonly Role[]): string {
  const cells = ROLES.map(r => roles.includes(r) ? ' ✓' : ' ·').map(c => c.padEnd(8)).join('');
  return `  ${name.padEnd(40).slice(0, 40)} ${cells}`;
}

const header = `  ${' '.repeat(40)} ${ROLES.map(r => LABEL[r].padEnd(8)).join('')}`;

console.log('\n=== NAV VISIBILITY MATRIX ===');
console.log(header);
console.log('  ' + '-'.repeat(80));
for (const g of NAV_GROUPS) {
  console.log(`  [${g.label}]`);
  for (const i of g.items) console.log(row(`  ${i.label}`, i.roles));
}

console.log('\n\n=== CAPABILITY MATRIX ===');
console.log(header);
console.log('  ' + '-'.repeat(80));
const groups: Record<string, Capability[]> = {};
for (const cap of Object.keys(CAPABILITY_ROLES) as Capability[]) {
  const head = cap.split('.')[0];
  if (!head) continue;
  if (!groups[head]) groups[head] = [];
  groups[head]!.push(cap);
}
const order = ['invoice', 'expense', 'bill', 'payrun', 'project', 'person', 'client', 'deal', 'ratecard', 'partner', 'integration', 'agent', 'auditlog', 'approval', 'timesheet'];
for (const head of order) {
  if (!groups[head]) continue;
  console.log(`  [${head}.*]`);
  for (const cap of groups[head]!) console.log(row(`  ${cap}`, CAPABILITY_ROLES[cap]));
}
