#!/usr/bin/env node
/**
 * Mechanical migration: rewrite every <Avatar><AvatarFallback>{x.initials}
 * </AvatarFallback></Avatar> site to <PersonAvatar … /> so headshotUrl
 * propagates uniformly. Skips the avatar primitive itself + the topbar
 * UserMenu (which has its own custom render). Falls back gracefully —
 * Radix's AvatarImage auto-defaults to AvatarFallback when src is null
 * or fails to load.
 *
 * Run via: node scripts/migrate-avatars.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const SKIP = [
  'components/ui/avatar.tsx',
  'components/person-avatar.tsx',
  'components/shell/user-menu.tsx',
  'components/headshot-cropper.tsx',
  'components/headshot-edit-button.tsx',
];

const root = '/Users/tnt/Downloads/design_handoff_foundry_ops';
const grepOut = execSync(
  `grep -rl --include="*.tsx" --include="*.ts" "AvatarFallback" "${root}/src"`,
).toString();
const files = grepOut.trim().split('\n').filter((f) => {
  return !SKIP.some((s) => f.includes(s));
});

// Match an Avatar block — flexible whitespace, single- or multi-line.
// Captures: avatarClassName attr (or empty), fallbackClassName attr,
// the expression before `.initials`.
//
// Pattern handles both:
//   <Avatar className="…"><AvatarFallback className="…">{x.initials}</AvatarFallback></Avatar>
// and the multi-line variant.
const RE = /<Avatar(\s+className=\{?"[^"]*"\}?)?\s*>\s*<AvatarFallback(\s+className=\{?"[^"]*"\}?)?\s*>\s*\{([^}]+?)\.initials\}\s*<\/AvatarFallback>\s*<\/Avatar>/gms;

let totalReplacements = 0;
let filesTouched = 0;

for (const file of files) {
  let src = readFileSync(file, 'utf8');
  let count = 0;
  src = src.replace(RE, (match, avatarAttr, fbAttr, exprRaw) => {
    const expr = exprRaw.trim();
    count += 1;
    const lines = ['<PersonAvatar'];
    if (avatarAttr) lines.push(`  ${avatarAttr.trim()}`);
    if (fbAttr) {
      // Rename `className=…` → `fallbackClassName=…`.
      const renamed = fbAttr.trim().replace(/^className=/, 'fallbackClassName=');
      lines.push(`  ${renamed}`);
    }
    lines.push(`  initials={${expr}.initials}`);
    lines.push(`  headshotUrl={${expr}.headshotUrl}`);
    lines.push('/>');
    return lines.join('\n');
  });

  if (count === 0) continue;

  // Ensure the PersonAvatar import is present. Try to drop it next to
  // the existing avatar import if there is one; otherwise prepend at top.
  if (!src.includes("'@/components/person-avatar'")) {
    if (src.match(/import\s+\{[^}]*\}\s+from\s+'@\/components\/ui\/avatar';/)) {
      src = src.replace(
        /(import\s+\{[^}]*\}\s+from\s+'@\/components\/ui\/avatar';)/,
        `$1\nimport { PersonAvatar } from '@/components/person-avatar';`,
      );
    } else {
      // No existing avatar import — drop a new one after the last existing
      // import line.
      const importMatches = [...src.matchAll(/^import\s.+?from\s.+?;$/gm)];
      if (importMatches.length > 0) {
        const lastImport = importMatches[importMatches.length - 1];
        const insertAt = lastImport.index + lastImport[0].length;
        src =
          src.slice(0, insertAt) +
          `\nimport { PersonAvatar } from '@/components/person-avatar';` +
          src.slice(insertAt);
      } else {
        src = `import { PersonAvatar } from '@/components/person-avatar';\n${src}`;
      }
    }
  }

  writeFileSync(file, src);
  totalReplacements += count;
  filesTouched += 1;
  console.log(`  ✓ ${file.replace(root + '/', '')} (${count})`);
}

console.log(
  `\nDone — ${totalReplacements} replacements across ${filesTouched} files.`,
);
