import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { streamAssistantReply } from '@/server/agents/assistant/chat';
import { checkAssistantRateLimit } from '@/server/agents/assistant/rate-limit';
import {
  appendMessage,
  getOrCreateActiveThread,
  listThreadMessages,
  maybeArchiveIfFull,
  ASSISTANT_MAX_TURNS,
} from '@/server/agents/assistant/threads';
import { extractIntakeFields } from '@/server/agents/intake-ocr/extract';
import { dispatchBulkCsv } from '@/server/agents/assistant/bulk-csv';
import { writeAudit } from '@/server/audit';

// Streaming responses must not be cached at the edge.
export const dynamic = 'force-dynamic';
// Keep us on Node — the Anthropic SDK uses Node globals (Buffer, streams).
export const runtime = 'nodejs';

const BodySchema = z.object({
  message: z.string().trim().min(1, 'Message is empty').max(4000),
});

// Multipart upload limits (TASK-302e).
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB hard ceiling
const OCR_MAX_BYTES = 8 * 1024 * 1024; // 8MB practical ceiling for Claude vision
const OCR_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp'];
// CSV surface (TASK-302f) — admins drop bulk-import CSVs onto the
// assistant + get routed to the /admin/import preview. Excel exports a
// CSV as `application/vnd.ms-excel` sometimes, and browsers occasionally
// mis-detect .csv as `text/plain`; accept the whole family, per-kind
// capability gating happens downstream in dispatchBulkCsv.
const CSV_MIMES = [
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'text/plain',
];
const ALLOWED_MIMES = [...OCR_MIMES, ...CSV_MIMES];

function isCsvUpload(mimeType: string, filename: string): boolean {
  if (CSV_MIMES.includes(mimeType)) return true;
  return filename.toLowerCase().endsWith('.csv');
}

type AttachmentSummary = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Human-readable summary line, e.g. "Officeworks $48.50 2026-06-05 (conf 92%)". */
  summary: string;
  /** Parsed fields when OCR succeeded; null when extractor returned ok:false. */
  fields?: {
    vendor: string | null;
    amountDollars: number | null;
    gstDollars: number | null;
    dateIso: string | null;
    invoiceNumber: string | null;
    confidence: number;
    suggestedCategory: string | null;
  };
};

/**
 * POST /api/assistant/chat — accepts either:
 *
 *   - application/json: `{ message }` (legacy path)
 *   - multipart/form-data: text field `message` + optional file field
 *     `attachment`. The attachment is OCR'd via extractIntakeFields and
 *     the extracted fields are inlined into the user message Claude
 *     sees + streamed back as a dedicated SSE event so the widget can
 *     show "📎 receipt.pdf · ✓ Officeworks $48.50".
 *
 * SSE event shapes streamed back:
 *   { kind: 'meta', threadId }
 *   { kind: 'attachment_extracted', filename, mimeType, sizeBytes,
 *     summary, fields? }
 *   { kind: 'text', text }
 *   { kind: 'tool_call' | 'tool_result' | 'prefill_card' | 'error' }
 *   { kind: 'done', finalText }
 */
export async function POST(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // Rate-limit per person.
  const limit = checkAssistantRateLimit(session.person.id);
  if (limit) {
    return NextResponse.json(
      {
        error: 'rate_limited',
        message: `You've hit the assistant rate limit (100 messages / hour). Try again in ${limit.retryAfterSeconds}s.`,
      },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  // Parse body — multipart for file uploads, JSON otherwise.
  const contentType = req.headers.get('content-type') ?? '';
  let userMessage: string;
  let attachment: { name: string; mimeType: string; size: number; bytes: Buffer } | null = null;

  if (contentType.startsWith('multipart/form-data')) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: 'invalid_multipart' }, { status: 400 });
    }
    const rawMsg = form.get('message');
    const messageText =
      typeof rawMsg === 'string' && rawMsg.trim().length > 0
        ? rawMsg
        // Empty message + an attachment is fine — synthesise a placeholder so
        // the chat loop still has SOMETHING to anchor on.
        : 'I dropped a receipt — log it for me.';
    const parsed = BodySchema.safeParse({ message: messageText });
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_body', message: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }
    userMessage = parsed.data.message;

    const file = form.get('attachment');
    if (file instanceof File) {
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          {
            error: 'file_too_large',
            message: `Files must be ≤ ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB.`,
          },
          { status: 413 },
        );
      }
      if (!ALLOWED_MIMES.includes(file.type)) {
        return NextResponse.json(
          {
            error: 'unsupported_file_type',
            message: `Only ${ALLOWED_MIMES.join(', ')} are supported.`,
          },
          { status: 415 },
        );
      }
      const ab = await file.arrayBuffer();
      attachment = {
        name: file.name || 'attachment',
        mimeType: file.type,
        size: file.size,
        bytes: Buffer.from(ab),
      };
    }
  } else {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_body', message: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }
    userMessage = parsed.data.message;
  }

  // Active thread + existing history.
  const thread = await getOrCreateActiveThread(session.person.id);
  if (thread.turnCount >= ASSISTANT_MAX_TURNS) {
    return NextResponse.json(
      {
        error: 'thread_full',
        message: `This conversation hit the ${ASSISTANT_MAX_TURNS}-turn cap. Hit the reset button to start a fresh thread.`,
      },
      { status: 409 },
    );
  }

  const history = await listThreadMessages(thread.id);

  // Process the attachment BEFORE we persist + stream so the
  // extracted fields (or bulk-CSV dispatch result) can join the user
  // message Claude sees. Two branches:
  //   - CSVs (TASK-302f) → dispatchBulkCsv → prefill card for the
  //     admin-import preview URL
  //   - PDFs / images (TASK-302e) → extractIntakeFields → prefill_expense
  //     or prefill_bill via the model's tool loop
  let attachmentSummary: AttachmentSummary | null = null;
  let bulkPrefillCard:
    | { surface: string; url: string; summary: string }
    | null = null;
  let composedUserMessage = userMessage;
  if (attachment) {
    if (isCsvUpload(attachment.mimeType, attachment.name)) {
      // ── CSV path (TASK-302f) ────────────────────────────────────────
      const csvText = attachment.bytes.toString('utf8');
      const result = await dispatchBulkCsv({
        session,
        csvText,
        fileName: attachment.name,
      });
      if (result.ok) {
        attachmentSummary = {
          filename: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.size,
          summary: result.summary,
        };
        bulkPrefillCard = {
          surface: `bulk_${result.kind}`,
          url: result.url,
          summary: result.summary,
        };
      } else {
        attachmentSummary = {
          filename: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.size,
          summary: `CSV parse failed: ${result.error}`,
        };
      }
    } else if (attachment.size > OCR_MAX_BYTES) {
      attachmentSummary = {
        filename: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.size,
        summary: 'Too large to OCR — skipped extraction.',
      };
    } else {
      const extraction = await extractIntakeFields({
        base64: attachment.bytes.toString('base64'),
        mimeType: attachment.mimeType,
        fileName: attachment.name,
      });
      if (extraction.ok) {
        const e = extraction.data;
        const parts: string[] = [];
        if (e.supplierName) parts.push(e.supplierName);
        if (e.amountTotalDollars !== null)
          parts.push(`$${e.amountTotalDollars.toFixed(2)}`);
        if (e.issueDate) parts.push(e.issueDate);
        parts.push(`conf ${e.confidence.overall}%`);
        attachmentSummary = {
          filename: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.size,
          summary: parts.join(' · '),
          fields: {
            vendor: e.supplierName,
            amountDollars: e.amountTotalDollars,
            gstDollars: e.gstDollars,
            dateIso: e.issueDate,
            invoiceNumber: e.invoiceNumber,
            confidence: e.confidence.overall,
            suggestedCategory: e.category,
          },
        };
      } else {
        attachmentSummary = {
          filename: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.size,
          summary: `OCR failed: ${extraction.reason}`,
        };
      }
    }
    // Inline the extraction so Claude has structured context in the
    // user message itself (history rehydration on later turns picks
    // this up too).
    const contextBlock = bulkPrefillCard
      ? `bulk-import: ${bulkPrefillCard.surface} · preview URL prepped (widget will render the button)`
      : `extraction: ${attachmentSummary.fields ? JSON.stringify(attachmentSummary.fields) : '(extraction failed)'}`;
    composedUserMessage = `[attached file: ${attachment.name} · ${attachment.mimeType} · ${attachmentSummary.summary}]
${contextBlock}

${userMessage}`.trim();

    // Audit the attachment processing — paired with a redemption
    // event if a prefill tool subsequently fires.
    const auditAfter: Record<string, unknown> = {
      filename: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.size,
      summary: attachmentSummary.summary,
      confidence: attachmentSummary.fields?.confidence ?? null,
    };
    try {
      await prisma.$transaction(async (tx) => {
        await writeAudit(tx, {
          actor: { type: 'person', id: session.person.id },
          action: 'extracted',
          entity: {
            type: 'assistant_attachment',
            id: `${session.person.id}:${Date.now()}:${attachment.name}`,
            after: auditAfter,
          },
          source: 'agent',
        });
      });
    } catch (err) {
      console.error('[assistant.chat] attachment audit failed:', err);
    }
  }

  // Persist user message before streaming opens.
  await prisma.$transaction(async (tx) => {
    await appendMessage(tx, {
      threadId: thread.id,
      personId: session.person.id,
      role: 'user',
      content: composedUserMessage,
    });
  });

  const encoder = new TextEncoder();
  const sse = new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ kind: 'meta', threadId: thread.id })}\n\n`),
      );
      // Emit the attachment extraction immediately so the widget can
      // flip the file chip from "Extracting…" → "✓ <summary>".
      if (attachmentSummary) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              kind: 'attachment_extracted',
              filename: attachmentSummary.filename,
              mimeType: attachmentSummary.mimeType,
              sizeBytes: attachmentSummary.sizeBytes,
              summary: attachmentSummary.summary,
              fields: attachmentSummary.fields ?? null,
            })}\n\n`,
          ),
        );
      }
      // Bulk-CSV path (TASK-302f) — the dispatcher already built the
      // preview URL; emit a prefill_card so the widget renders the
      // "Open bulk-import preview" button alongside the assistant's text.
      // (For OCR/receipt uploads the prefill_card comes from the
      // model's prefill_* tool call further down the stream.)
      if (bulkPrefillCard) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              kind: 'prefill_card',
              surface: bulkPrefillCard.surface,
              url: bulkPrefillCard.url,
              summary: bulkPrefillCard.summary,
            })}\n\n`,
          ),
        );
      }

      let finalText = '';
      try {
        for await (const chunk of streamAssistantReply({
          session,
          history,
          newUserMessage: composedUserMessage,
        })) {
          if (chunk.kind === 'done') {
            finalText = chunk.finalText;
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
      } catch (err) {
        console.error('[assistant.chat] stream failed:', err);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              kind: 'error',
              message: 'Stream failed. Try again.',
            })}\n\n`,
          ),
        );
      } finally {
        controller.close();
        if (finalText.trim().length > 0) {
          try {
            await prisma.$transaction(async (tx) => {
              await appendMessage(tx, {
                threadId: thread.id,
                personId: session.person.id,
                role: 'assistant',
                content: finalText,
              });
            });
          } catch (err) {
            console.error('[assistant.chat] persist reply failed:', err);
          }
        }
        await maybeArchiveIfFull(thread.id, session.person.id);
      }
    },
  });

  return new Response(sse, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
