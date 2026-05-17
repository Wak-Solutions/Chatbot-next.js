/**
 * GET /api/config/trial-days — port of server/routes.ts:125-131.
 *
 * Public, unauthenticated. Used by the landing/register pages to render
 * the trial length without hardcoding it. Returns only the number of
 * days, nothing sensitive.
 *
 *   200: { trialDays: number }
 *   500: { message: 'Failed to load config' }
 */

import { NextResponse } from 'next/server';
import { getTrialDays } from '@/lib/auth/trial';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ trialDays: await getTrialDays() });
  } catch {
    return NextResponse.json({ message: 'Failed to load config' }, { status: 500 });
  }
}
