/**
 * GET/PUT /api/settings/bcrumbs — Bread Crumbs workspace mapping.
 *
 * Each company is a separate Bread Crumbs workspace. The /api/bcrumbs/ai
 * endpoint resolves the tenant by matching the inbound `workspaceId`
 * against companies.bcrumbs_workspace_id, so this lets an admin set their
 * own company's workspace ID instead of editing the DB by hand.
 *
 * Admin-only (per-company via auth.companyId). PUT is CSRF-guarded.
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('settings');

export const dynamic = 'force-dynamic';

export const GET = withAdmin(async (_request, auth) => {
  try {
    const r = await getPool().query<{ bcrumbs_workspace_id: string | null }>(
      'SELECT bcrumbs_workspace_id FROM companies WHERE id = $1',
      [auth.companyId],
    );
    return NextResponse.json({ workspaceId: r.rows[0]?.bcrumbs_workspace_id ?? '' });
  } catch (err) {
    logger.error(
      { companyId: auth.companyId, err: (err as Error)?.message },
      'getBcrumbsSettings failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});

const workspaceIdSchema = z.coerce.string().min(1).max(128);

export const PUT = withCsrf(
  withAdmin(async (request, auth) => {
    try {
      const body = ((await request.json()) ?? {}) as { workspaceId?: string };
      const workspaceId = (body.workspaceId ?? '').trim();

      if (!workspaceIdSchema.safeParse(workspaceId).success) {
        return NextResponse.json(
          { message: 'workspaceId is required (max 128 chars)' },
          { status: 400 },
        );
      }

      // Guard: a workspace ID maps to exactly one company. Reject if it's
      // already claimed by a different tenant so two companies can't collide.
      const clash = await getPool().query<{ id: number }>(
        'SELECT id FROM companies WHERE bcrumbs_workspace_id = $1 AND id <> $2 LIMIT 1',
        [workspaceId, auth.companyId],
      );
      if (clash.rows[0]) {
        return NextResponse.json(
          { message: 'That workspace ID is already linked to another company.' },
          { status: 409 },
        );
      }

      await getPool().query(
        'UPDATE companies SET bcrumbs_workspace_id = $1 WHERE id = $2',
        [workspaceId, auth.companyId],
      );

      logger.info({ companyId: auth.companyId }, 'setBcrumbsWorkspaceId');
      return NextResponse.json({ success: true });
    } catch (err) {
      logger.error(
        { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
        'setBcrumbsSettings failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
