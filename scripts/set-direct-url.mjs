/**
 * Fill DIRECT_URL in .env.local from the DATABASE_URL already there.
 *
 * Prisma needs a non-transaction-pooled connection for `migrate deploy` —
 * DDL can't run through pgbouncer in transaction mode (port 6543). Three
 * URLs, one password, differing only in host / port / username shape:
 *
 *   transaction  postgres.<ref>@aws-0-<region>.pooler.supabase.com:6543  ?pgbouncer=true
 *   session      postgres.<ref>@aws-0-<region>.pooler.supabase.com:5432
 *   direct       postgres@db.<ref>.supabase.co:5432
 *
 * Default is `session`, because Supabase stopped provisioning the `db.<ref>`
 * direct hostname on newer projects — it resolves to nothing at all, and
 * `migrate` fails P1001. Session mode is a real Postgres session, so DDL
 * and advisory locks work exactly as they do on a direct connection.
 *
 * Pass --direct to force the old-style direct host instead.
 *
 * Prints nothing sensitive.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const PATH = '.env.local';
if (!existsSync(PATH)) {
  console.error('No .env.local here — run this from the repo root.');
  process.exit(1);
}

const lines = readFileSync(PATH, 'utf8').split('\n');
const dbLine = lines.find((l) => l.startsWith('DATABASE_URL='));
if (!dbLine) {
  console.error('No DATABASE_URL in .env.local — nothing to derive from.');
  process.exit(1);
}

const raw = dbLine.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '');
const u = new URL(raw);
const user = decodeURIComponent(u.username);
if (!user.includes('.')) {
  console.error(
    `DATABASE_URL username is "${user.split('.')[0]}…" — expected "postgres.<project-ref>".\n` +
      'That looks like a direct URL already, not a pooler one. Copy it to DIRECT_URL by hand.',
  );
  process.exit(1);
}
const ref = user.slice(user.indexOf('.') + 1);
const wantDirect = process.argv.includes('--direct');

// Session pooler: same host as DATABASE_URL, port 5432, same `postgres.<ref>`
// username, and crucially NO ?pgbouncer=true — that flag is what puts the
// connection in transaction mode and breaks migrations.
const host = wantDirect ? `db.${ref}.supabase.co` : u.hostname;
const dbUser = wantDirect ? 'postgres' : user;
const direct = `postgresql://${encodeURIComponent(dbUser)}:${u.password}@${host}:5432/postgres`;

const backup = `${PATH}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
copyFileSync(PATH, backup);

let found = false;
const out = lines.map((l) => {
  if (!l.startsWith('DIRECT_URL=')) return l;
  found = true;
  return `DIRECT_URL="${direct}"`;
});
if (!found) out.push(`DIRECT_URL="${direct}"`);

writeFileSync(PATH, out.join('\n'));
console.log(`Backed up  -> ${backup}`);
console.log(
  `DIRECT_URL -> ${host}:5432  (${wantDirect ? 'direct' : 'session pooler'}, password reused from DATABASE_URL)`,
);
if (!wantDirect) {
  console.log('\nUsing the session pooler: Supabase no longer provisions db.<ref>.supabase.co');
  console.log('on newer projects, so the direct host fails with P1001. Session mode is a real');
  console.log('Postgres session — DDL and migration advisory locks work normally.');
  console.log('Re-run with --direct if you specifically need the direct host.');
}
