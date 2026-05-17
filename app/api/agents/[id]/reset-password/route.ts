/**
 * PATCH /api/agents/[id]/reset-password — port of server/agents.ts:281-297.
 *
 * DIVERGENCE: plan says POST; original is PATCH. Ported as PATCH for
 * dashboard wire-compat. Flagged.
 *
 * Admin-initiated reset — sets the password directly, no email flow.
 * Email-based self-serve reset lives at /api/auth/forgot-password.
 */

import bcrypt from 'bcrypt';
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('agents');

const bodySchema = z.object({ new_password: z.string().min(8).max(128) });

export const dynamic = 'force-dynamic';

export const PATCH = withCsrf(
  withAdmin<{ params: Promise<{ id: string }> }>(async (request, auth, ctx) => {
    const { id } = await ctx.params;
    try {
      const { new_password } = bodySchema.parse(await request.json());
      const hash = await bcrypt.hash(new_password, 10);
      const result = await getPool().query(
        `UPDATE agents SET password_hash=$1 WHERE id=$2 AND company_id=$3 RETURNING id`,
        [hash, id, auth.companyId],
      );
      if (result.rows.length === 0) {
        return NextResponse.json({ message: 'Agent not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ message: 'Invalid input' }, { status: 400 });
      }
      logger.error(
        { companyId: auth.companyId, targetAgentId: id, actorAgentId: auth.agentId, err: (err as Error)?.message },
        'resetAgentPassword failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
