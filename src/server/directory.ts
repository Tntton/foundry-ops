import type { Band, Employment, PoolStatus, Role } from '@prisma/client';
import { prisma } from '@/server/db';

export type PersonListRow = {
  id: string;
  initials: string;
  firstName: string;
  lastName: string;
  email: string;
  band: Band;
  level: string;
  rate: number; // cents
  rateUnit: 'hour' | 'day';
  fte: number | null;
  region: string; // ISO 3166-1 alpha-2
  employment: Employment;
  active: boolean;
  /** Soft-pause — set when the person has marked themselves (or been
   *  marked) inactive. They still appear in directory + a separate
   *  "Inactive" pool bucket on resource planning, but are excluded from
   *  FTE / utilisation roll-ups and all input surfaces are disabled. */
  inactive: boolean;
  /** "Staff" = the FT/PT employee subset whose hours we track for
   *  utilisation. Drives filters on bandwidth heatmap, resource
   *  planning, and /utilisation. Partners / fellows / contractors get
   *  isStaff=false even if they have an FTE value. */
  isStaff: boolean;
  /** Super-admin manual status override (or null when computed). Drives
   *  the colour pip on directory + profile. */
  poolStatusOverride: PoolStatus | null;
  roles: Role[];
  /** Optional avatar — drives PersonAvatar across the app. Falls back
   *  to initials when null/missing. */
  headshotUrl: string | null;
  /** WhatsApp number in E.164 (when set) — surfaced in staff
   *  directory so anyone can reach a colleague directly without
   *  clicking through to a profile they may not have access to. */
  whatsappNumber: string | null;
  /** Last successful sign-in timestamp (Entra OR magic-link), stamped
   *  by the NextAuth signIn event. Null = "Not yet logged in" — useful
   *  for spotting accounts that were provisioned but never opened. */
  lastLoginAt: Date | null;
};

export type PersonListFilter = {
  search?: string;
  band?: Band;
  region?: string;
  employment?: Employment;
  active?: 'active' | 'archived' | 'all';
  /** Optional sort override. Falls back to the default
   *  band-then-lastName ordering used by the directory listing. */
  sort?: PersonSortKey;
  dir?: 'asc' | 'desc';
};

export type PersonSortKey =
  | 'lastName'
  | 'firstName'
  | 'band'
  | 'level'
  | 'region'
  | 'employment'
  | 'fte'
  | 'rate'
  | 'startDate'
  | 'lastLoginAt';

const SORT_FIELD: Record<PersonSortKey, string> = {
  lastName: 'lastName',
  firstName: 'firstName',
  band: 'band',
  level: 'level',
  region: 'region',
  employment: 'employment',
  fte: 'fte',
  rate: 'rate',
  startDate: 'startDate',
  lastLoginAt: 'lastLoginAt',
};

export async function listPeople(filter: PersonListFilter = {}): Promise<PersonListRow[]> {
  const { search, band, region, employment, active = 'active', sort, dir = 'asc' } = filter;

  const where: Record<string, unknown> = {};
  if (band) where['band'] = band;
  if (region) where['region'] = region;
  if (employment) where['employment'] = employment;
  if (active === 'active') where['endDate'] = null;
  else if (active === 'archived') where['endDate'] = { not: null };
  if (search && search.trim()) {
    const q = search.trim();
    where['OR'] = [
      { initials: { contains: q, mode: 'insensitive' } },
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
    ];
  }

  const orderBy: Array<Record<string, 'asc' | 'desc'>> = sort
    ? [{ [SORT_FIELD[sort]]: dir }]
    : [{ band: 'asc' }, { lastName: 'asc' }];

  const rows = await prisma.person.findMany({
    where,
    orderBy,
    select: {
      id: true,
      initials: true,
      firstName: true,
      lastName: true,
      email: true,
      band: true,
      level: true,
      rate: true,
      rateUnit: true,
      fte: true,
      region: true,
      employment: true,
      endDate: true,
      inactiveAt: true,
      isStaff: true,
      poolStatusOverride: true,
      roles: true,
      headshotUrl: true,
      whatsappNumber: true,
      lastLoginAt: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    initials: r.initials,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    band: r.band,
    level: r.level,
    rate: r.rate,
    rateUnit: r.rateUnit,
    fte: r.fte !== null ? Number(r.fte) : null,
    region: r.region,
    employment: r.employment,
    active: r.endDate === null,
    inactive: r.inactiveAt !== null,
    isStaff: r.isStaff,
    poolStatusOverride: r.poolStatusOverride,
    roles: r.roles,
    headshotUrl: r.headshotUrl,
    whatsappNumber: r.whatsappNumber,
    lastLoginAt: r.lastLoginAt,
  }));
}

export type PersonDetail = PersonListRow & {
  phone: string | null;
  whatsappNumber: string | null;
  linkedinUrl: string | null;
  website: string | null;
  domain: string | null;
  logoUrl: string | null;
  mailingAddress: string | null;
  emergencyContactName: string | null;
  emergencyContactRelationship: string | null;
  emergencyContactPhone: string | null;
  emergencyContactEmail: string | null;
  entraUserId: string | null;
  xeroContactId: string | null;
  startDate: Date;
  endDate: Date | null;
  inactiveAt: Date | null;
  bankBsb: string | null; // encrypted blob — never render; test for presence only
  bankAcc: string | null;
  headshotUrl: string | null;
  // Rate flexibility (see prisma/schema.prisma Person model).
  rateOverride: boolean;
  expertRate: number | null;
  expertRateUnit: 'hour' | 'day' | null;
  agencyName: string | null;
  agencyMarkupPct: number | null;
};

export async function getPerson(id: string): Promise<PersonDetail | null> {
  const p = await prisma.person.findUnique({
    where: { id },
    select: {
      id: true,
      initials: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      whatsappNumber: true,
      band: true,
      level: true,
      rate: true,
      rateUnit: true,
      fte: true,
      region: true,
      mailingAddress: true,
      linkedinUrl: true,
      website: true,
      domain: true,
      logoUrl: true,
      emergencyContactName: true,
      emergencyContactRelationship: true,
      emergencyContactPhone: true,
      emergencyContactEmail: true,
      employment: true,
      endDate: true,
      inactiveAt: true,
      isStaff: true,
      poolStatusOverride: true,
      roles: true,
      entraUserId: true,
      xeroContactId: true,
      startDate: true,
      bankBsb: true,
      bankAcc: true,
      headshotUrl: true,
      lastLoginAt: true,
      rateOverride: true,
      expertRate: true,
      expertRateUnit: true,
      agencyName: true,
      agencyMarkupPct: true,
    },
  });
  if (!p) return null;
  return {
    id: p.id,
    initials: p.initials,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    phone: p.phone,
    whatsappNumber: p.whatsappNumber,
    linkedinUrl: p.linkedinUrl,
    website: p.website,
    domain: p.domain,
    logoUrl: p.logoUrl,
    mailingAddress: p.mailingAddress,
    emergencyContactName: p.emergencyContactName,
    emergencyContactRelationship: p.emergencyContactRelationship,
    emergencyContactPhone: p.emergencyContactPhone,
    emergencyContactEmail: p.emergencyContactEmail,
    band: p.band,
    level: p.level,
    rate: p.rate,
    rateUnit: p.rateUnit,
    fte: p.fte !== null ? Number(p.fte) : null,
    region: p.region,
    employment: p.employment,
    entraUserId: p.entraUserId,
    xeroContactId: p.xeroContactId,
    startDate: p.startDate,
    endDate: p.endDate,
    inactiveAt: p.inactiveAt,
    active: p.endDate === null,
    inactive: p.inactiveAt !== null,
    isStaff: p.isStaff,
    poolStatusOverride: p.poolStatusOverride,
    roles: p.roles,
    bankBsb: p.bankBsb,
    bankAcc: p.bankAcc,
    headshotUrl: p.headshotUrl,
    lastLoginAt: p.lastLoginAt,
    rateOverride: p.rateOverride,
    expertRate: p.expertRate,
    expertRateUnit: p.expertRateUnit,
    agencyName: p.agencyName,
    agencyMarkupPct: p.agencyMarkupPct !== null ? Number(p.agencyMarkupPct) : null,
  };
}
