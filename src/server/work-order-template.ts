import { prisma } from '@/server/db';

/**
 * Render a Work Order draft as Markdown for a project, pulling every
 * commercial detail off the Client / Project records so the legal text
 * stays in sync with what the Receipt Upload / Payables / draft-invoice
 * flows actually use. The draft is stored on Project.workOrderDraftText
 * for review; the partner can edit it inline before sending out for
 * countersignature, then upload the signed PDF on the same surface.
 *
 * Sections follow the standard AU consulting WO shape:
 *   1. Parties
 *   2. Engagement scope (project name + description)
 *   3. Term & schedule
 *   4. Fees & payment terms
 *   5. Pass-through expenses (rebillable rules)
 *   6. Project lead / day-to-day contacts
 *   7. Signatures
 */
export async function renderWorkOrderMarkdown(
  projectId: string,
): Promise<string> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      client: true,
      primaryPartner: { select: { firstName: true, lastName: true } },
      manager: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  const today = new Date().toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const startDate = project.startDate
    ? project.startDate.toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : 'TBD';
  const endDate = project.endDate
    ? project.endDate.toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : 'TBD';

  const formatMoney = (cents: number): string =>
    new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: project.currency || 'AUD',
      maximumFractionDigits: 0,
    }).format(cents / 100);

  const clientAddress =
    [
      project.client.streetAddress,
      [project.client.suburb, project.client.state, project.client.postcode]
        .filter(Boolean)
        .join(' '),
      project.client.country !== 'AU' ? project.client.country : null,
    ]
      .filter(Boolean)
      .join(', ') ||
    project.client.billingAddress ||
    '_[address to be confirmed]_';

  const abnLine = project.client.abn
    ? `ABN ${project.client.abn.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4')}`
    : 'ABN _[to be confirmed]_';
  const acnLine = project.client.acn
    ? `ACN ${project.client.acn.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3')}`
    : '';

  const expenseClause = project.defaultExpensesRebillable
    ? 'Reasonable out-of-pocket expenses incurred by Foundry Health in the performance of this engagement (including travel, accommodation, third-party software licences, and external subject-matter experts) are **rebillable to the Client at cost** and will be invoiced alongside the relevant fee instalment. Foundry will retain receipts and provide an itemised pass-through schedule with each invoice.'
    : 'Fees stated in this Work Order are **inclusive of all standard delivery costs**. Foundry Health absorbs reasonable out-of-pocket expenses (travel, software, etc.) within the agreed fee. Any extraordinary cost requiring rebill must be agreed in writing in advance and will be added as a variation.';

  const poClause = project.client.purchaseOrderRequired
    ? '\n- A valid Purchase Order number must accompany every invoice. Invoices issued without a PO will be returned for reissue.'
    : '';

  const paymentInstructions = project.client.paymentInstructions
    ? `\n\n**Special instructions:** ${project.client.paymentInstructions}`
    : '';

  const tradingLine = project.client.tradingName
    ? ` (trading as ${project.client.tradingName})`
    : '';

  const contactBlock = project.client.contactName
    ? [
        `**Day-to-day contact:** ${project.client.contactName}`,
        project.client.contactTitle ? `_(${project.client.contactTitle})_` : '',
        project.client.contactEmail
          ? `Email: ${project.client.contactEmail}`
          : '',
        project.client.contactPhone
          ? `Phone: ${project.client.contactPhone}`
          : '',
      ]
        .filter(Boolean)
        .join('  \n')
    : '_Day-to-day contact: to be nominated by the Client._';

  return `# Work Order — ${project.code}

**${project.name}**

This Work Order is issued under the Client Services Agreement (CSA)
between Foundry Health and the Client and is governed by its terms.

---

## 1. Parties

| Party | Details |
| --- | --- |
| **Service provider** | Foundry Health Pty Ltd · ABN _[Foundry ABN]_ · Sydney, NSW |
| **Client** | ${project.client.legalName}${tradingLine} · ${abnLine}${acnLine ? ` · ${acnLine}` : ''} |
| **Client address** | ${clientAddress} |
| **Client billing email** | ${project.client.billingEmail ?? '_[to be confirmed]_'} |

## 2. Engagement scope

**Project code:** ${project.code}
**Project name:** ${project.name}

${project.description ?? '_Scope summary to be inserted. Outline the engagement objectives, deliverables, methodology, and acceptance criteria._'}

## 3. Term & schedule

- **Commencement:** ${startDate}
- **Theoretical completion:** ${endDate}
- This Work Order remains in force until the deliverables are accepted by
  the Client or the engagement is terminated under the CSA.

## 4. Fees & payment terms

- **Total contract value:** ${formatMoney(project.contractValue)} (ex GST).
- Payable per the schedule agreed with the Client lead, invoiced in arrears.
- **Payment terms:** ${project.client.paymentTerms.replace('-', ' ')}.${poClause}${paymentInstructions}
- GST is added to all invoices in accordance with Australian tax law.

## 5. Pass-through expenses

${expenseClause}

## 6. Project leadership

- **Foundry — Engagement partner:** ${project.primaryPartner.firstName} ${project.primaryPartner.lastName}
- **Foundry — Project manager:** ${project.manager.firstName} ${project.manager.lastName}${
    project.manager.email ? ` (${project.manager.email})` : ''
  }
- ${contactBlock.replace(/\n/g, '\n  ')}

## 7. Signatures

| | Signature | Name | Title | Date |
| --- | --- | --- | --- | --- |
| For Foundry Health | _________________________ | ${project.primaryPartner.firstName} ${project.primaryPartner.lastName} | Partner | _____________ |
| For ${project.client.legalName} | _________________________ | ${project.client.contactName ?? '_____________'} | ${project.client.contactTitle ?? '_____________'} | _____________ |

---

_Generated ${today} from the Foundry Ops project record. Edit inline before
sending for countersignature, or upload the executed PDF to replace this
draft on the project Settings → Engagement paperwork section._
`;
}
