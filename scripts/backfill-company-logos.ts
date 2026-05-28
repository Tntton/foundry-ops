/**
 * Backfill `website` + `domain` + `logoUrl` for every existing company-
 * shaped record:
 *
 *   - Client (uses billingEmail / contactEmail / existing `domain` /
 *     legal-name slug as the inference chain)
 *   - Person where employment === 'contractor' (uses email)
 *   - Bill.supplierName → Supplier row (creates one if none exists,
 *     using contact-email-style heuristics where we can find them; new
 *     supplier rows have null website if we can't infer one — operator
 *     can fill it in via the supplier directory edit form)
 *
 * Idempotent: re-running won't overwrite a manually-set website. We
 * only touch rows where `website` is currently null. The logoUrl /
 * domain are recomputed each run to stay in sync with the website.
 *
 * Run:  pnpm tsx scripts/backfill-company-logos.ts
 */
import { PrismaClient } from '@prisma/client';
import {
  resolveCompanyAssets,
  domainFromEmail,
} from '../src/server/integrations/company-logo';

const prisma = new PrismaClient();

// Mirrors the COMPANY_STOPWORDS set from src/components/client-logo.tsx —
// last-resort name-to-domain inference for clients without any email
// or stored domain. Keeps the inference compatible with what's
// rendered on the screen today.
const NAME_STOPWORDS = new Set([
  'pty', 'ltd', 'limited', 'llc', 'inc', 'incorporated', 'corp', 'co',
  'company', 'capital', 'partners', 'ventures', 'group', 'foundation',
  'holdings', 'health', 'the', 'and', '&',
]);

function inferDomainFromName(name: string): string | null {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !NAME_STOPWORDS.has(t));
  if (tokens.length === 0) return null;
  const slug = tokens.join('');
  if (slug.length < 2) return null;
  return `${slug}.com`;
}

async function backfillClients(): Promise<number> {
  const clients = await prisma.client.findMany({
    select: {
      id: true,
      legalName: true,
      website: true,
      domain: true,
      billingEmail: true,
      contactEmail: true,
    },
  });
  let updated = 0;
  for (const c of clients) {
    // Don't trample a manually set website.
    if (c.website) continue;
    // Inference chain: existing domain → billingEmail → contactEmail →
    // legal-name slug.
    let inferredHost: string | null = null;
    if (c.domain && c.domain.includes('.')) inferredHost = c.domain;
    if (!inferredHost) inferredHost = domainFromEmail(c.billingEmail);
    if (!inferredHost) inferredHost = domainFromEmail(c.contactEmail);
    if (!inferredHost) inferredHost = inferDomainFromName(c.legalName);
    if (!inferredHost) {
      console.log(`skip client : ${c.legalName} — no signal`);
      continue;
    }
    const assets = resolveCompanyAssets({
      website: `https://${inferredHost}`,
    });
    await prisma.client.update({
      where: { id: c.id },
      data: {
        website: assets.website,
        domain: assets.domain,
        logoUrl: assets.logoUrl,
      },
    });
    updated += 1;
    console.log(`update client: ${c.legalName.padEnd(40)} → ${assets.domain}`);
  }
  return updated;
}

async function backfillContractors(): Promise<number> {
  const contractors = await prisma.person.findMany({
    where: { employment: 'contractor' },
    select: { id: true, firstName: true, lastName: true, email: true, website: true },
  });
  let updated = 0;
  for (const p of contractors) {
    if (p.website) continue; // operator already set it
    const host = domainFromEmail(p.email);
    if (!host) {
      console.log(
        `skip contractor: ${p.firstName} ${p.lastName} — free-mail or unparseable (${p.email})`,
      );
      continue;
    }
    const assets = resolveCompanyAssets({ website: `https://${host}` });
    await prisma.person.update({
      where: { id: p.id },
      data: {
        website: assets.website,
        domain: assets.domain,
        logoUrl: assets.logoUrl,
      },
    });
    updated += 1;
    console.log(`update contr.: ${p.firstName} ${p.lastName} → ${assets.domain}`);
  }
  return updated;
}

async function backfillSuppliers(): Promise<{ created: number; updated: number }> {
  // Walk every distinct supplierName from Bills and ensure a Supplier
  // row exists. We have very little signal for inferring website on
  // suppliers (no contact email on the Bill row), so most rows land
  // with null website and an empty logo — operator fills them in via
  // the supplier directory edit form.
  const billNames = await prisma.bill.findMany({
    where: { supplierName: { not: null }, supplierPersonId: null },
    select: { supplierName: true },
    distinct: ['supplierName'],
  });
  let created = 0;
  let updated = 0;
  for (const { supplierName } of billNames) {
    if (!supplierName) continue;
    const existing = await prisma.supplier.findUnique({
      where: { name: supplierName },
      select: { id: true, website: true },
    });
    if (existing) {
      // Re-run pulls latest logo only when we have a website to derive
      // from — leaves a manually-set logoUrl alone otherwise.
      if (existing.website) {
        const assets = resolveCompanyAssets({ website: existing.website });
        await prisma.supplier.update({
          where: { id: existing.id },
          data: {
            domain: assets.domain,
            logoUrl: assets.logoUrl,
          },
        });
        updated += 1;
        console.log(`refresh supp.: ${supplierName.padEnd(40)} → ${assets.domain}`);
      }
      continue;
    }
    // Best-effort website inference from the supplier name itself.
    const host = inferDomainFromName(supplierName);
    const assets = host ? resolveCompanyAssets({ website: `https://${host}` }) : null;
    await prisma.supplier.create({
      data: {
        name: supplierName,
        website: assets?.website ?? null,
        domain: assets?.domain ?? null,
        logoUrl: assets?.logoUrl ?? null,
      },
    });
    created += 1;
    if (assets) {
      console.log(`create supp. : ${supplierName.padEnd(40)} → ${assets.domain} (inferred)`);
    } else {
      console.log(`create supp. : ${supplierName.padEnd(40)} → no website (manual)`);
    }
  }
  return { created, updated };
}

async function main() {
  console.log('=== clients ===');
  const clients = await backfillClients();
  console.log(`\n=== contractors ===`);
  const contractors = await backfillContractors();
  console.log(`\n=== suppliers ===`);
  const supp = await backfillSuppliers();
  console.log(
    `\nbackfill complete · clients=${clients} contractors=${contractors} suppliers (created=${supp.created} refreshed=${supp.updated})`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
