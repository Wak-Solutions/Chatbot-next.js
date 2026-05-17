/**
 * requireAdmin — port of server/middleware/auth.ts:125.
 *
 * Same shape as requireAuth, but additionally rejects with HTTP 403 if
 * session.role !== 'admin'. Implemented by delegating to requireAuth and
 * applying the role check on success.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireAuth, type AuthContext } from './requireAuth';

export async function requireAdmin(request: NextRequest): Promise<AuthContext | NextResponse> {
  const result = await requireAuth(request);
  if (result instanceof NextResponse) return result;
  if (result.role !== 'admin') {
    return NextResponse.json({ message: 'Admin access required' }, { status: 403 });
  }
  return result;
}
