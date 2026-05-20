#!/usr/bin/env node
/**
 * Pass 2: convert categorical info colors (blue-*, purple-*, yellow-*,
 * orange-*) to brand tokens. Same scope/skip rules as brand-sweep.mjs.
 */
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

const SKIP = new Set([
  'components/chat-area.tsx',
  'components/sidebar.tsx',
  // chatbot-config preview mimics WhatsApp — colors stay native.
]);

const INCLUDE_DIRS = ['app/(auth)', 'app/(public)', 'components', 'app/not-found.tsx'];

// Order: more specific (with-prefix) wins where ambiguous.
const SWAPS = [
  // Info-blue tints → brand-cyan on brand-blue (most readable on dark).
  [/\bbg-blue-50\b/g, 'bg-brand-blue/10'],
  [/\bbg-blue-100\b/g, 'bg-brand-blue/15'],
  [/\bbg-blue-500\b/g, 'bg-brand-blue'],
  [/\btext-blue-400\b/g, 'text-brand-cyan/70'],
  [/\btext-blue-500\b/g, 'text-brand-cyan'],
  [/\btext-blue-600\b/g, 'text-brand-cyan'],
  [/\btext-blue-700\b/g, 'text-brand-cyan'],
  [/\btext-blue-900\b/g, 'text-brand-cyan'],
  [/\bborder-blue-100\b/g, 'border-brand-cyan/20'],
  [/\bborder-blue-200\b/g, 'border-brand-cyan/30'],
  [/\bring-blue-200\b/g, 'ring-brand-cyan/30'],
  [/\bhover:bg-blue-100\b/g, 'hover:bg-brand-blue/20'],

  // Purple → brand-violet.
  [/\bbg-purple-100\b/g, 'bg-brand-violet/15'],
  [/\btext-purple-600\b/g, 'text-brand-violet'],
  [/\btext-purple-700\b/g, 'text-brand-violet'],
  [/\bborder-purple-200\b/g, 'border-brand-violet/30'],
  [/\bring-purple-200\b/g, 'ring-brand-violet/30'],

  // Yellow / amber → brand-amber.
  [/\bbg-yellow-50\b/g, 'bg-brand-amber/15'],
  [/\bbg-yellow-100\b/g, 'bg-brand-amber/15'],
  [/\btext-yellow-600\b/g, 'text-brand-amber'],
  [/\btext-yellow-700\b/g, 'text-brand-amber'],
  [/\bborder-yellow-200\b/g, 'border-brand-amber/30'],
  [/\bring-yellow-200\b/g, 'ring-brand-amber/30'],
  [/\bbg-amber-50\b/g, 'bg-brand-amber/15'],
  [/\btext-amber-700\b/g, 'text-brand-amber'],
  [/\bborder-amber-200\b/g, 'border-brand-amber/30'],

  // Orange → brand-amber (close enough; brand has no orange token).
  [/\bbg-orange-100\b/g, 'bg-brand-amber/15'],
  [/\bbg-orange-400\b/g, 'bg-brand-amber'],
  [/\bbg-orange-500\b/g, 'bg-brand-amber'],
  [/\btext-orange-600\b/g, 'text-brand-amber'],
  [/\bring-orange-200\b/g, 'ring-brand-amber/30'],
];

async function walk(dir) {
  const out = [];
  async function rec(p) {
    let entries;
    try { entries = await readdir(p, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(p, e.name);
      if (e.isDirectory()) {
        if (e.name === 'api') continue;
        await rec(full);
      } else if (/\.(tsx?|jsx?)$/.test(e.name)) {
        out.push(full);
      }
    }
  }
  await rec(dir);
  return out;
}

async function gather() {
  const files = new Set();
  for (const target of INCLUDE_DIRS) {
    const abs = join(ROOT, target);
    let s; try { s = await stat(abs); } catch { continue; }
    if (s.isDirectory()) (await walk(abs)).forEach((f) => files.add(f));
    else files.add(abs);
  }
  return [...files].filter((f) => !SKIP.has(relative(ROOT, f)));
}

async function processFile(file) {
  const src = await readFile(file, 'utf8');
  let out = src;
  let changes = 0;
  for (const [re, to] of SWAPS) {
    out = out.replace(re, () => { changes++; return to; });
  }
  if (out !== src) await writeFile(file, out);
  return changes;
}

const files = await gather();
let totalFiles = 0, totalEdits = 0;
for (const f of files) {
  const n = await processFile(f);
  if (n > 0) { totalFiles++; totalEdits += n; console.log(`  ${relative(ROOT, f)}  (${n} edits)`); }
}
console.log(`\n[brand-sweep-2] ${totalEdits} edits across ${totalFiles} files`);
