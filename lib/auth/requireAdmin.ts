import { requireAuth } from './requireAuth';
import { redirect } from 'next/navigation';

export async function requireAdmin() {
  const user = await requireAuth();
  if (user.role !== 'admin') redirect('/');
  return user;
}
