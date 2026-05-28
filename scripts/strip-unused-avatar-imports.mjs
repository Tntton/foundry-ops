#!/usr/bin/env node
/**
 * Strip the now-unused `import { Avatar, AvatarFallback } from
 * '@/components/ui/avatar'` lines left over after migrate-avatars.mjs.
 * Only removes the import when neither symbol appears in the rest of
 * the file — keeps it intact for files (like /me/page.tsx) that still
 * use Avatar for non-PersonAvatar reasons.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const root = '/Users/tnt/Downloads/design_handoff_foundry_ops';
const files = execSync(
  `grep -rl --include="*.tsx" --include="*.ts" "from '@/components/ui/avatar'" "${root}/src"`,
).toString().trim().split('\n');

let touched = 0;
for (const f of files) {
  let src = readFileSync(f, 'utf8');
  const importRe = /import\s+\{\s*Avatar\s*,\s*AvatarFallback\s*\}\s+from\s+'@\/components\/ui\/avatar';\n?/;
  const m = src.match(importRe);
  if (!m) continue;
  const withoutImport = src.replace(importRe, '');
  // Only strip if neither symbol is used in the remaining body.
  if (
    !/\bAvatar\b/.test(withoutImport) &&
    !/\bAvatarFallback\b/.test(withoutImport)
  ) {
    writeFileSync(f, withoutImport);
    touched += 1;
    console.log(`  ✓ ${f.replace(root + '/', '')}`);
  }
}
console.log(`\nStripped ${touched} unused Avatar/AvatarFallback imports.`);
