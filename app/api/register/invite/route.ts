/**
 * POST /api/register/invite — port of server/routes/register.routes.ts:313-412.
 *
 * Authenticated as admin. Bulk-create up to 50 agents, assign them a
 * random 10-character base64url temp password, and email each invitee.
 *
 * Returns 400 with `{ error, duplicates: [...] }` if any of the supplied
 * emails already belong to an existing agent — preserves the original
 * envelope shape verbatim.
 *
 * Email template is copied verbatim from register.routes.ts:355-392.
 */

import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { sendEmail, esc, getCompanyBranding } from '@/lib/notifications/email';

const logger = createLogger('register');

const InviteSchema = z.object({
  agents: z
    .array(
      z.object({
        email: z.string().email().max(255),
        name: z.string().min(1).max(100),
        role: z.string().optional(),
      }),
    )
    .min(1)
    .max(50),
});

export const dynamic = 'force-dynamic';

export const POST = withAdmin(async (request, auth) => {
  const companyId = auth.companyId;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }
  const parsed = InviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }
  const { agents } = parsed.data;
  const invited: { email: string }[] = [];

  try {
    const validAgents = agents.filter((a) => a.email && a.name);
    if (validAgents.length > 0) {
      const emails = validAgents.map((a) => a.email.toLowerCase());
      const existingRes = await getPool().query<{ email: string }>(
        `SELECT email FROM agents WHERE lower(email) = ANY($1::text[])`,
        [emails],
      );
      if (existingRes.rows.length > 0) {
        const duplicates = existingRes.rows.map((r: { email: string }) => r.email);
        return NextResponse.json(
          { error: 'Some emails are already in use', duplicates },
          { status: 400 },
        );
      }
    }

    const { appUrl: inviteAppUrl, brandName: inviteBrand } = await getCompanyBranding(companyId);
    const year = new Date().getFullYear();

    for (const agent of agents) {
      if (!agent.email || !agent.name) continue;
      const tempPass = crypto.randomBytes(8).toString('base64url').slice(0, 10);
      const hash = await bcrypt.hash(tempPass, 10);
      await getPool().query(
        `INSERT INTO agents (name, email, password_hash, role, company_id, is_active)
         VALUES ($1, $2, $3, 'agent', $4, true)`,
        [agent.name, agent.email, hash, companyId],
      );
      invited.push({ email: agent.email });

      const inviteHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#0F510F;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${esc(inviteBrand)}</h1>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:13px;">You've been invited to join your team</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 24px;color:#222;font-size:15px;line-height:1.6;">Hi ${esc(agent.name)},</p>
          <p style="margin:0 0 24px;color:#555;font-size:14px;line-height:1.6;">You've been added as a team member on ${esc(inviteBrand)} — an AI-powered customer engagement platform. Use the credentials below to sign in and get started.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9f0;border:1px solid #c8e6c9;border-radius:10px;margin-bottom:28px;">
            <tr><td style="padding:22px 26px;">
              <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;font-weight:700;">Login Email</p>
              <p style="margin:0 0 20px;font-size:15px;font-weight:700;color:#222;">${esc(agent.email)}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;font-weight:700;">Temporary Password</p>
              <p style="margin:0 0 20px;font-size:15px;font-weight:700;color:#0F510F;letter-spacing:1px;">${esc(tempPass)}</p>
              <a href="${esc(inviteAppUrl)}/login" style="display:inline-block;background:#0F510F;color:#fff;text-decoration:none;padding:10px 22px;border-radius:6px;font-size:14px;font-weight:600;">Sign In to Dashboard</a>
            </td></tr>
          </table>
          <p style="margin:0 0 10px;color:#444;font-size:14px;font-weight:700;">Getting started</p>
          <ul style="margin:0 0 24px;padding-left:20px;color:#555;font-size:13px;line-height:1.9;">
            <li>Sign in using the email and temporary password above.</li>
            <li>You will be prompted to set a new password on your first login — please do this immediately.</li>
            <li>Once in, you can view conversations, manage meetings, and collaborate with your team.</li>
          </ul>
          <p style="margin:0;color:#555;font-size:13px;line-height:1.6;">If you have any trouble signing in or did not expect this invitation, please contact your team administrator.</p>
        </td></tr>
        <tr><td style="background:#f9f9f9;border-top:1px solid #eee;padding:16px 32px;">
          <p style="margin:0;font-size:11px;color:#aaa;text-align:center;">&copy; ${year} ${esc(inviteBrand)}. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
      sendEmail(
        agent.email,
        `You've been invited to ${inviteBrand}`,
        inviteHtml,
      ).catch((e: unknown) =>
        logger.warn(
          { email: agent.email, err: (e as Error)?.message },
          'Invite email failed',
        ),
      );
    }

    await getPool().query(
      'UPDATE companies SET onboarding_step = GREATEST(onboarding_step, 6) WHERE id = $1',
      [companyId],
    );

    logger.info({ companyId, count: invited.length }, 'Agents invited');
    return NextResponse.json({ success: true, invited });
  } catch (err) {
    logger.error(
      { companyId, err: (err as Error)?.message },
      'Agent invitation failed',
    );
    return NextResponse.json({ error: 'Failed to invite agents' }, { status: 500 });
  }
});
