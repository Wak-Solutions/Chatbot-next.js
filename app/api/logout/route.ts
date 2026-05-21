/**
 * POST /api/logout — Auth.js v5 signOut.
 *
 * Uses the signOut() helper from @/auth with redirect:false so we can
 * keep the legacy `{ success: true }` JSON response shape the frontend
 * already expects.
 */

import { NextResponse } from 'next/server';
import { signOut } from '@/auth';
import { createLogger } from '@/lib/logger';

const logger = createLogger('auth');

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  try {
    await signOut({ redirect: false });
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, 'signOut error (non-fatal)');
  }
  logger.info('Logout complete');
  return NextResponse.json({ success: true });
}
