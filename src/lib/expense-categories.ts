/**
 * Canonical expense / bill category set.
 *
 * Aligned with the Xero AU starter chart of accounts + ATO Income Tax
 * Assessment Act 1997 deductibility rules. Every category maps to a
 * specific Xero account name so the AP push (Bills → Xero, Expenses →
 * Xero) lands them in the right line of the GL with no extra mapping
 * step required by the bookkeeper.
 *
 * Rules of thumb baked in here:
 *   - Travel split from Meals/Entertainment because the FBT
 *     treatment differs (client entertainment is subject to FBT or
 *     non-deductible; staff working-lunch meals on travel are 100%
 *     deductible).
 *   - Computer Equipment separate from Office Supplies — laptops &
 *     monitors are depreciable assets when >$300 (immediate
 *     write-off below that threshold under the small-business pool).
 *   - Subcontractor Fees separate from Professional Fees so the AP
 *     team can spot ABN/withholding obligations at a glance (TPAR
 *     reporting for some subcontractor relationships).
 *   - Memberships (professional bodies) separate from Subscriptions
 *     (software / SaaS) — same Xero default split.
 *
 * Bills + expenses share this list. Categories are stored as the
 * snake_case `value` on the row; display copy lives here.
 */

export type ExpenseCategory =
  | 'travel'
  | 'meals_entertainment'
  | 'motor_vehicle'
  | 'office_supplies'
  | 'computer_equipment'
  | 'software_subscriptions'
  | 'telephone_internet'
  | 'professional_fees'
  | 'subcontractor_fees'
  | 'marketing_bd'
  | 'training_conferences'
  | 'insurance'
  | 'memberships'
  | 'bank_fees'
  | 'utilities'
  | 'rent'
  | 'repairs_maintenance'
  | 'other';

export type ExpenseCategoryMeta = {
  value: ExpenseCategory;
  label: string;
  /** Default Xero account name (AU starter chart). The Xero push reads
   *  this when posting a Bill / Expense so the bookkeeper doesn't
   *  re-code each line manually. */
  xeroAccount: string;
  /** Short description shown as a tooltip in the dropdown. Helps the
   *  operator pick the right bucket when the line item could plausibly
   *  fit two (e.g. taxi to airport vs taxi to client meeting). */
  hint: string;
};

/**
 * Display-label conventions (consistent across the set):
 *   - Sentence case: capitalise the first word + acronyms only
 *     (e.g. "Marketing & BD" — "BD" stays capitalised because it's
 *     Foundry's standing acronym for business development).
 *   - "&" for compound categories (never "/" or "and").
 *   - No trailing qualifiers like "/ general" — pick the canonical
 *     name and let `hint` carry nuance.
 *   - Singular nouns where there's a default verb form ("Travel",
 *     "Insurance", "Rent"); plural where the bucket is inherently a
 *     collection ("Office supplies", "Bank fees").
 *
 * `xeroAccount` strings deliberately keep Xero's own title-case +
 * spelling ("Bank Fees", "Software & Subscriptions") because they're
 * external lookup keys, not display labels.
 */
export const EXPENSE_CATEGORIES: readonly ExpenseCategoryMeta[] = [
  {
    value: 'travel',
    label: 'Travel',
    xeroAccount: 'Travel',
    hint: 'Flights, accommodation, taxis & Uber, parking when on a billable trip. Domestic & international.',
  },
  {
    value: 'meals_entertainment',
    label: 'Meals & entertainment',
    xeroAccount: 'Meals & Entertainment',
    hint: 'Client meals, working lunches, team meals. Note FBT rules — entertainment is generally non-deductible or subject to FBT.',
  },
  {
    value: 'motor_vehicle',
    label: 'Motor vehicle',
    xeroAccount: 'Motor Vehicle Expenses',
    hint: 'Fuel, parking, tolls & ride-shares for non-travel purposes (around-town meetings).',
  },
  {
    value: 'office_supplies',
    label: 'Office supplies',
    xeroAccount: 'Office Supplies',
    hint: 'Stationery, printing, postage, courier, low-cost office consumables.',
  },
  {
    value: 'computer_equipment',
    label: 'Computer equipment',
    xeroAccount: 'Computer Equipment',
    hint: 'Laptops, monitors, peripherals, cables. Items >$300 are depreciable; <$300 immediate write-off (small-business pool).',
  },
  {
    value: 'software_subscriptions',
    label: 'Software & subscriptions',
    xeroAccount: 'Software & Subscriptions',
    hint: 'SaaS (Notion, Figma, Vercel, etc.), software licenses, cloud hosting, domains.',
  },
  {
    value: 'telephone_internet',
    label: 'Telephone & internet',
    xeroAccount: 'Telephone & Internet',
    hint: 'Mobile phones, fixed internet, voice & SMS services.',
  },
  {
    value: 'professional_fees',
    label: 'Professional fees',
    xeroAccount: 'Professional Fees',
    hint: 'Legal, accounting, audit & advisory fees that Foundry pays out (not subcontractor fees).',
  },
  {
    value: 'subcontractor_fees',
    label: 'Subcontractor & consultant fees',
    xeroAccount: 'Consulting & Accounting',
    hint: 'Contractors paid for client-billable work. Watch ABN & TPAR obligations.',
  },
  {
    value: 'marketing_bd',
    label: 'Marketing & BD',
    xeroAccount: 'Advertising & Marketing',
    hint: 'BD collateral, sponsorships, ads & marketing services. Conferences are a separate category.',
  },
  {
    value: 'training_conferences',
    label: 'Training & conferences',
    xeroAccount: 'Conferences, Seminars & Training',
    hint: 'Conference attendance, professional development, training courses & certification fees.',
  },
  {
    value: 'insurance',
    label: 'Insurance',
    xeroAccount: 'Insurance',
    hint: 'PI, public liability, business contents & cyber insurance.',
  },
  {
    value: 'memberships',
    label: 'Memberships & subscriptions',
    xeroAccount: 'Memberships & Subscriptions',
    hint: 'Professional body memberships (AMA, AICD, industry associations). Distinct from software subscriptions.',
  },
  {
    value: 'bank_fees',
    label: 'Bank fees',
    xeroAccount: 'Bank Fees',
    hint: 'Bank account fees, merchant fees, FX conversion fees & payment-gateway fees.',
  },
  {
    value: 'utilities',
    label: 'Utilities',
    xeroAccount: 'Utilities',
    hint: 'Power, water & gas. Coworking-space fees go under Rent.',
  },
  {
    value: 'rent',
    label: 'Rent',
    xeroAccount: 'Rent',
    hint: 'Office & coworking rent, room hire for meetings (when not part of a travel trip).',
  },
  {
    value: 'repairs_maintenance',
    label: 'Repairs & maintenance',
    xeroAccount: 'Repairs & Maintenance',
    hint: 'Equipment repairs, software & hardware maintenance contracts.',
  },
  {
    value: 'other',
    label: 'Other',
    xeroAccount: 'General Expenses',
    hint: 'Last-resort bucket — admin will re-code at month-end if needed.',
  },
];

// `as const` tuple so Zod's z.enum can consume the list directly. The
// `EXPENSE_CATEGORIES.map(...)` form widens to `readonly string[]` and
// loses the literal-union tuple shape Zod needs.
export const EXPENSE_CATEGORY_VALUES = [
  'travel',
  'meals_entertainment',
  'motor_vehicle',
  'office_supplies',
  'computer_equipment',
  'software_subscriptions',
  'telephone_internet',
  'professional_fees',
  'subcontractor_fees',
  'marketing_bd',
  'training_conferences',
  'insurance',
  'memberships',
  'bank_fees',
  'utilities',
  'rent',
  'repairs_maintenance',
  'other',
] as const satisfies readonly ExpenseCategory[];

const META_BY_VALUE = new Map<ExpenseCategory, ExpenseCategoryMeta>(
  EXPENSE_CATEGORIES.map((c) => [c.value, c]),
);

export function expenseCategoryMeta(
  value: ExpenseCategory,
): ExpenseCategoryMeta {
  return META_BY_VALUE.get(value) ?? META_BY_VALUE.get('other')!;
}

export function expenseCategoryLabel(value: string): string {
  return META_BY_VALUE.get(value as ExpenseCategory)?.label ?? value;
}

/**
 * Map a free-form category string (typically from the OCR agent) to a
 * canonical category. Tries keyword heuristics in priority order so
 * "Software/SaaS" routes to software_subscriptions before "subscription"
 * would have caught it under memberships, etc. Falls back to `other`.
 */
export function mapFreeFormToCategory(raw: string | null): ExpenseCategory {
  if (!raw) return 'other';
  const lower = raw.toLowerCase();
  // Computer equipment first — laptops & monitors keywords are
  // specific enough to outrank "office".
  if (/(laptop|monitor|keyboard|mouse|peripheral|cable|adapter|webcam|headset|display|computer hardware)/.test(lower))
    return 'computer_equipment';
  if (/(software|saas|license|hosting|cloud|domain|subscription|figma|notion|google workspace|microsoft 365|m365)/.test(lower))
    return 'software_subscriptions';
  if (/(phone|mobile|internet|nbn|telco|voip|sms)/.test(lower))
    return 'telephone_internet';
  if (/(uber|taxi|ride.?share|lyft|didi|cabcharge)/.test(lower) && /(parking|fuel|toll|servo|petrol)/.test(lower) === false && /(travel|trip|airport|flight|hotel|accom)/.test(lower))
    return 'travel';
  if (/(parking|fuel|petrol|servo|toll|car hire|rental car|motor)/.test(lower))
    return 'motor_vehicle';
  if (/(flight|airfare|hotel|accom|airline|train|ride.?share|uber|taxi|travel|trip)/.test(lower))
    return 'travel';
  if (/(meal|food|lunch|dinner|breakfast|coffee|restaurant|cafe|catering|drinks|entertainment)/.test(lower))
    return 'meals_entertainment';
  if (/(stationery|stationary|printing|courier|post|office supplies)/.test(lower))
    return 'office_supplies';
  if (/(legal|lawyer|solicitor|accountant|audit|professional fee|advisory)/.test(lower))
    return 'professional_fees';
  if (/(contractor|subcontractor|consultant|sme|expert.*hour)/.test(lower))
    return 'subcontractor_fees';
  if (/(marketing|advertising|advert|bd |business development|sponsor|brand)/.test(lower))
    return 'marketing_bd';
  if (/(conference|training|course|seminar|workshop|cpd|professional development|certification)/.test(lower))
    return 'training_conferences';
  if (/(insurance|pi cover|public liability)/.test(lower))
    return 'insurance';
  if (/(membership|aicd|ama|royal college|professional body|society)/.test(lower))
    return 'memberships';
  if (/(bank fee|merchant fee|fx fee|stripe fee|payment fee|transaction fee)/.test(lower))
    return 'bank_fees';
  if (/(rent|coworking|wework|office lease)/.test(lower))
    return 'rent';
  if (/(electricity|gas|water|utilit)/.test(lower))
    return 'utilities';
  if (/(repair|maintenance)/.test(lower))
    return 'repairs_maintenance';
  return 'other';
}
