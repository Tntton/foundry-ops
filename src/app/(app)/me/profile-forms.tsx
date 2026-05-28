'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useRef, useState, useTransition } from 'react';
import {
  updateOwnBankDetails,
  updateOwnEmergencyContact,
  updateOwnPublicProfile,
  uploadOwnAsset,
  type MeUpdateState,
} from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const initial: MeUpdateState = { status: 'idle' };

// ─────────────────────────────────────────────────────────────────────
// Bank account form
// ─────────────────────────────────────────────────────────────────────

const COUNTRY_OPTIONS = [
  { code: 'AU', label: 'Australia' },
  { code: 'NZ', label: 'New Zealand' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'US', label: 'United States' },
  { code: 'SG', label: 'Singapore' },
  { code: 'CA', label: 'Canada' },
  { code: 'IE', label: 'Ireland' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'HK', label: 'Hong Kong' },
  { code: 'JP', label: 'Japan' },
  { code: 'OTHER', label: 'Other' },
];

export function BankDetailsForm({
  defaults,
}: {
  defaults: {
    bankCountry: string;
    bankAccountName: string | null;
    bankName: string | null;
    bankBsb: string | null;
    bankAcc: string | null;
    bankSwift: string | null;
    bankIban: string | null;
  };
}) {
  const [state, action] = useFormState(updateOwnBankDetails, initial);
  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};
  const [country, setCountry] = useState(defaults.bankCountry || 'AU');
  const isAU = country === 'AU';

  return (
    <form action={action} className="space-y-3">
      <FormGrid>
        <Field label="Country" hint="ISO code drives required fields below" error={errs['bankCountry']}>
          <select
            name="bankCountry"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          >
            {COUNTRY_OPTIONS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Account name" error={errs['bankAccountName']}>
          <Input
            name="bankAccountName"
            defaultValue={defaults.bankAccountName ?? ''}
            placeholder="As on the account"
          />
        </Field>
        <Field label="Bank / institution" error={errs['bankName']}>
          <Input
            name="bankName"
            defaultValue={defaults.bankName ?? ''}
            placeholder="e.g. Commonwealth Bank"
          />
        </Field>
      </FormGrid>

      {isAU ? (
        <FormGrid cols={2}>
          <Field label="BSB" hint="6 digits" error={errs['bankBsb']}>
            <Input
              name="bankBsb"
              defaultValue={defaults.bankBsb ?? ''}
              placeholder="062-000"
              className="font-mono"
            />
          </Field>
          <Field label="Account number" error={errs['bankAcc']}>
            <Input
              name="bankAcc"
              defaultValue={defaults.bankAcc ?? ''}
              placeholder="12345678"
              className="font-mono"
            />
          </Field>
        </FormGrid>
      ) : (
        <FormGrid cols={2}>
          <Field
            label="SWIFT / BIC"
            hint="8 or 11 alphanumeric"
            error={errs['bankSwift']}
          >
            <Input
              name="bankSwift"
              defaultValue={defaults.bankSwift ?? ''}
              placeholder="CTBAAU2S"
              className="font-mono uppercase"
            />
          </Field>
          <Field
            label="IBAN"
            hint="Where applicable (most of EU + others)"
            error={errs['bankIban']}
          >
            <Input
              name="bankIban"
              defaultValue={defaults.bankIban ?? ''}
              placeholder="GB29 NWBK 6016 1331 9268 19"
              className="font-mono uppercase"
            />
          </Field>
          <Field label="Local account number" error={errs['bankAcc']}>
            <Input
              name="bankAcc"
              defaultValue={defaults.bankAcc ?? ''}
              placeholder="If not using IBAN"
              className="font-mono"
            />
          </Field>
        </FormGrid>
      )}

      <FormFooter state={state} label="Save bank details" />
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Emergency contact form
// ─────────────────────────────────────────────────────────────────────

export function EmergencyContactForm({
  defaults,
}: {
  defaults: {
    emergencyContactName: string | null;
    emergencyContactRelationship: string | null;
    emergencyContactPhone: string | null;
    emergencyContactEmail: string | null;
  };
}) {
  const [state, action] = useFormState(updateOwnEmergencyContact, initial);
  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};

  return (
    <form action={action} className="space-y-3">
      <FormGrid>
        <Field label="Name" error={errs['emergencyContactName']}>
          <Input
            name="emergencyContactName"
            defaultValue={defaults.emergencyContactName ?? ''}
            placeholder="Full name"
          />
        </Field>
        <Field label="Relationship" error={errs['emergencyContactRelationship']}>
          <Input
            name="emergencyContactRelationship"
            defaultValue={defaults.emergencyContactRelationship ?? ''}
            placeholder="Partner / parent / sibling…"
          />
        </Field>
      </FormGrid>
      <FormGrid cols={2}>
        <Field label="Phone" error={errs['emergencyContactPhone']}>
          <Input
            name="emergencyContactPhone"
            defaultValue={defaults.emergencyContactPhone ?? ''}
            placeholder="+61 412 345 678"
          />
        </Field>
        <Field label="Email" error={errs['emergencyContactEmail']}>
          <Input
            name="emergencyContactEmail"
            type="email"
            defaultValue={defaults.emergencyContactEmail ?? ''}
            placeholder="optional"
          />
        </Field>
      </FormGrid>
      <FormFooter state={state} label="Save emergency contact" />
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Public profile form (website blurb + additional roles)
// ─────────────────────────────────────────────────────────────────────

export function PublicProfileForm({
  defaults,
}: {
  defaults: {
    websiteBlurb: string | null;
    additionalRoles: string[];
  };
}) {
  const [state, action] = useFormState(updateOwnPublicProfile, initial);

  return (
    <form action={action} className="space-y-3">
      <Field
        label="Additional roles"
        hint="Comma-separated. Free-form titles outside your band/level (e.g. AI/ML lead, Mentor)."
      >
        <Input
          name="additionalRolesCsv"
          defaultValue={defaults.additionalRoles.join(', ')}
          placeholder="AI/ML lead, Hiring captain, Mentor"
        />
      </Field>
      <Field
        label="Website blurb"
        hint="Short bio for foundry.health team page. Plain text, ~150 words."
      >
        <textarea
          name="websiteBlurb"
          defaultValue={defaults.websiteBlurb ?? ''}
          rows={4}
          placeholder="What you do, your background, what you're known for at Foundry."
          className="flex w-full rounded-md border border-line bg-surface-elev px-2 py-1.5 text-sm text-ink"
        />
      </Field>
      <FormFooter state={state} label="Save public profile" />
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Asset upload (CV / headshot)
// ─────────────────────────────────────────────────────────────────────

export function AssetUploader({
  kind,
  currentUrl,
}: {
  kind: 'cv' | 'headshot';
  currentUrl: string | null;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, action] = useFormState(uploadOwnAsset, initial);
  const [pending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const acceptAttr = kind === 'cv' ? 'application/pdf,.pdf' : 'image/*';
  const label = kind === 'cv' ? 'CV (PDF)' : 'Headshot (image)';

  function readFile(file: File): Promise<{ base64: string; mime: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const comma = result.indexOf(',');
        const base64 = comma >= 0 ? result.slice(comma + 1) : result;
        const mime =
          file.type ||
          (kind === 'cv' ? 'application/pdf' : 'image/jpeg');
        resolve({ base64, mime });
      };
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(file);
    });
  }

  async function onPick(file: File) {
    setErrorMsg(null);
    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg('Max 10 MB.');
      return;
    }
    let body: { base64: string; mime: string };
    try {
      body = await readFile(file);
    } catch {
      setErrorMsg('Could not read file.');
      return;
    }
    const fd = new FormData();
    fd.set('kind', kind);
    fd.set('fileBase64', body.base64);
    fd.set('fileMime', body.mime);
    fd.set('fileName', file.name);
    startTransition(() => {
      action(fd);
    });
  }

  // Headshot preview if it's an image data URL we can render inline.
  let preview: React.ReactNode = null;
  if (currentUrl) {
    const isDataUrl = currentUrl.startsWith('data:');
    const dataMime = isDataUrl
      ? currentUrl.slice(5, currentUrl.indexOf(';'))
      : null;
    if (kind === 'headshot' && dataMime?.startsWith('image/')) {
      preview = (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={currentUrl}
          alt="Headshot preview"
          className="h-20 w-20 rounded-full border border-line object-cover"
        />
      );
    } else if (kind === 'cv') {
      preview = (
        <a
          href={currentUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-brand hover:underline"
        >
          Open current CV ↗
        </a>
      );
    }
  }

  return (
    <div className="flex items-center gap-3">
      {preview}
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptAttr}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onPick(f);
        }}
      />
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={pending}
        >
          {pending
            ? 'Uploading…'
            : currentUrl
              ? `Replace ${label}`
              : `Upload ${label}`}
        </Button>
        {(state.status === 'error' || errorMsg) && (
          <span className="text-[11px] text-status-red">
            {errorMsg ?? (state.status === 'error' ? state.message : '')}
          </span>
        )}
        {state.status === 'success' && (
          <span className="text-[11px] text-status-green">{state.message}</span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────

function FormGrid({
  cols = 3,
  children,
}: {
  cols?: 2 | 3;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-3 ${
        cols === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'
      }`}
    >
      {children}
    </div>
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
        {hint && <span className="ml-2 font-normal text-ink-4">· {hint}</span>}
      </label>
      {children}
      {error && <p className="text-xs text-status-red">{error}</p>}
    </div>
  );
}

function FormFooter({
  state,
  label,
}: {
  state: MeUpdateState;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span aria-live="polite" className="text-xs">
        {state.status === 'error' && (
          <span className="text-status-red">{state.message}</span>
        )}
        {state.status === 'success' && (
          <span className="text-status-green">{state.message}</span>
        )}
      </span>
      <SaveButton label={label} />
    </div>
  );
}

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}
