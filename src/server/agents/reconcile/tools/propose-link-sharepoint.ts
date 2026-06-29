import { z } from 'zod';
import { prisma } from '@/server/db';
import { signPrefillToken } from '@/server/agents/assistant/prefill/token';
import { discoverProjectFolders } from '@/server/integrations/sharepoint';
import type { ToolDefinition } from './types';

/**
 * Propose linking a project to its existing SharePoint folder(s) on
 * the team site. The reconcile agent reaches for this when find_gaps
 * surfaces a project with `sharepointFolderUrl: null` — instead of
 * the user pasting the URL manually, Graph looks up the folder by
 * the expected naming convention and proposes the discovered URL.
 *
 * Read-only on Graph — never creates a folder. If the folder doesn't
 * exist, the tool returns no_op with a note steering the user to use
 * the standard "provision" flow on /projects/[code]/settings (which
 * DOES create the folder tree).
 */
const InputSchema = z.object({
  projectRef: z.string().min(1),
});

export const proposeLinkSharepointFolder: ToolDefinition = {
  spec: {
    name: 'propose_link_sharepoint_folder',
    description:
      'Look up the existing SharePoint folder for a project (by client code + project code) and propose linking it. Read-only — never creates a folder. Use this when find_gaps shows a project is missing sharepointFolderUrl but the folder likely exists on the team site.',
    input_schema: {
      type: 'object',
      required: ['projectRef'],
      properties: {
        projectRef: {
          type: 'string',
          description: 'Project code (e.g. "CAC001") or project id (CUID).',
        },
      },
    },
  },
  async run(ctx, input) {
    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: `invalid_input: ${parsed.error.issues[0]?.message ?? 'bad shape'}` };
    }
    const { projectRef } = parsed.data;
    const project = await prisma.project.findFirst({
      where: { OR: [{ code: projectRef }, { id: projectRef }] },
      include: { client: { select: { code: true, legalName: true } } },
    });
    if (!project) {
      return { error: `project_not_found: no Project matches "${projectRef}".` };
    }
    const discovered = await discoverProjectFolders(
      project.client.code,
      project.client.legalName,
      project.code,
    );
    if (!discovered) {
      return {
        kind: 'no_op' as const,
        message:
          'SharePoint Graph isn’t configured in this environment — set SHAREPOINT_SITE_URL + credentials to enable folder discovery.',
      };
    }
    if (!discovered.anyFound) {
      return {
        kind: 'no_op' as const,
        message: `No SharePoint folder found at the expected path for ${project.code}. Use the provision button on /projects/${project.code}/settings to create the folder tree, or paste the URL manually.`,
      };
    }

    // Only propose URLs that (a) were found AND (b) differ from the
    // current value. If both are already set to the discovered URLs
    // there's nothing to do.
    const updates: { teamUrl?: string; adminUrl?: string } = {};
    if (discovered.teamUrl && discovered.teamUrl !== project.sharepointFolderUrl) {
      updates.teamUrl = discovered.teamUrl;
    }
    if (discovered.adminUrl && discovered.adminUrl !== project.sharepointAdminFolderUrl) {
      updates.adminUrl = discovered.adminUrl;
    }
    if (!updates.teamUrl && !updates.adminUrl) {
      return {
        kind: 'no_op' as const,
        message: `${project.code} is already linked to the discovered folders.`,
      };
    }

    const token = signPrefillToken({
      kind: 'reconcile_sharepoint_link',
      personId: ctx.session.person.id,
      payload: {
        projectId: project.id,
        teamUrl: updates.teamUrl ?? null,
        adminUrl: updates.adminUrl ?? null,
      },
    });
    return {
      kind: 'proposal' as const,
      surface: 'reconcile_sharepoint_link',
      token,
      title: `Link SharePoint folder${updates.teamUrl && updates.adminUrl ? 's' : ''} on ${project.code}`,
      fields: [
        { label: 'Project', value: `${project.code} — ${project.name}` },
        ...(updates.teamUrl
          ? [
              { label: 'Team folder (new)', value: updates.teamUrl },
              { label: 'Currently', value: project.sharepointFolderUrl ?? '—' },
            ]
          : []),
        ...(updates.adminUrl
          ? [
              { label: 'Admin folder (new)', value: updates.adminUrl },
              { label: 'Currently', value: project.sharepointAdminFolderUrl ?? '—' },
            ]
          : []),
      ],
      confirmLabel: 'Link folder',
      summary: `Link ${project.code} → SharePoint folder${updates.teamUrl && updates.adminUrl ? 's' : ''} found via Graph.`,
    };
  },
};
