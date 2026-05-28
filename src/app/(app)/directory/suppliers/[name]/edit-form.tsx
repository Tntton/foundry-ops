'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState, useTransition } from 'react';
import {
  upsertSupplierProfile,
  type SupplierProfileState,
} from './actions';
import { lookupAbnForForm } from '../../clients/abr-action';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const SUPPLIER_TYPES: Array<{ value: string; label: string }> = [
  { value: 'private_company', label: 'Private company (Pty Ltd)' },
  { value: 'public_company', label: 'Public company' },
  { value: 'government', label: 'Government' },
  { value: 'not_for_profit', label: 'Not-for-profit' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'sole_trader', label: 'Sole trader' },
  { value: 'individual', label: 'Individual' },
];

export type SupplierEditSnapshot = {
  name: string;
  legalName: string | null;
  abn: string | null;
  acn: string | null;
  supplierType: string;
  website: string | null;
  logoUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
};

/**
 * Inline edit form for the structured Supplier profile. Shares the
 * ABR-pull affordance with the Client edit form so adding a new
 * supplier feels exactly like adding a new client. The website +
 * email feed Clearbit; the result is shown live as the operator
 * types.
 */
export function SupplierEditForm({ supplier }: { supplier: SupplierEditSnapshot }) {
  const bound = upsertSupplierProfile.bind(null, supplier.name);
  const [state, action] = useFormState<SupplierProfileState, FormData>(bound, {
    status: 'idle',
  });
  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};

  const [abn, setAbn] = useState(supplier.abn ?? '');
  const [legalName, setLegalName] = useState(supplier.legalName ?? '');
  const [acn, setAcn] = useState(supplier.acn ?? '');
  const [supplierType, setSupplierType] = useState(supplier.supplierType);
  const [website, setWebsite] = useState(supplier.website ?? '');
  const [contactEmail, setContactEmail] = useState(supplier.contactEmail ?? '');
  const [abrPending, startAbr] = useTransition();
  const [abrMsg, setAbrMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(
    null,
  );

  const optimisticLogo = previewLogoUrl(website || contactEmail) ?? supplier.logoUrl;

  function runAbrLookup() {
    setAbrMsg(null);
    startAbr(async () => {
      const result = await lookupAbnForForm(abn, {
        website: website || null,
        email: contactEmail || null,
      });
      if (!result.ok) {
        setAbrMsg({
          kind: result.configured ? 'err' : 'info',
          text: result.error,
        });
        return;
      }
      setLegalName(result.legalName);
      if (result.acn) setAcn(result.acn);
      setSupplierType(result.clientType);
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
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Display name (read-only)">
          <Input value={supplier.name} disabled />
        </Field>
        <Field label="Legal name" hint="As registered" error={errs['legalName']}>
          <Input
            name="legalName"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            placeholder={supplier.name}
          />
        </Field>
        <Field label="Entity type" error={errs['supplierType']}>
          <select
            name="supplierType"
            value={supplierType}
            onChange={(e) => setSupplierType(e.target.value)}
            className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          >
            {SUPPLIER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
        <Field label="Contact phone">
          <Input
            name="contactPhone"
            defaultValue={supplier.contactPhone ?? ''}
            placeholder="+61 …"
          />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
        <Field
          label="Website"
          error={errs['website']}
          hint="Drives the company logo (Clearbit)."
        >
          <Input
            name="website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://www.supplier.com.au"
          />
        </Field>
        <Field label="Contact email" error={errs['contactEmail']}>
          <Input
            name="contactEmail"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="ap@supplier.com.au"
          />
        </Field>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-ink-3">Logo preview</label>
          <LogoPreview src={optimisticLogo} alt={legalName || supplier.name} />
        </div>
      </div>

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
          Auto-fills legal name, ACN, entity type from the Australian
          Business Register. Logo + website resolved at the same time.
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

      {state.status === 'error' && (
        <p className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </p>
      )}
      {state.status === 'success' && (
        <p className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
          Saved.
        </p>
      )}
      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving…' : 'Save supplier profile'}
    </Button>
  );
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
