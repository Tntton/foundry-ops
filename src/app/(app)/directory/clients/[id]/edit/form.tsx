'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState, useTransition } from 'react';
import { updateClient, type ClientEditState } from './actions';
import { lookupAbnForForm } from '../../abr-action';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type PartnerOption = {
  id: string;
  initials: string;
  firstName: string;
  lastName: string;
};

export type ClientSnapshot = {
  id: string;
  code: string;
  legalName: string;
  tradingName: string | null;
  abn: string | null;
  acn: string | null;
  clientType: string;
  streetAddress: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  country: string;
  billingEmail: string | null;
  contactName: string | null;
  contactTitle: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  domain: string | null;
  logoUrl: string | null;
  paymentTerms: string;
  purchaseOrderRequired: boolean;
  paymentInstructions: string | null;
  primaryPartnerId: string;
};

const CLIENT_TYPES: Array<{ value: string; label: string }> = [
  { value: 'private_company', label: 'Private company (Pty Ltd)' },
  { value: 'public_company', label: 'Public company' },
  { value: 'government', label: 'Government' },
  { value: 'not_for_profit', label: 'Not-for-profit' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'sole_trader', label: 'Sole trader' },
  { value: 'individual', label: 'Individual' },
];
const STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];
const TERMS = ['net-14', 'net-30', 'net-45', 'net-60'];

export function ClientEditForm({
  client,
  partners,
}: {
  client: ClientSnapshot;
  partners: PartnerOption[];
}) {
  const bound = updateClient.bind(null, client.id);
  const [state, action] = useFormState<ClientEditState, FormData>(bound, {
    status: 'idle',
  });
  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};

  // Controlled fields driven by ABR lookup so we can splat values back in.
  const [abn, setAbn] = useState(client.abn ?? '');
  const [legalName, setLegalName] = useState(client.legalName);
  const [tradingName, setTradingName] = useState(client.tradingName ?? '');
  const [acn, setAcn] = useState(client.acn ?? '');
  const [clientType, setClientType] = useState(client.clientType);
  const [stateCode, setStateCode] = useState(client.state ?? '');
  const [postcode, setPostcode] = useState(client.postcode ?? '');
  // Website + email hint feed the logo lookup. The contact email is
  // captured separately so the operator can leave website blank and
  // we'll best-effort-derive it from the email domain on the server.
  const [website, setWebsite] = useState(client.website ?? '');
  const [billingEmail, setBillingEmail] = useState(client.billingEmail ?? '');
  // Optimistic logo preview — Clearbit URL derived locally from the
  // typed-in website. The persisted logoUrl on the client snapshot is
  // shown until the operator edits the website.
  const optimisticLogo = previewLogoUrl(website || billingEmail) ?? client.logoUrl;

  const [abrPending, startAbr] = useTransition();
  const [abrMsg, setAbrMsg] = useState<{
    kind: 'ok' | 'err' | 'info';
    text: string;
  } | null>(null);

  function runAbrLookup() {
    setAbrMsg(null);
    startAbr(async () => {
      const result = await lookupAbnForForm(abn, {
        website: website || null,
        email: billingEmail || null,
      });
      if (!result.ok) {
        setAbrMsg({
          kind: result.configured ? 'err' : 'info',
          text: result.error,
        });
        return;
      }
      setLegalName(result.legalName);
      if (result.tradingName) setTradingName(result.tradingName);
      if (result.acn) setAcn(result.acn);
      setClientType(result.clientType);
      if (result.stateCode) setStateCode(result.stateCode);
      if (result.postcode) setPostcode(result.postcode);
      // ABR doesn't return a website; the action infers from the email
      // / website hint we just passed. Splat it back so the operator
      // sees the resolved value.
      if (result.website) setWebsite(result.website);
      const gstNote = result.gstRegistered ? 'GST-registered.' : 'Not GST-registered.';
      const logoNote = result.logoUrl ? ' Logo resolved.' : '';
      setAbrMsg({
        kind: 'ok',
        text: `Pulled from ABR · ${result.status} · ${gstNote}${logoNote} Review and save when happy.`,
      });
    });
  }

  return (
    <form action={action} className="space-y-6">
      {/* Identity ── primary keys + ABR lookup. The ABN field doubles as
          the lookup input — partners typically receive an ABN from the
          client and use it to bootstrap the rest of the profile. */}
      <Section title="Identity">
        <FieldRow>
          <Field label="Code" hint="Locked once created">
            <Input defaultValue={client.code} disabled className="font-mono" />
          </Field>
          <Field label="Legal name" error={errs['legalName']}>
            <Input
              name="legalName"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              required
            />
          </Field>
          <Field label="Trading name" hint="Optional · e.g. brand name">
            <Input
              name="tradingName"
              value={tradingName}
              onChange={(e) => setTradingName(e.target.value)}
            />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="ABN" error={errs['abn']} hint="11 digits">
            <Input
              name="abn"
              value={abn}
              onChange={(e) => setAbn(e.target.value)}
              placeholder="51 824 753 556"
              className="font-mono"
            />
          </Field>
          <Field label="ACN" error={errs['acn']} hint="9 digits · companies only">
            <Input
              name="acn"
              value={acn}
              onChange={(e) => setAcn(e.target.value)}
              placeholder="123 456 789"
              className="font-mono"
            />
          </Field>
          <Field label="Entity type" error={errs['clientType']}>
            <select
              name="clientType"
              value={clientType}
              onChange={(e) => setClientType(e.target.value)}
              className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
            >
              {CLIENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        </FieldRow>
        <FieldRow>
          <Field
            label="Website"
            hint="Drives the company logo (Clearbit) and ABR-derived domain inference."
          >
            <Input
              name="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://www.example.com.au"
            />
          </Field>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-ink-3">
              Logo preview
              <span className="ml-2 text-ink-4">· auto from website</span>
            </label>
            <LogoPreview src={optimisticLogo} alt={legalName} />
          </div>
        </FieldRow>
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-subtle/40 px-3 py-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={abrPending}
            onClick={runAbrLookup}
          >
            {abrPending ? 'Checking ABR…' : 'Pull from ABR ↗'}
          </Button>
          <span className="text-[11px] text-ink-3">
            Auto-fills legal name, trading name, ACN, entity type, and
            registered office state from the Australian Business Register.
            Resolves the logo from the website / email at the same time.
          </span>
          {abrMsg && (
            <span
              className={`ml-auto text-[11px] ${
                abrMsg.kind === 'ok'
                  ? 'text-status-green'
                  : abrMsg.kind === 'err'
                    ? 'text-status-red'
                    : 'text-status-amber'
              }`}
            >
              {abrMsg.text}
            </span>
          )}
        </div>
      </Section>

      <Section title="Registered address">
        <FieldRow>
          <Field label="Street address">
            <Input
              name="streetAddress"
              defaultValue={client.streetAddress ?? ''}
              placeholder="Level 5, 123 Macquarie Street"
            />
          </Field>
          <Field label="Suburb">
            <Input name="suburb" defaultValue={client.suburb ?? ''} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="State" error={errs['state']}>
            <select
              name="state"
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value)}
              className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
            >
              <option value="">—</option>
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Postcode" error={errs['postcode']}>
            <Input
              name="postcode"
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
              placeholder="2000"
              className="font-mono"
            />
          </Field>
          <Field label="Country">
            <Input
              name="country"
              defaultValue={client.country || 'AU'}
              className="font-mono"
            />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Point of contact">
        <FieldRow>
          <Field label="Contact name">
            <Input name="contactName" defaultValue={client.contactName ?? ''} />
          </Field>
          <Field label="Title / role">
            <Input
              name="contactTitle"
              defaultValue={client.contactTitle ?? ''}
              placeholder="Procurement Manager"
            />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Contact email" error={errs['contactEmail']}>
            <Input
              name="contactEmail"
              type="email"
              defaultValue={client.contactEmail ?? ''}
              placeholder="proc@example.com.au"
            />
          </Field>
          <Field label="Contact phone">
            <Input
              name="contactPhone"
              defaultValue={client.contactPhone ?? ''}
              placeholder="+61 2 9000 0000"
            />
          </Field>
          <Field label="Billing email" hint="Where invoices are sent" error={errs['billingEmail']}>
            <Input
              name="billingEmail"
              type="email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
              placeholder="ap@example.com.au"
            />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Payment terms">
        <FieldRow>
          <Field label="Net terms" error={errs['paymentTerms']}>
            <select
              name="paymentTerms"
              defaultValue={client.paymentTerms || 'net-30'}
              className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
            >
              {TERMS.map((t) => (
                <option key={t} value={t}>
                  {t.replace('-', ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="PO number required?" hint="Surfaces on invoice draft">
            <label className="mt-1 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="purchaseOrderRequired"
                value="1"
                defaultChecked={client.purchaseOrderRequired}
              />
              <span className="text-ink-2">
                Yes — block invoice send if no PO
              </span>
            </label>
          </Field>
        </FieldRow>
        <Field label="Special payment instructions" hint="Printed on invoices">
          <textarea
            name="paymentInstructions"
            defaultValue={client.paymentInstructions ?? ''}
            rows={3}
            className="flex w-full rounded-md border border-line bg-surface-elev px-2 py-1.5 text-sm text-ink"
            placeholder="Always send to ap@example.com.au with PO in the subject line."
          />
        </Field>
      </Section>

      <Section title="Internal owner">
        <Field label="Primary partner" error={errs['primaryPartnerId']}>
          <select
            name="primaryPartnerId"
            defaultValue={client.primaryPartnerId}
            className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          >
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.initials} · {p.firstName} {p.lastName}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      {state.status === 'error' && (
        <p className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" asChild>
          <a href={`/directory/clients/${client.id}`}>Cancel</a>
        </Button>
        <Submit />
      </div>
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save client profile'}
    </Button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-line bg-card p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{children}</div>;
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-ink-3">
        {label}
        {hint && <span className="ml-2 text-ink-4">· {hint}</span>}
      </label>
      {children}
      {error && <p className="text-xs text-status-red">{error}</p>}
    </div>
  );
}

/**
 * Optimistic Clearbit URL preview from whatever the operator has typed
 * into website / email. Mirrors `domainFromWebsite` + `domainFromEmail`
 * from the server helper but kept inline so this client component
 * doesn't reach into server-only code.
 */
function previewLogoUrl(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  let host: string | null = null;
  if (trimmed.includes('@')) {
    const at = trimmed.lastIndexOf('@');
    if (at > 0 && at < trimmed.length - 1) host = trimmed.slice(at + 1);
  } else {
    const withProto = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      host = new URL(withProto).host;
    } catch {
      host = null;
    }
  }
  if (!host) return null;
  if (host.startsWith('www.')) host = host.slice(4);
  const colon = host.indexOf(':');
  if (colon >= 0) host = host.slice(0, colon);
  if (!host.includes('.')) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  return `https://logo.clearbit.com/${host}`;
}

/**
 * Renders the resolved logo with a graceful fallback. Clearbit returns
 * a 404 for orgs they don't have on file — `onError` swaps to a muted
 * placeholder so the form doesn't show a broken image.
 */
function LogoPreview({ src, alt }: { src: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-line bg-surface-subtle text-[10px] uppercase tracking-wide text-ink-4">
        No logo
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`${alt} logo`}
      onError={() => setBroken(true)}
      className="h-12 w-12 rounded-md border border-line bg-white object-contain p-1"
    />
  );
}
