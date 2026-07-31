import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  invoicesSheet,
  expensesSheet,
  pipelineSheet,
  partnerPoolSheets,
  type InvoiceExportRow,
  type ExpenseExportRow,
} from '@/server/exports/list-workbooks';
import { buildWorkbookBuffer } from '@/server/exports/excel-workbook';
import type { AdminBdPipeline } from '@/server/reports/admin-bd-pipeline';
import type { PartnerScoreboard } from '@/server/reports/partner-scorecard';

/**
 * TASK-063/064/065/066 · list workbooks. Pure sheet builders over
 * fixtures — header shape, numeric money, and row counts.
 */

describe('invoicesSheet (TASK-063)', () => {
  it('maps invoices with numeric money', () => {
    const rows: InvoiceExportRow[] = [
      {
        number: 'IFM001-INV-12',
        clientCode: 'IFM',
        clientName: 'Ivory Foods',
        projectCode: 'IFM001',
        status: 'sent',
        issueDate: new Date('2026-07-08'),
        dueDate: new Date('2026-08-07'),
        amountExGst: 17000,
        gst: 1700,
        amountTotal: 18700,
        paymentReceivedAmount: null,
        xeroInvoiceId: 'x1',
      },
    ];
    const buf = buildWorkbookBuffer([invoicesSheet(rows)]);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets['Invoices']!, { header: 1, blankrows: false }) as unknown[][];
    expect(aoa[0]![0]).toBe('Number');
    expect(aoa[1]![0]).toBe('IFM001-INV-12');
    expect(aoa[1]![9]).toBe(187); // total 18700c → 187
    expect(aoa[1]![11]).toBe('yes'); // xero present
  });
});

describe('expensesSheet (TASK-064)', () => {
  it('maps expenses and defaults blank project to OPEX upstream', () => {
    const rows: ExpenseExportRow[] = [
      {
        date: new Date('2026-07-05'),
        submitter: 'Jas Navarro',
        category: 'travel',
        vendor: 'Uber',
        projectCode: 'OPEX',
        status: 'submitted',
        amount: 2200,
        gst: 200,
      },
    ];
    const sheet = expensesSheet(rows);
    expect(sheet.name).toBe('Expenses');
    expect(sheet.rows[0]![6]).toBe(22); // amount 2200c → 22
  });
});

describe('pipelineSheet (TASK-065)', () => {
  it('maps BD rows with weighted value', () => {
    const pipeline = {
      rows: [
        {
          id: 'd1',
          code: 'BD-1',
          name: 'Acme CDD',
          stage: 'proposal' as const,
          sector: 'Health',
          clientLabel: 'Acme',
          expectedValueCents: 5_000_000,
          probability: 60,
          weightedCents: 3_000_000,
          ownerInitials: 'TT',
          ownerName: 'Trung',
          targetCloseIso: '2026-09-01',
          ageDays: 12,
        },
      ],
      totals: {} as AdminBdPipeline['totals'],
    } as AdminBdPipeline;
    const sheet = pipelineSheet(pipeline);
    expect(sheet.rows[0]![5]).toBe(50000); // expected 5,000,000c → 50000
    expect(sheet.rows[0]![7]).toBe(30000); // weighted
  });
});

describe('partnerPoolSheets (TASK-066)', () => {
  it('splits full vs associate partners', () => {
    const board = {
      fullPartners: [
        {
          personId: 'p1',
          initials: 'TT',
          firstName: 'Trung',
          lastName: 'T',
          band: 'Partner',
          active: true,
          isFullPartner: true,
          clientsLed: 3,
          activeProjects: 5,
          totalProjects: 8,
          invoicedCents: 100_000_00,
          wipCents: 0,
          costCents: 0,
          marginCents: 50_000_00,
          marginPct: 50,
          openDeals: 2,
          weightedPipelineCents: 20_000_00,
          wonDealsYtdCents: 0,
          hoursApproved: 100,
          decisionsMadeLast30: 4,
          headshotUrl: null,
          contributions: {} as never,
        },
      ],
      associatePartners: [],
      totals: {} as PartnerScoreboard['totals'],
    } as PartnerScoreboard;
    const sheets = partnerPoolSheets(board);
    expect(sheets.map((s) => s.name)).toEqual(['Full partners', 'Associate partners']);
    expect(sheets[0]!.rows[0]![0]).toBe('Trung T');
    expect(sheets[0]!.rows[0]![5]).toBe(100000); // invoiced 100,000,00c → 100000
    expect(sheets[1]!.rows).toHaveLength(0);
  });
});
