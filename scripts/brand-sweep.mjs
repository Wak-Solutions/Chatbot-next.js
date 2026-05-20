#!/usr/bin/env node
/**
 * scripts/brand-sweep.mjs — one-shot mechanical class swap for the WAK
 * rebrand cleanup. Maps light-canvas Tailwind utilities (bg-white,
 * text-gray-*, border-gray-*, etc.) onto the brand dark surface tokens.
 *
 * Run once with `node scripts/brand-sweep.mjs`, then review the diff and
 * follow up with hand-edits on screens that need bespoke treatment.
 *
 * Scope:
 *   - app/(auth)/**, app/(public)/** TS/TSX files only.
 *   - SKIPS app/api/** (server email templates are out of scope), the
 *     marketing landing page app/(public)/page.tsx (hand-rewritten),
 *     and components/chat-area.tsx / components/sidebar.tsx (already
 *     hand-rewritten).
 *
 * Replacements are word-boundary aware (regex \b) so longer classnames
 * containing a substring (e.g. `bg-white/80`, `bg-gray-50`) won't be
 * accidentally caught by a shorter pattern. Color-modifier suffixes
 * like /5, /10, /20 are preserved by anchoring on the bare class.
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

const SKIP = new Set([
  'app/(public)/page.tsx',           // hand-rewritten for marketing
  'components/chat-area.tsx',         // hand-rewritten
  'components/sidebar.tsx',           // hand-rewritten
]);

const INCLUDE_DIRS = [
  'app/(auth)',
  'app/(public)',
  'components',
  'app/not-found.tsx',
];

// Ordered: longer / more specific patterns first so they win the match.
// Each entry is [regex, replacement]. The trailing (?![a-zA-Z0-9_-]) is a
// poor-man's word boundary that accepts Tailwind's `/N` opacity suffix
// (e.g. `bg-gray-50/40`) by also allowing `/` after the class.
const SWAPS = [
  // Light containers → brand surfaces.
  [/\bbg-white\/95\b/g, 'bg-brand-navy/95'],
  [/\bbg-white\/90\b/g, 'bg-brand-navy/90'],
  [/\bbg-white\/80\b/g, 'bg-brand-navy/80'],
  [/\bbg-white\/70\b/g, 'bg-brand-navy/70'],
  [/\bbg-white\/60\b/g, 'bg-brand-navy/60'],
  [/\bbg-white\/50\b/g, 'bg-brand-navy/50'],
  [/\bbg-white\/40\b/g, 'bg-brand-navy/40'],
  [/\bbg-white\/30\b/g, 'bg-brand-navy/30'],
  [/\bbg-white\/20\b/g, 'bg-brand-navy/20'],
  [/\bbg-white\/10\b/g, 'bg-brand-navy/10'],
  [/\bbg-white\b/g, 'bg-brand-navy'],

  // Hover and group-hover surfaces.
  [/\bhover:bg-white\b/g, 'hover:bg-brand-navy'],
  [/\bgroup-hover:bg-white\b/g, 'group-hover:bg-brand-navy'],
  [/\bfocus:bg-white\b/g, 'focus:bg-brand-navy'],

  // Gray surface tiers → translucent white-on-ink layers.
  [/\bbg-gray-50\b/g, 'bg-white/[0.03]'],
  [/\bbg-gray-100\b/g, 'bg-white/[0.05]'],
  [/\bbg-gray-200\b/g, 'bg-white/[0.08]'],
  [/\bbg-slate-50\b/g, 'bg-white/[0.03]'],
  [/\bbg-slate-100\b/g, 'bg-white/[0.05]'],
  [/\bhover:bg-gray-50\b/g, 'hover:bg-white/[0.05]'],
  [/\bhover:bg-gray-100\b/g, 'hover:bg-white/[0.08]'],
  [/\bhover:bg-gray-200\b/g, 'hover:bg-white/[0.10]'],
  [/\bhover:bg-slate-50\b/g, 'hover:bg-white/[0.05]'],

  // Text colors.
  [/\btext-gray-900\b/g, 'text-white'],
  [/\btext-gray-800\b/g, 'text-white'],
  [/\btext-gray-700\b/g, 'text-white/90'],
  [/\btext-gray-600\b/g, 'text-brand-slate'],
  [/\btext-gray-500\b/g, 'text-brand-slate'],
  [/\btext-gray-400\b/g, 'text-brand-slate/70'],
  [/\btext-gray-300\b/g, 'text-brand-slate/50'],
  [/\btext-black\b/g, 'text-white'],
  [/\bhover:text-gray-900\b/g, 'hover:text-white'],
  [/\bhover:text-gray-700\b/g, 'hover:text-white'],

  // Borders.
  [/\bborder-gray-100\b/g, 'border-white/[0.06]'],
  [/\bborder-gray-200\b/g, 'border-white/[0.08]'],
  [/\bborder-gray-300\b/g, 'border-white/[0.10]'],
  [/\bhover:border-gray-300\b/g, 'hover:border-white/[0.10]'],
  [/\bhover:border-gray-200\b/g, 'hover:border-white/[0.10]'],

  // Decorative + semantic green/emerald → brand-emerald token for
  // success states (online dots, success toasts, resolved badges).
  // Non-semantic decorative greens get caught here too and should be
  // hand-tweaked to brand-cyan/brand-blue when the context isn't "success."
  [/\bbg-green-50\b/g, 'bg-brand-emerald/10'],
  [/\bbg-green-100\b/g, 'bg-brand-emerald/15'],
  [/\bbg-green-500\b/g, 'bg-brand-emerald'],
  [/\bbg-green-600\b/g, 'bg-brand-emerald'],
  [/\btext-green-600\b/g, 'text-brand-emerald'],
  [/\btext-green-700\b/g, 'text-brand-emerald'],
  [/\btext-green-500\b/g, 'text-brand-emerald'],
  [/\btext-green-400\b/g, 'text-brand-emerald'],
  [/\bborder-green-200\b/g, 'border-brand-emerald/30'],
  [/\bborder-green-300\b/g, 'border-brand-emerald/40'],
  [/\bborder-green-500\b/g, 'border-brand-emerald'],

  // Same family for emerald-* arbitrary refs (none expected, but defensive).
  [/\bbg-emerald-50\b/g, 'bg-brand-emerald/10'],
  [/\btext-emerald-600\b/g, 'text-brand-emerald'],
  [/\bborder-emerald-200\b/g, 'border-brand-emerald/30'],
];

async function walk(dir) {
  const out = [];
  async function rec(p) {
    let entries;
    try { entries = await readdir(p, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(p, e.name);
      if (e.isDirectory()) {
        // Don't descend into api/.
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
    let s;
    try { s = await stat(abs); } catch { continue; }
    if (s.isDirectory()) {
      const walked = await walk(abs);
      for (const f of walked) files.add(f);
    } else {
      files.add(abs);
    }
  }
  // Apply skip list.
  return [...files].filter((f) => !SKIP.has(relative(ROOT, f)));
}

async function processFile(file) {
  const src = await readFile(file, 'utf8');
  let out = src;
  let changes = 0;
  for (const [re, to] of SWAPS) {
    out = out.replace(re, (m) => { changes++; return to.replace('$1', m); });
  }
  if (out !== src) {
    await writeFile(file, out);
  }
  return changes;
}

async function main() {
  const files = await gather();
  let totalFiles = 0;
  let totalEdits = 0;
  for (const f of files) {
    const n = await processFile(f);
    if (n > 0) {
      totalFiles++;
      totalEdits += n;
      console.log(`  ${relative(ROOT, f)}  (${n} edits)`);
    }
  }
  console.log(`\n[brand-sweep] ${totalEdits} edits across ${totalFiles} files`);
}

main().catch((err) => { console.error(err); process.exit(1); });
