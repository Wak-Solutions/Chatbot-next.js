#!/usr/bin/env node
// Pass 3: catch remaining bare gray indicators (dots, progress bars,
// thin separators) the earlier passes missed because the patterns
// (bg-gray-300, bg-gray-400, border-gray-50) weren't on the list.
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const SKIP = new Set(['components/chat-area.tsx', 'components/sidebar.tsx']);
const INCLUDE_DIRS = ['app/(auth)', 'app/(public)', 'components', 'app/not-found.tsx'];

const SWAPS = [
  [/\bbg-gray-300\b/g, 'bg-white/[0.10]'],
  [/\bbg-gray-300\/40\b/g, 'bg-white/[0.05]'],
  [/\bbg-gray-300\/50\b/g, 'bg-white/[0.06]'],
  [/\bbg-gray-400\b/g, 'bg-brand-slate'],
  [/\bborder-gray-50\b/g, 'border-white/[0.04]'],
  [/\bborder-gray-400\b/g, 'border-white/[0.10]'],
  [/\bring-gray-200\b/g, 'ring-white/[0.10]'],
  // Red semantic colors: leave bg-red-500 (destructive) but fold the
  // common pink-tinted bg-red-50 to a brand-aware translucent variant
  // for consistency on dark.
  [/\bbg-red-50\b/g, 'bg-red-500/10'],
  [/\bborder-red-200\b/g, 'border-red-500/30'],
  [/\btext-red-600\b/g, 'text-red-400'],
  [/\btext-red-700\b/g, 'text-red-400'],
  [/\btext-red-500\b/g, 'text-red-400'],
];

async function walk(dir) {
  const out = [];
  async function rec(p) {
    let entries; try { entries = await readdir(p, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(p, e.name);
      if (e.isDirectory()) { if (e.name === 'api') continue; await rec(full); }
      else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(full);
    }
  }
  await rec(dir);
  return out;
}

const files = new Set();
for (const target of INCLUDE_DIRS) {
  const abs = join(ROOT, target);
  let s; try { s = await stat(abs); } catch { continue; }
  if (s.isDirectory()) (await walk(abs)).forEach((f) => files.add(f));
  else files.add(abs);
}

let totalFiles = 0, totalEdits = 0;
for (const f of files) {
  if (SKIP.has(relative(ROOT, f))) continue;
  const src = await readFile(f, 'utf8');
  let out = src; let n = 0;
  for (const [re, to] of SWAPS) out = out.replace(re, () => { n++; return to; });
  if (out !== src) { await writeFile(f, out); totalFiles++; totalEdits += n; console.log(`  ${relative(ROOT, f)}  (${n} edits)`); }
}
console.log(`\n[brand-sweep-3] ${totalEdits} edits across ${totalFiles} files`);
