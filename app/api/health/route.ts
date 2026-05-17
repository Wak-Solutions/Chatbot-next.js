/**
 * GET /health (and /api/health) — DB liveness probe.
 *
 * Matches the response shape of server/index.ts:127-135:
 *   200 OK   { status: 'ok',       database: 'connected'   }
 *   503 SU   { status: 'degraded', database: 'unreachable' }
 */

import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('health');

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    await getPool().query('SELECT 1');
    return NextResponse.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    logger.error(
      { err: (err as Error)?.message },
      'Database unreachable',
    );
    return NextResponse.json(
      { status: 'degraded', database: 'unreachable' },
      { status: 503 },
    );
  }
}
