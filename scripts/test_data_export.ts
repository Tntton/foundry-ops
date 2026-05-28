import { writeFileSync } from 'node:fs';
import { generateDataExport } from '@/server/exports/data-export';

async function main() {
  console.log('Generating export …');
  const t0 = Date.now();
  const { manifest, buffer } = await generateDataExport();
  const t1 = Date.now();
  console.log(`Generated in ${(t1 - t0) / 1000}s`);
  console.log(`\nManifest:`);
  console.log(`  filename: ${manifest.filename}`);
  console.log(`  size: ${(manifest.sizeBytes / 1024).toFixed(1)} KB`);
  console.log(`  generated: ${manifest.generatedAt}`);
  console.log(`\nTable counts:`);
  for (const [file, count] of Object.entries(manifest.tableCounts)) {
    console.log(`  ${file.padEnd(36)} ${count} rows`);
  }
  const path = `/tmp/${manifest.filename}`;
  writeFileSync(path, buffer);
  console.log(`\nWritten to: ${path}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
