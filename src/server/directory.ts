import type { Band, Employment, Region, Role } from '@prisma/client';
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
  fte: number;
  region: Region;
  employment: Employment;
  active: boolean;
  roles: Role[];
};

export type PersonListFilter = {
  search?: string;
  band?: Band;
  region?: Region;
  employment?: Employment;
};

export async function listPeople(filter: PersonListFilter = {}): Promise<PersonListRow[]> {
  const { search, band, region, employment } = filter;

  const where: Record<string, unknown> = {};
  if (band) where['band'] = band;
  if (region) where['region'] = region;
  if (employment) where['employment'] = employment;
  if (search && search.trim()) {
    const q = search.trim();
    where['OR'] = [
      { initials: { contains: q, mode: 'insensitive' } },
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
    ];
  }

  const rows = await prisma.person.findMany({
    where,
    orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
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
      roles: true,
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
    fte: Number(r.fte),
    region: r.region,
    employment: r.employment,
    active: r.endDate === null,
    roles: r.roles,
  }));
}

export type PersonDetail = PersonListRow & {
  phone: string | null;
  whatsappNumber: string | null;
  entraUserId: string | null;
  xeroContactId: string | null;
  startDate: Date;
  endDate: Date | null;
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
      employment: true,
      endDate: true,
      roles: true,
      entraUserId: true,
      xeroContactId: true,
      startDate: true,
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
    band: p.band,
    level: p.level,
    rate: p.rate,
    rateUnit: p.rateUnit,
    fte: Number(p.fte),
    region: p.region,
    employment: p.employment,
    entraUserId: p.entraUserId,
    xeroContactId: p.xeroContactId,
    startDate: p.startDate,
    endDate: p.endDate,
    active: p.endDate === null,
    roles: p.roles,
  };
}
