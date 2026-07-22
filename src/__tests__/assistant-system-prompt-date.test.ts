import { describe, it, expect } from 'vitest';
import type { Role } from '@prisma/client';
import type { Session } from '@/server/roles';
import { buildSystemPrompt } from '@/server/agents/assistant/system-prompt';
import { todayInFirmTz, formatIsoDate } from '@/lib/week';

const mkSession = (roles: Role[]): Session => ({
  person: {
    id: 'p1',
    email: 'x@foundry.health',
    firstName: 'Pat',
    lastName: 'Tester',
    initials: 'PT',
    roles,
    headshotUrl: null,
    band: 'Consultant',
  },
  isRealSuperAdmin: roles.includes('super_admin'),
  viewAsRoles: null,
});

// Regression: the assistant used to omit the current date from its system
// prompt, so the model resolved "last week" against its training-era
// default (~Jan 2025) and prefilled timesheet entries in the wrong year.
describe('assistant system prompt — current date anchor', () => {
  it("embeds today's real firm-timezone date", () => {
    const prompt = buildSystemPrompt(mkSession(['staff']));
    const todayIso = formatIsoDate(todayInFirmTz());
    expect(prompt).toContain('# Today');
    expect(prompt).toContain(todayIso);
  });

  it('does not hardcode a stale year', () => {
    const prompt = buildSystemPrompt(mkSession(['staff']));
    const currentYear = String(todayInFirmTz().getUTCFullYear());
    // The date line must carry the current year, not a fixed 2025 anchor.
    const todayLineHasYear = new RegExp(`Today is [^\\n]*${currentYear}`).test(prompt);
    expect(todayLineHasYear).toBe(true);
  });
});
