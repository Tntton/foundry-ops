/**
 * Download the Foundry Health Master Project Tracker from TT's
 * OneDrive via Microsoft Graph (app-credentials flow). Saves the
 * workbook to `tmp/master_tracker.xlsx` so the import script can
 * consume it.
 *
 *   pnpm tsx scripts/master_tracker_pull.ts
 *
 * env required (already on the Vercel side): ENTRA_TENANT_ID,
 * ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET. The app registration must hold
 * `Files.Read.All` *application* permission with admin consent — Graph
 * refuses cross-user drive access otherwise.
 *
 * Source pointer (from the OneDrive share URL TT provided):
 *   sourcedoc UUID 0BBC781B-B6C0-47A1-B244-B7A28696F300 → driveItem id
 *   owner UPN     trung@foundry.health
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { graphRaw } from '@/server/graph';

const OWNER_UPN = 'trung@foundry.health';
const DRIVE_ITEM_ID = '0BBC781B-B6C0-47A1-B244-B7A28696F300';
const OUT_PATH = path.join(process.cwd(), 'tmp', 'master_tracker.xlsx');

async function main() {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

  const url = `/users/${encodeURIComponent(OWNER_UPN)}/drive/items/${DRIVE_ITEM_ID}/content`;
  console.log(`GET ${url}`);
  const res = await graphRaw('GET', url);
  if (!res.ok) {
    const text = await res.text();
    console.error(`Graph ${res.status}: ${text}`);
    console.error(
      '\nIf this is a 403, the app registration is missing `Files.Read.All` (Application) — admin consent required.\n' +
        'If this is a 404, double-check the sourcedoc UUID; OneDrive sometimes regenerates these when the file is moved.',
    );
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(OUT_PATH, buf);
  console.log(`saved ${buf.length} bytes → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
