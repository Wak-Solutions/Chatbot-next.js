/**
 * Authenticated route-group layout. Server Component — calls Auth.js
 * v5's `auth()` helper, redirects to /login on a missing session.
 */

import { redirect } from 'next/navigation';
import { auth } from '@/auth';

export default async function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  return <>{children}</>;
}
