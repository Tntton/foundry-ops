'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import {
  addDealContact,
  deleteDealContact,
  type DealUpdateState,
} from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type DealContactRow = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

export function DealContactsPanel({
  dealId,
  contacts,
  canEdit,
}: {
  dealId: string;
  contacts: DealContactRow[];
  canEdit: boolean;
}) {
  const [showForm, setShowForm] = useState(contacts.length === 0 && canEdit);

  return (
    <div className="space-y-3">
      {contacts.length === 0 ? (
        <p className="text-sm text-ink-3">No contacts yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {contacts.map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              dealId={dealId}
              canEdit={canEdit}
            />
          ))}
        </ul>
      )}
      {canEdit && !showForm && (
        <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
          + Add contact
        </Button>
      )}
      {canEdit && showForm && (
        <AddContactForm dealId={dealId} onDone={() => setShowForm(false)} />
      )}
    </div>
  );
}

function ContactRow({
  contact,
  dealId,
  canEdit,
}: {
  contact: DealContactRow;
  dealId: string;
  canEdit: boolean;
}) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="text-sm">
        <div className="text-ink">
          <span className="font-medium">{contact.name}</span>
          {contact.role && <span className="ml-2 text-ink-3">· {contact.role}</span>}
        </div>
        {(contact.email || contact.phone) && (
          <div className="text-xs text-ink-3">
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="hover:text-ink">
                {contact.email}
              </a>
            )}
            {contact.email && contact.phone && <span className="mx-1">·</span>}
            {contact.phone && <span>{contact.phone}</span>}
          </div>
        )}
        {contact.notes && (
          <p className="mt-1 text-xs text-ink-3">{contact.notes}</p>
        )}
      </div>
      {canEdit && <DeleteContactButton dealId={dealId} contactId={contact.id} />}
    </li>
  );
}

function DeleteContactButton({
  dealId,
  contactId,
}: {
  dealId: string;
  contactId: string;
}) {
  const bound = deleteDealContact.bind(null, dealId, contactId);
  const [, action] = useFormState<DealUpdateState, FormData>(bound, {
    status: 'idle',
  });
  return (
    <form action={action as unknown as (fd: FormData) => void}>
      <button
        type="submit"
        className="text-xs text-ink-4 hover:text-status-red"
        onClick={(e) => {
          if (!confirm('Remove this contact?')) e.preventDefault();
        }}
      >
        Remove
      </button>
    </form>
  );
}

function AddContactForm({
  dealId,
  onDone,
}: {
  dealId: string;
  onDone: () => void;
}) {
  const bound = addDealContact.bind(null, dealId);
  const [state, action] = useFormState<DealUpdateState, FormData>(bound, {
    status: 'idle',
  });

  if (state.status === 'success') {
    onDone();
  }

  return (
    <form action={action} className="space-y-2 rounded-md border border-line bg-card p-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <Input name="name" placeholder="Name *" required />
        <Input name="role" placeholder="Role / title" />
        <Input name="email" type="email" placeholder="Email" />
        <Input name="phone" placeholder="Phone" />
      </div>
      <textarea
        name="notes"
        rows={2}
        placeholder="Notes (context on this contact)"
        className="w-full rounded-md border border-line bg-surface-elev px-3 py-2 text-xs text-ink"
      />
      <div className="flex items-center gap-2">
        <SaveBtn />
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {state.status === 'error' && (
          <span className="text-xs text-status-red">{state.message}</span>
        )}
      </div>
    </form>
  );
}

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving…' : 'Add'}
    </Button>
  );
}
