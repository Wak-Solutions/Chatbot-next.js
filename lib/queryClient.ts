/**
 * Client-side TanStack Query client + CSRF-aware fetch helpers.
 *
 * Port of client/src/lib/queryClient.ts. This module reads document.cookie
 * so it must only be imported from Client Components. Server Components
 * importing this will crash at runtime — by convention they fetch via
 * lib/ helpers directly, not via the query client.
 */

import { QueryClient, type QueryFunction } from '@tanstack/react-query';
import { getCsrfToken } from 'next-auth/react';

async function throwIfResNotOk(res: Response): Promise<void> {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// Cache the Auth.js CSRF token per page load. /api/auth/csrf returns the
// raw token portion of the HttpOnly __Host-authjs.csrf-token cookie —
// safe to memoise because the cookie itself is rotated by Auth.js, not
// the token shape.
let _csrfTokenCache: string | null = null;
async function csrfToken(): Promise<string> {
  if (_csrfTokenCache) return _csrfTokenCache;
  const t = (await getCsrfToken()) ?? '';
  _csrfTokenCache = t;
  return t;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const isStateChanging = method !== 'GET' && method !== 'HEAD';
  const res = await fetch(url, {
    method,
    headers: {
      ...(data ? { 'Content-Type': 'application/json' } : {}),
      ...(isStateChanging ? { 'x-csrf-token': await csrfToken() } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: 'include',
  });
  await throwIfResNotOk(res);
  return res;
}

/**
 * Drop-in `fetch` that attaches `x-csrf-token` on state-changing methods.
 * Same throw/return semantics as `fetch` — does NOT throw on non-2xx,
 * so call sites that inspect `res.ok` / `res.status` keep working.
 */
export async function csrfFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const isStateChanging = method !== 'GET' && method !== 'HEAD';
  const headers = new Headers(init.headers);
  if (isStateChanging && !headers.has('x-csrf-token')) {
    headers.set('x-csrf-token', await csrfToken());
  }
  return fetch(url, { credentials: 'include', ...init, headers });
}

type UnauthorizedBehavior = 'returnNull' | 'throw';
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join('/') as string, {
      credentials: 'include',
    });
    if (unauthorizedBehavior === 'returnNull' && res.status === 401) {
      return null as never;
    }
    await throwIfResNotOk(res);
    return (await res.json()) as never;
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: 'throw' }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: { retry: false },
  },
});
