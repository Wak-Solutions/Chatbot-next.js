"use client";

/**
 * Wouter → Next.js App Router compatibility shim.
 *
 * Old client code imports `useLocation`, `useParams`, `Link` from
 * `wouter`. This module re-exports the same API surface backed by
 * `next/navigation` + `next/link`, so per-page ports only need to
 * change one import line: the (legacy) wouter import → `from "@/lib/router"`.
 *
 * Wouter shapes preserved:
 *
 *   useLocation(): [string, (path: string) => void]
 *     — Wouter returns [pathname, navigate]. We return
 *       [pathname, (path) => router.push(path)].
 *
 *   useParams<T>(): T
 *     — Next.js's useParams has the same signature.
 *
 *   Link
 *     — next/link's <Link href="/path">child</Link> matches Wouter's
 *       usage in this codebase (no nested <a> tags observed in the
 *       grep). If a `<a>` child sneaks through, Next renders nested
 *       anchors — fixable at code-review time, not a build break.
 *
 * Once PR 15 retires Wouter, the per-page imports can be flipped to
 * the canonical next/* imports and this shim can go.
 */

import { useRouter, usePathname, useParams as useNextParams } from 'next/navigation';
import NextLink from 'next/link';

export function useLocation(): [string, (path: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  return [pathname ?? '/', (path: string) => router.push(path)];
}

export const useParams = useNextParams;

export const Link = NextLink;
