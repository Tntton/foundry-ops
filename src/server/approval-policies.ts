import type { Role, ApprovalSubjectType } from '@prisma/client';
import { prisma } from '@/server/db';

export type PolicyRow = {
  id: string;
  subjectType: ApprovalSubjectType;
  thresholdCents: number | null;
  comparator: 'gt' | 'gte' | 'lte' | 'lt' | 'any';
  requiredRole: Role;
  channel: string;
  requireMfa: boolean;
  active: boolean;
  effectiveFrom: Date;
};

/**
 * Built-in defaults. Used when no active DB policy exists for a subject type.
 * These mirror the hard-coded thresholds in src/server/approvals.ts so the
 * behaviour doesn't flip just because the admin hasn't set anything yet.
 */
export const DEFAULT_POLICIES: Array<{
  subjectType: ApprovalSubjectType;
  thresholdCents: number | null;
  comparator: 'gt' | 'gte' | 'lte' | 'lt' | 'any';
  requiredRole: Role;
  note: string;
}> = [
  {
    subjectType: 'expense',
    thresholdCents: 200_000,
    comparator: 'gt',
    requiredRole: 'super_admin',
    note: '> $2000 → Super Admin',
  },
  {
    subjectType: 'expense',
    thresholdCents: 200_000,
    comparator: 'lte',
    requiredRole: 'admin',
    note: '≤ $2000 → Admin',
  },
  {
    subjectType: 'invoice',
    thresholdCents: 2_000_000,
    comparator: 'gt',
    requiredRole: 'super_admin',
    note: '> $20000 → Super Admin',
  },
  {
    subjectType: 'invoice',
    thresholdCents: 2_000_000,
    comparator: 'lte',
    requiredRole: 'partner',
    note: '≤ $20000 → Owning Partner',
  },
  {
    subjectType: 'bill',
    thresholdCents: null,
    comparator: 'any',
    requiredRole: 'super_admin',
    note: 'Any → Super Admin',
  },
  {
    subjectType: 'pay_run',
    thresholdCents: null,
    comparator: 'any',
    requiredRole: 'super_admin',
    note: 'Any → Super Admin',
  },
];

export async function listActivePolicies(subjectType?: ApprovalSubjectType): Promise<PolicyRow[]> {
  const where: Record<string, unknown> = { active: true };
  if (subjectType) where['subjectType'] = subjectType;
  const rows = await prisma.approvalPolicy.findMany({
    where,
    orderBy: [{ subjectType: 'asc' }, { thresholdCents: 'asc' }],
  });
  return rows.map(toPolicyRow);
}

export async function listAllPolicies(): Promise<PolicyRow[]> {
  const rows = await prisma.approvalPolicy.findMany({
    orderBy: [{ active: 'desc' }, { subjectType: 'asc' }, { thresholdCents: 'asc' }],
  });
  return rows.map(toPolicyRow);
}

function toPolicyRow(r: {
  id: string;
  subjectType: ApprovalSubjectType;
  thresholdCents: number | null;
  comparator: string;
  requiredRole: Role;
  channel: string;
  requireMfa: boolean;
  active: boolean;
  effectiveFrom: Date;
}): PolicyRow {
  return {
    id: r.id,
    subjectType: r.subjectType,
    thresholdCents: r.thresholdCents,
    comparator: r.comparator as PolicyRow['comparator'],
    requiredRole: r.requiredRole,
    channel: r.channel,
    requireMfa: r.requireMfa,
    active: r.active,
    effectiveFrom: r.effectiveFrom,
  };
}

/**
 * Resolve the required role for a given subject + amount. Prefers DB-backed
 * ApprovalPolicy rows; falls back to DEFAULT_POLICIES when none match.
 */
export async function resolveRequiredRole(
  subjectType: ApprovalSubjectType,
  amountCents: number | null,
): Promise<Role> {
  const db = await listActivePolicies(subjectType);
  const ordered = [...db, ...DEFAULT_POLICIES.filter((d) => d.subjectType === subjectType)];

  for (const p of ordered) {
    if (!matches(p.comparator, p.thresholdCents, amountCents)) continue;
    return p.requiredRole;
  }
  return 'super_admin';
}

function matches(
  comparator: PolicyRow['comparator'],
  threshold: number | null,
  amount: number | null,
): boolean {
  if (comparator === 'any') return true;
  if (threshold === null || amount === null) return false;
  switch (comparator) {
    case 'gt':
      return amount > threshold;
    case 'gte':
      return amount >= threshold;
    case 'lte':
      return amount <= threshold;
    case 'lt':
      return amount < threshold;
  }
}
