import { prisma } from '@/server/db';
import { startOfWeek, addDays, todayInFirmTz } from '@/lib/week';
import type { ToolDefinition } from './types';

export const getMyHoursThisWeek: ToolDefinition = {
  spec: {
    name: 'get_my_hours_this_week',
    description:
      "Return the current user's timesheet hours for the current Monday-Sunday week — per-project breakdown plus a total. Includes draft and submitted entries (draft = saved, not yet submitted for approval). Use this when the user asks 'what have I logged' or before suggesting prefill values for further entries.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  async run(ctx) {
    const personId = ctx.session.person.id;
    const monday = startOfWeek(todayInFirmTz());
    const sunday = addDays(monday, 7);
    const entries = await prisma.timesheetEntry.findMany({
      where: { personId, date: { gte: monday, lt: sunday } },
      select: {
        date: true,
        hours: true,
        status: true,
        description: true,
        project: { select: { code: true, name: true } },
      },
    });
    const byProject = new Map<
      string,
      { projectCode: string; projectName: string; hours: number; entries: number }
    >();
    let total = 0;
    let draftCount = 0;
    for (const e of entries) {
      const h = Number(e.hours);
      total += h;
      if (e.status === 'draft') draftCount += 1;
      const key = e.project.code;
      const row =
        byProject.get(key) ?? {
          projectCode: e.project.code,
          projectName: e.project.name,
          hours: 0,
          entries: 0,
        };
      row.hours += h;
      row.entries += 1;
      byProject.set(key, row);
    }
    return {
      weekStartIso: monday.toISOString().slice(0, 10),
      totalHours: Number(total.toFixed(2)),
      entryCount: entries.length,
      draftCount,
      byProject: Array.from(byProject.values()).map((r) => ({
        ...r,
        hours: Number(r.hours.toFixed(2)),
      })),
    };
  },
};
