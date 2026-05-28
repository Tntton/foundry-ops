'use server';

import { revalidatePath } from 'next/cache';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';
import { emitUserUpdate } from '@/server/user-updates';

export type CvExtractState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'preview';
      education: Array<{
        institution: string;
        degree: string | null;
        field: string | null;
        startYear: string | null;
        endYear: string | null;
        notes: string | null;
      }>;
      work: Array<{
        company: string;
        title: string | null;
        location: string | null;
        startYear: string | null;
        endYear: string | null;
        current: boolean;
        description: string | null;
      }>;
    }
  | { status: 'committed'; education: number; work: number };

const ExtractionSchema = z.object({
  education: z
    .array(
      z.object({
        institution: z.string().trim().min(1).max(200),
        degree: z.string().trim().max(200).nullable().optional(),
        field: z.string().trim().max(200).nullable().optional(),
        startYear: z.string().trim().max(20).nullable().optional(),
        endYear: z.string().trim().max(20).nullable().optional(),
        notes: z.string().trim().max(1000).nullable().optional(),
      }),
    )
    .max(20),
  work: z
    .array(
      z.object({
        company: z.string().trim().min(1).max(200),
        title: z.string().trim().max(200).nullable().optional(),
        location: z.string().trim().max(200).nullable().optional(),
        startYear: z.string().trim().max(20).nullable().optional(),
        endYear: z.string().trim().max(20).nullable().optional(),
        current: z.boolean().default(false),
        description: z.string().trim().max(2000).nullable().optional(),
      }),
    )
    .max(40),
});

const EXTRACTION_PROMPT = `You are extracting structured data from a CV / résumé PDF.

Return ONLY a JSON object matching this exact shape (no surrounding prose, no markdown):

{
  "education": [
    {
      "institution": "string (required)",
      "degree": "string or null (e.g. 'BSc', 'MBBS', 'MBA')",
      "field": "string or null (e.g. 'Computer Science', 'Medicine')",
      "startYear": "string or null (year as text, e.g. '2014')",
      "endYear": "string or null (year, or 'present')",
      "notes": "string or null (honours, GPA, key achievements)"
    }
  ],
  "work": [
    {
      "company": "string (required)",
      "title": "string or null",
      "location": "string or null (city, country)",
      "startYear": "string or null",
      "endYear": "string or null",
      "current": true if this is the current role else false,
      "description": "string or null (brief summary, max 2 sentences)"
    }
  ]
}

Rules:
- Years as strings (e.g. "2018"), not numbers.
- Sort education most-recent first, work most-recent first.
- Skip irrelevant sections (skills, hobbies, references).
- If something is unclear, return null rather than guessing.
- Return a valid JSON object even if fields are missing.`;

/**
 * Auth gate — same as inline-actions: self-edit allowed, plus
 * super_admin / admin / partner.
 */
async function gatePerson(personId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, message: 'Not signed in' };
  const isSelf = personId === session.person.id;
  const canActOnBehalf = hasAnyRole(session, [
    'super_admin',
    'admin',
    'partner',
  ]);
  if (!isSelf && !canActOnBehalf) {
    return { ok: false as const, message: 'Not authorized' };
  }
  return { ok: true as const, session };
}

/**
 * Extract education + work history from an uploaded CV using Claude.
 * Doesn't write to the DB — returns the parsed payload for the user to
 * preview / tweak / commit via `commitCvExtraction`. Saves a network
 * round-trip on edits since the user can adjust before persisting.
 *
 * Accepts PDF only for now (Claude's document content block reads PDFs
 * natively). DOCX support can be added later via a server-side
 * conversion step.
 */
export async function extractCv(
  personId: string,
  _prev: CvExtractState,
  formData: FormData,
): Promise<CvExtractState> {
  const gated = await gatePerson(personId);
  if (!gated.ok) return { status: 'error', message: gated.message };

  const file = formData.get('cvFile');
  if (!(file instanceof File)) {
    return { status: 'error', message: 'No CV file uploaded.' };
  }
  if (file.size === 0) {
    return { status: 'error', message: 'Uploaded file is empty.' };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { status: 'error', message: 'CV must be under 10 MB.' };
  }
  if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
    return {
      status: 'error',
      message: 'Only PDF CVs are supported right now.',
    };
  }

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    return {
      status: 'error',
      message:
        'CV extraction is not configured (ANTHROPIC_API_KEY missing). Set it in env to enable.',
    };
  }

  let extracted: z.infer<typeof ExtractionSchema>;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: buffer.toString('base64'),
              },
            },
            {
              type: 'text',
              text: EXTRACTION_PROMPT,
            },
          ],
        },
      ],
    });
    const block = response.content.find((c) => c.type === 'text');
    const raw = block && 'text' in block ? block.text : '';
    // Some models wrap the JSON in markdown fences — strip if present.
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const parsedJson = JSON.parse(cleaned);
    const validated = ExtractionSchema.safeParse(parsedJson);
    if (!validated.success) {
      console.error(
        '[cv.extract] schema mismatch:',
        validated.error.issues,
      );
      return {
        status: 'error',
        message:
          'CV parsed but the data didn\'t match the expected shape — try a different file.',
      };
    }
    extracted = validated.data;
  } catch (err) {
    console.error('[cv.extract] failed:', err);
    return {
      status: 'error',
      message:
        'Could not extract CV. Check the file is a readable PDF and try again.',
    };
  }

  return {
    status: 'preview',
    education: extracted.education.map((e) => ({
      institution: e.institution,
      degree: e.degree ?? null,
      field: e.field ?? null,
      startYear: e.startYear ?? null,
      endYear: e.endYear ?? null,
      notes: e.notes ?? null,
    })),
    work: extracted.work.map((w) => ({
      company: w.company,
      title: w.title ?? null,
      location: w.location ?? null,
      startYear: w.startYear ?? null,
      endYear: w.endYear ?? null,
      current: w.current ?? false,
      description: w.description ?? null,
    })),
  };
}

const CommitSchema = z.object({
  education: z.array(
    z.object({
      institution: z.string().trim().min(1).max(200),
      degree: z.string().trim().max(200).nullable(),
      field: z.string().trim().max(200).nullable(),
      startYear: z.string().trim().max(20).nullable(),
      endYear: z.string().trim().max(20).nullable(),
      notes: z.string().trim().max(1000).nullable(),
    }),
  ),
  work: z.array(
    z.object({
      company: z.string().trim().min(1).max(200),
      title: z.string().trim().max(200).nullable(),
      location: z.string().trim().max(200).nullable(),
      startYear: z.string().trim().max(20).nullable(),
      endYear: z.string().trim().max(20).nullable(),
      current: z.boolean(),
      description: z.string().trim().max(2000).nullable(),
    }),
  ),
});

/**
 * Commit a previewed CV extraction to the DB. Replace-by-position:
 * existing entries are deleted and the previewed set written fresh.
 * Audited.
 */
export async function commitCvExtraction(
  personId: string,
  payload: z.infer<typeof CommitSchema>,
): Promise<{ ok: boolean; message?: string }> {
  const gated = await gatePerson(personId);
  if (!gated.ok) return { ok: false, message: gated.message };

  const validated = CommitSchema.safeParse(payload);
  if (!validated.success) {
    return {
      ok: false,
      message: validated.error.issues[0]?.message ?? 'Invalid payload',
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Replace strategy — keeps the audit clean and avoids orphans.
      await tx.educationEntry.deleteMany({ where: { personId } });
      await tx.workHistoryEntry.deleteMany({ where: { personId } });
      for (let i = 0; i < validated.data.education.length; i += 1) {
        const e = validated.data.education[i]!;
        await tx.educationEntry.create({
          data: {
            personId,
            institution: e.institution,
            degree: e.degree,
            field: e.field,
            startYear: e.startYear,
            endYear: e.endYear,
            notes: e.notes,
            sortOrder: i,
          },
        });
      }
      for (let i = 0; i < validated.data.work.length; i += 1) {
        const w = validated.data.work[i]!;
        await tx.workHistoryEntry.create({
          data: {
            personId,
            company: w.company,
            title: w.title,
            location: w.location,
            startYear: w.startYear,
            endYear: w.endYear,
            current: w.current,
            description: w.description,
            sortOrder: i,
          },
        });
      }
      await writeAudit(tx, {
        actor: { type: 'person', id: gated.session.person.id },
        action: 'updated',
        entity: {
          type: 'person',
          id: personId,
          after: {
            via: 'cv_extraction_commit',
            educationCount: validated.data.education.length,
            workCount: validated.data.work.length,
          },
        },
        source: 'web',
      });

      // Per-person feed: notify the target when an admin-on-behalf
      // commits a CV parse against their profile. Self-edit (most
      // common case — staff parse their own CV) skipped.
      if (personId !== gated.session.person.id) {
        await emitUserUpdate(tx, {
          personId,
          kind: 'cv_extracted',
          title: 'Your CV was parsed and committed',
          body: `${validated.data.education.length} education entries · ${validated.data.work.length} roles`,
          href: `/directory/people/${personId}`,
          entityType: 'person',
          entityId: personId,
        });
      }
    });
  } catch (err) {
    console.error('[cv.commit] failed:', err);
    return { ok: false, message: 'Save failed — try again.' };
  }

  revalidatePath(`/directory/people/${personId}`);
  return { ok: true };
}
