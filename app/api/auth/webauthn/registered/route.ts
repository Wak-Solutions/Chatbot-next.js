/**
 * GET /api/auth/webauthn/registered?email=<addr>
 * Port of server/routes/auth.routes.ts:432-446.
 *
 * DIVERGENCE from PR plan: the plan note says "checks if current user has
 * any WebAuthn credentials", but the existing Express endpoint is public
 * and takes ?email=<addr> as a query parameter. Porting verbatim — the
 * dashboard login page calls this with the email the user typed in the
 * form, before they're authenticated, to decide whether to show the
 * passkey CTA. Same envelope shape regardless of whether the email exists,
 * to avoid account enumeration.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getPool } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const email = (new URL(request.url).searchParams.get('email') ?? '').trim();
  if (!email) return NextResponse.json({ registered: false });
  try {
    const result = await getPool().query(
      `SELECT 1 FROM webauthn_credentials wc
       JOIN agents a ON a.id = wc.agent_id
       WHERE lower(a.email) = lower($1) LIMIT 1`,
      [email],
    );
    return NextResponse.json({ registered: (result.rowCount ?? 0) > 0 });
  } catch {
    return NextResponse.json({ registered: false });
  }
}
