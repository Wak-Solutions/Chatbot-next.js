/**
 * scripts/check-no-inline-ddl.ts — CI grep gate.
 *
 * Fails the build if any inline `CREATE TABLE` or `ALTER TABLE … ADD
 * COLUMN` statement appears in lib/, app/, worker/, or scripts/.
 *
 * After PR 14 ships, schema changes go EXCLUSIVELY through Drizzle:
 *   1. Edit lib/db/schema.ts.
 *   2. npx drizzle-kit generate.
 *   3. Commit lib/db/schema.ts + drizzle/NNNN_*.sql + drizzle/meta/.
 *   4. Railway predeploy applies the migration on the next deploy.
 *
 * Inline DDL bypasses the journal and would re-introduce the "schema
 * lives in N places" problem that motivated this whole migration. This
 * script is the policy fence.
 *
 * The old tree (server/, Chatbot/) is intentionally NOT scanned. Both
 * still contain CREATE TABLE statements (server/index.ts, server/agents.ts,
 * server/surveys.ts, etc.) that are no longer in the production boot
 * path after PR 11+. PR 15 deletes those trees.
 *
 * Excludes:
 *   - scripts/mark-baseline.ts (legitimately bootstraps the drizzle
 *     migrations metadata table; this is the only allowed inline DDL).
 *   - scripts/check-no-inline-ddl.ts (this file — contains the pattern
 *     itself as a regex string).
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOTS = ['lib', 'app', 'worker', 'scripts'];

const EXCLUDE_FILES: ReadonlySet<string> = new Set([
  'scripts/mark-baseline.ts',
  'scripts/check-no-inline-ddl.ts',
]);

const FILE_EXTS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|sh)$/;

// Matches:
//   CREATE TABLE   (with optional IF NOT EXISTS / OR REPLACE between words)
//   ALTER TABLE <name> ADD COLUMN
const DDL_PATTERN = /CREATE\s+TABLE|ALTER\s+TABLE[\s\S]{0,200}?ADD\s+COLUMN/i;

// Skip lines that are clearly comments. Descriptive prose mentioning
// "CREATE TABLE" in a JSDoc header is not executable DDL — only flag
// actual SQL strings / template literals in code paths.
//   //  → JS/TS line comment
//   *   → JSDoc continuation ("  * description") or empty " * "
//   /*  → block comment open
//   */  → block comment close
//   #   → shell comment
//   --  → SQL line comment
const COMMENT_LINE_PATTERN = /^\s*(\/\/|\*\/?|\/\*|#|--)/;

interface Hit {
  file: string;
  line: number;
  text: string;
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e);
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      await walk(full, out);
    } else if (FILE_EXTS.test(full)) {
      out.push(full);
    }
  }
}

async function main(): Promise<void> {
  const hits: Hit[] = [];

  for (const root of ROOTS) {
    const files: string[] = [];
    await walk(root, files);
    for (const file of files) {
      const rel = relative(process.cwd(), file).replace(/\\/g, '/');
      if (EXCLUDE_FILES.has(rel)) continue;
      let content: string;
      try {
        content = await readFile(file, 'utf8');
      } catch {
        continue;
      }
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        if (COMMENT_LINE_PATTERN.test(line)) return;
        if (DDL_PATTERN.test(line)) {
          hits.push({ file: rel, line: i + 1, text: line.trim() });
        }
      });
    }
  }

  if (hits.length === 0) {
    console.log(
      'OK — no inline CREATE TABLE / ALTER TABLE … ADD COLUMN in lib/, app/, worker/, scripts/.',
    );
    process.exit(0);
  }

  console.error(`FAIL — inline DDL found (${hits.length} hit${hits.length === 1 ? '' : 's'}):`);
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  ${h.text}`);
  }
  console.error('');
  console.error('Schema changes must go through Drizzle:');
  console.error('  1. Edit lib/db/schema.ts');
  console.error('  2. npx drizzle-kit generate');
  console.error('  3. Commit the new drizzle/NNNN_*.sql + updated _journal.json');
  console.error('  4. The next deploy applies it via Railway predeploy.');
  process.exit(1);
}

main().catch((err) => {
  console.error('[check-no-inline-ddl] fatal:', err);
  process.exit(1);
});
