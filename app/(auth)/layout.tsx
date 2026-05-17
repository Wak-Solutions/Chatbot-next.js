/**
 * Authenticated route-group layout. Server Component — runs on the
 * server, calls the shared @/lib/auth/getSession.resolveSession helper,
 * redirects to /login on any non-authorized result.
 *
 * The HTTP-route version of this same gate lives in
 * @/lib/auth/requireAuth.requireAuth, which differs only in how it
 * surfaces a failure (NextResponse vs. redirect). The cookie read +
 * sid verify + session lookup + SR-013 60s is_active recheck +
 * trial gate all live in one shared helper so the two paths cannot
 * silently drift.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { resolveSession } from '@/lib/auth/getSession';

export default async function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const store = await cookies();
  const cookieValue = store.get(SESSION_COOKIE_NAME)?.value;

  // Layout always represents a dashboard-tree page, never one of the
  // trial-exempt API paths. '/dashboard' is a representative non-exempt
  // path so the trial gate fires uniformly across layout calls.
  const result = await resolveSession({ cookieValue, path: '/dashboard' });

  if (result.kind !== 'authorized') {
    redirect('/login');
  }

  return <>{children}</>;
}
