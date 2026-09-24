/**
 * Document-type routing for WhatsApp image intake (TASK-132).
 *
 * A bare image sent over WhatsApp is OCR'd once; this pure logic decides
 * whether it should become an Expense (a receipt the person paid) or a
 * Bill (a supplier invoice to pay), or whether it's too ambiguous and we
 * should ask the user. A caption keyword always wins over the classifier.
 */

export type DocRoute = 'expense' | 'bill' | 'clarify';

/** Min classifier confidence to auto-route without asking the user. */
export const DOC_ROUTE_CONFIDENCE_MIN = 55;

export function decideDocRoute(input: {
  documentType: 'receipt' | 'supplier_invoice' | 'unknown' | null;
  /** confidence.documentType (0-100), if the model returned it. */
  docConfidence: number | undefined;
  /** The WhatsApp caption text accompanying the image, if any. */
  caption: string | null;
}): DocRoute {
  // Caption override — an explicit word from the user beats the classifier.
  const cap = (input.caption ?? '').toLowerCase();
  if (/\b(bill|invoice|payable)\b/u.test(cap)) return 'bill';
  if (/\breceipt\b/u.test(cap)) return 'expense';

  const t = input.documentType;
  const c = input.docConfidence ?? 0;
  if (t === 'supplier_invoice' && c >= DOC_ROUTE_CONFIDENCE_MIN) return 'bill';
  if (t === 'receipt' && c >= DOC_ROUTE_CONFIDENCE_MIN) return 'expense';
  return 'clarify';
}

/** Parse a user's reply to the "RECEIPT or BILL?" clarify prompt. */
export function parseDocChoice(text: string | null): 'expense' | 'bill' | null {
  const t = (text ?? '').trim().toLowerCase();
  if (/^(bill|invoice)\b/u.test(t) || t === 'bill' || t === 'invoice') {
    return 'bill';
  }
  if (/^receipt\b/u.test(t) || t === 'receipt') return 'expense';
  return null;
}
