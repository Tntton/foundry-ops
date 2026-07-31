import { prisma } from '@/server/db';
import {
  buildWorkbookBuffer,
  type WorkbookSheet,
} from '@/server/exports/excel-workbook';
import {
  computeAdminBdPipeline,
  type AdminBdPipeline,
} from '@/server/reports/admin-bd-pipeline';
import {
  computePartnerScoreboard,
  type PartnerScoreboard,
  type PartnerScoreRow,
} from '@/server/reports/partner-scorecard';

/**
 * List-style workbooks (TASK-063 Invoices, 064 Expenses, 065 Pipeline,
 * 066 Partner-pool). Each pure `*Sheet(s)` builder is exported for tests;
 * the `build*Workbook` wrappers query/aggregate and assemble. Money is
 * numeric dollars so Excel can sum; dates are YYYY-MM-DD.
 */

const d = (cents: number): number => cents / 100;
const ymd = (date: Date): string => date.toISOString().slice(0, 10);

// ─── Invoices (TASK-063) ────────────────────────────────────────────

export type InvoiceExportRow = {
  number: string;
  clientCode: string;
  clientName: string;
  projectCode: string;
  status: string;
  issueDate: Date;
  dueDate: Date;
  amountExGst: number;
  gst: number;
  amountTotal: number;
  paymentReceivedAmount: number | null;
  xeroInvoiceId: string | null;
};

export function invoicesSheet(rows: InvoiceExportRow[]): WorkbookSheet {
  return {
    name: 'Invoices',
    header: [
      'Number',
      'Client code',
      'Client',
      'Project',
      'Status',
      'Issued',
      'Due',
      'Ex-GST',
      'GST',
      'Total',
      'Paid',
      'Xero',
    ],
    rows: rows.map((i) => [
      i.number,
      i.clientCode,
      i.clientName,
      i.projectCode,
      i.status,
      ymd(i.issueDate),
      ymd(i.dueDate),
      d(i.amountExGst),
      d(i.gst),
      d(i.amountTotal),
      i.paymentReceivedAmount === null ? '' : d(i.paymentReceivedAmount),
      i.xeroInvoiceId ? 'yes' : '',
    ]),
  };
}

export async function buildInvoicesWorkbook(): Promise<Buffer> {
  const rows = await prisma.invoice.findMany({
    orderBy: { issueDate: 'desc' },
    select: {
      number: true,
      status: true,
      issueDate: true,
      dueDate: true,
      amountExGst: true,
      gst: true,
      amountTotal: true,
      paymentReceivedAmount: true,
      xeroInvoiceId: true,
      client: { select: { code: true, legalName: true } },
      project: { select: { code: true } },
    },
  });
  return buildWorkbookBuffer([
    invoicesSheet(
      rows.map((i) => ({
        number: i.number,
        clientCode: i.client?.code ?? '',
        clientName: i.client?.legalName ?? '',
        projectCode: i.project?.code ?? '',
        status: i.status,
        issueDate: i.issueDate,
        dueDate: i.dueDate,
        amountExGst: i.amountExGst,
        gst: i.gst,
        amountTotal: i.amountTotal,
        paymentReceivedAmount: i.paymentReceivedAmount,
        xeroInvoiceId: i.xeroInvoiceId,
      })),
    ),
  ]);
}

// ─── Expenses (TASK-064) ────────────────────────────────────────────

export type ExpenseExportRow = {
  date: Date;
  submitter: string;
  category: string;
  vendor: string | null;
  projectCode: string;
  status: string;
  amount: number;
  gst: number;
};

export function expensesSheet(rows: ExpenseExportRow[]): WorkbookSheet {
  return {
    name: 'Expenses',
    header: [
      'Date',
      'Submitter',
      'Category',
      'Vendor',
      'Project',
      'Status',
      'Amount',
      'GST',
    ],
    rows: rows.map((e) => [
      ymd(e.date),
      e.submitter,
      e.category,
      e.vendor ?? '',
      e.projectCode,
      e.status,
      d(e.amount),
      d(e.gst),
    ]),
  };
}

export async function buildExpensesWorkbook(): Promise<Buffer> {
  const rows = await prisma.expense.findMany({
    orderBy: { date: 'desc' },
    select: {
      date: true,
      category: true,
      vendor: true,
      status: true,
      amount: true,
      gst: true,
      person: { select: { firstName: true, lastName: true } },
      project: { select: { code: true } },
    },
  });
  return buildWorkbookBuffer([
    expensesSheet(
      rows.map((e) => ({
        date: e.date,
        submitter: `${e.person.firstName} ${e.person.lastName}`,
        category: e.category,
        vendor: e.vendor,
        projectCode: e.project?.code ?? 'OPEX',
        status: e.status,
        amount: e.amount,
        gst: e.gst,
      })),
    ),
  ]);
}

// ─── Pipeline (TASK-065) ────────────────────────────────────────────

export function pipelineSheet(pipeline: AdminBdPipeline): WorkbookSheet {
  return {
    name: 'Pipeline',
    header: [
      'Code',
      'Name',
      'Stage',
      'Sector',
      'Client',
      'Expected',
      'Probability %',
      'Weighted',
      'Owner',
      'Target close',
      'Age (days)',
    ],
    rows: pipeline.rows.map((r) => [
      r.code,
      r.name,
      r.stage,
      r.sector ?? '',
      r.clientLabel,
      d(r.expectedValueCents),
      r.probability,
      d(r.weightedCents),
      r.ownerName,
      r.targetCloseIso ?? '',
      r.ageDays,
    ]),
  };
}

export async function buildPipelineWorkbook(): Promise<Buffer> {
  return buildWorkbookBuffer([pipelineSheet(await computeAdminBdPipeline())]);
}

// ─── Partner pool (TASK-066) ────────────────────────────────────────

const PARTNER_HEADER = [
  'Partner',
  'Initials',
  'Band',
  'Clients led',
  'Active projects',
  'Invoiced',
  'WIP',
  'Margin',
  'Margin %',
  'Open deals',
  'Weighted pipeline',
  'Won YTD',
  'Hours approved',
];

function partnerRow(p: PartnerScoreRow): (string | number)[] {
  return [
    `${p.firstName} ${p.lastName}`,
    p.initials,
    p.band,
    p.clientsLed,
    p.activeProjects,
    d(p.invoicedCents),
    d(p.wipCents),
    d(p.marginCents),
    p.marginPct ?? '',
    p.openDeals,
    d(p.weightedPipelineCents),
    d(p.wonDealsYtdCents),
    p.hoursApproved,
  ];
}

export function partnerPoolSheets(board: PartnerScoreboard): WorkbookSheet[] {
  return [
    {
      name: 'Full partners',
      header: PARTNER_HEADER,
      rows: board.fullPartners.map(partnerRow),
    },
    {
      name: 'Associate partners',
      header: PARTNER_HEADER,
      rows: board.associatePartners.map(partnerRow),
    },
  ];
}

export async function buildPartnerPoolWorkbook(): Promise<Buffer> {
  return buildWorkbookBuffer(partnerPoolSheets(await computePartnerScoreboard()));
}
