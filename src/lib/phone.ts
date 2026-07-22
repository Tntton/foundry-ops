/**
 * Phone / WhatsApp link helpers. `wa.me` expects a bare international
 * number with no `+`, spaces, or punctuation, so we strip everything
 * that isn't a digit. Stored numbers are free-form (`phone`) or loosely
 * E.164 (`whatsappNumber`), hence the defensive normalisation.
 */

/** Digits-only form of a phone number, or '' when there's nothing usable. */
export function phoneDigits(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/[^0-9]/g, '');
}

/**
 * Build a `https://wa.me/<digits>` link for a phone number, or `null`
 * when the input has no digits (so callers can render a plain fallback).
 */
export function waLink(raw: string | null | undefined): string | null {
  const digits = phoneDigits(raw);
  return digits ? `https://wa.me/${digits}` : null;
}
