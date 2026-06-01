/**
 * Transactional email via Brevo (HTTP API).
 *
 * Port of server/email.ts. Same exported surface:
 *   - esc(value)               — HTML-escape helper for safe interpolation
 *   - sendEmail(to, subj, html)— fire-and-forget single recipient
 *   - notifyManagerNewBooking()— admin notification with Google Calendar CTA
 *
 * Lazy Brevo client: instantiated on first call so module load doesn't fail
 * when BREVO_API_KEY isn't present (e.g. in typecheck environments).
 *
 * Templates are copied verbatim from server/email.ts and
 * server/routes/meetings.routes.ts (any HTML drift would change the inbox
 * appearance of an already-deployed email).
 */

import { BrevoClient } from '@getbrevo/brevo';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('email');

export function esc(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.charAt(0)}***@${domain}`;
}

let _brevoClient: BrevoClient | null = null;
function brevo(): BrevoClient {
  if (!_brevoClient) {
    _brevoClient = new BrevoClient({ apiKey: process.env.BREVO_API_KEY! });
  }
  return _brevoClient;
}

function buildGoogleCalendarUrl(opts: {
  title: string;
  scheduledUtc: Date;
  meetingLink: string;
}): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  const start = fmt(opts.scheduledUtc);
  const end = fmt(new Date(opts.scheduledUtc.getTime() + 3600000));
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: opts.title,
    dates: `${start}/${end}`,
    details: `Join the meeting: ${opts.meetingLink}`,
    sf: 'true',
    output: 'xml',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

async function resolveAdminEmails(companyId: number): Promise<string[]> {
  const emails: string[] = [];
  try {
    const result = await getPool().query<{ email: string | null }>(
      `SELECT email FROM agents
       WHERE company_id = $1 AND role = 'admin' AND is_active = true AND email IS NOT NULL`,
      [companyId],
    );
    for (const row of result.rows) {
      if (row.email && !emails.includes(row.email)) emails.push(row.email);
    }
    if (emails.length > 0) {
      logger.info(
        { companyId, found: emails.length },
        'resolveAdminEmails',
      );
    } else {
      logger.warn({ companyId }, 'resolveAdminEmails — no admin emails found in DB');
    }
  } catch (err) {
    logger.error(
      { companyId, err: (err as Error)?.message },
      'resolveAdminEmails — DB lookup failed',
    );
  }
  const override = process.env.MANAGER_EMAIL;
  if (override && !emails.includes(override)) {
    emails.push(override);
    logger.info({ override: maskEmail(override) }, 'resolveAdminEmails — appended MANAGER_EMAIL override');
  }
  return emails;
}

interface CompanyBranding {
  appUrl: string;
  brandName: string;
}

/**
 * Equivalent of server/routes/settings.routes.ts:65-74 getCompanyBranding,
 * inlined to keep lib/notifications/email.ts free of cross-tree imports.
 * Throws if either app_url or brand_name is missing.
 */
export async function getCompanyBranding(companyId: number): Promise<CompanyBranding> {
  const res = await getPool().query<{ app_url: string | null; brand_name: string | null }>(
    'SELECT app_url, brand_name FROM companies WHERE id = $1',
    [companyId],
  );
  const row = res.rows[0];
  if (!row?.app_url) throw new Error(`companies.app_url is not set for companyId=${companyId}`);
  if (!row?.brand_name) throw new Error(`companies.brand_name is not set for companyId=${companyId}`);
  return { appUrl: row.app_url.replace(/\/+$/, ''), brandName: row.brand_name };
}

export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  try {
    const result = await brevo().transactionalEmails.sendTransacEmail({
      sender: {
        email: process.env.BREVO_FROM_EMAIL!,
        name: process.env.BREVO_FROM_NAME || 'Notifications',
      },
      to: [{ email: to }],
      subject,
      htmlContent: body,
    });
    logger.info(
      { to: maskEmail(to), messageId: (result as { messageId?: string })?.messageId ?? 'n/a' },
      'sendEmail — sent via Brevo',
    );
  } catch (err) {
    logger.error(
      { to: maskEmail(to), err: (err as Error)?.message },
      'sendEmail — Brevo failed',
    );
  }
}

export async function notifyManagerNewBooking(opts: {
  companyId: number;
  customerPhone: string;
  dateTimeLabel: string;
  meetingLink: string;
  scheduledUtc: Date;
}): Promise<void> {
  const recipients = await resolveAdminEmails(opts.companyId);
  if (recipients.length === 0) {
    logger.error(
      { companyId: opts.companyId },
      'notifyManagerNewBooking — no recipient email found (set MANAGER_EMAIL or ensure an admin has an email address)',
    );
    return;
  }

  const { brandName } = await getCompanyBranding(opts.companyId);

  const calUrl = buildGoogleCalendarUrl({
    title: `${brandName} Meeting — ${opts.customerPhone}`,
    scheduledUtc: opts.scheduledUtc,
    meetingLink: opts.meetingLink,
  });
  const year = new Date().getFullYear();

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#0F510F;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${esc(brandName)}</h1>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:13px;">New Meeting Booking</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 24px;color:#222;font-size:15px;line-height:1.6;">A customer has just booked a meeting:</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9f0;border:1px solid #c8e6c9;border-radius:10px;margin-bottom:28px;">
            <tr><td style="padding:22px 26px;">
              <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;font-weight:700;">Customer</p>
              <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#222;">${esc(opts.customerPhone)}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;font-weight:700;">Date &amp; Time (AST — UTC+3)</p>
              <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#0F510F;">${esc(opts.dateTimeLabel)}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;font-weight:700;">Meeting Link</p>
              <a href="${esc(opts.meetingLink)}" style="font-size:14px;color:#0F510F;font-weight:600;word-break:break-all;">${esc(opts.meetingLink)}</a><br />
              <a href="${esc(opts.meetingLink)}" style="display:inline-block;margin-top:12px;background:#0F510F;color:#fff;text-decoration:none;padding:10px 22px;border-radius:6px;font-size:14px;font-weight:600;">Join Meeting</a>
            </td></tr>
          </table>
          <a href="${calUrl}" target="_blank" style="display:inline-block;background:#4285F4;color:#fff;text-decoration:none;padding:11px 22px;border-radius:6px;font-size:14px;font-weight:600;margin-bottom:24px;">&#128197; Add to Google Calendar</a>
          <p style="margin:0;color:#555;font-size:13px;">The customer will receive a WhatsApp reminder 15 minutes before the meeting.</p>
        </td></tr>
        <tr><td style="background:#f9f9f9;border-top:1px solid #eee;padding:16px 32px;">
          <p style="margin:0;font-size:11px;color:#aaa;text-align:center;">&copy; ${year} ${esc(brandName)}. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  for (const to of recipients) {
    logger.info(
      { to: maskEmail(to), companyId: opts.companyId },
      'notifyManagerNewBooking — sending',
    );
    await sendEmail(to, `New Meeting Booking — ${opts.customerPhone}`, html);
  }
}
