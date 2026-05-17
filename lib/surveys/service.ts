/**
 * Survey lifecycle + post-event trigger.
 *
 * sendSurveyToCustomer — port of server/surveys.ts:77. Called fire-and-
 * forget from /api/escalate/close and /api/meetings/[id]/complete after
 * the underlying state change commits. No-op if the company has no
 * active survey or if WhatsApp credentials are missing.
 *
 * activateSurvey — atomic deactivate-others + activate-this in a single
 * transaction. Honors the one_active_survey_per_company partial unique
 * index so the company is never in a "two active" or "zero active"
 * state mid-call.
 *
 * deactivateSurvey — straightforward UPDATE.
 *
 * reorderQuestions — batched ORDER index update in one transaction.
 */

import crypto from 'node:crypto';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { getCompanyBranding } from '@/lib/notifications/email';
import { sendWhatsAppText } from '@/lib/messaging/whatsapp';

const logger = createLogger('surveys');

export async function sendSurveyToCustomer(
  customerPhone: string,
  agentId: number | null,
  escalationId: number | null,
  meetingId: number | null = null,
  companyId = 1,
): Promise<void> {
  try {
    const surveyRes = await getPool().query<{ id: number }>(
      `SELECT id FROM surveys WHERE is_active = true AND company_id = $1 LIMIT 1`,
      [companyId],
    );
    if (surveyRes.rows.length === 0) return;
    const surveyId = surveyRes.rows[0].id;
    if (!surveyId) return;

    const token = crypto.randomUUID();

    await getPool().query(
      `INSERT INTO survey_responses (survey_id, token, customer_phone, agent_id, escalation_id, meeting_id, company_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '24 hours')`,
      [surveyId, token, customerPhone, agentId, escalationId, meetingId, companyId],
    );

    let appUrl = '';
    let brandName = 'Our team';
    try {
      const branding = await getCompanyBranding(companyId);
      appUrl = branding.appUrl;
      brandName = branding.brandName;
    } catch {
      logger.warn({ companyId }, 'getCompanyBranding failed for survey — sending without link');
    }

    const surveyLink = appUrl ? `${appUrl}/survey/${token}` : null;
    const message =
      `Thank you for contacting ${brandName}! 😊\n` +
      `We'd love to hear your feedback — it only takes 1 minute:\n` +
      (surveyLink ? `${surveyLink}\n` : '') +
      `This link expires in 24 hours.`;

    await sendWhatsAppText({ companyId, phone: customerPhone, body: message });
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, 'sendSurveyToCustomer failed');
  }
}

export interface ActivateResult {
  ok: boolean;
  notFound?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  survey?: any;
}

/**
 * Atomic deactivate-others + activate-this. Returns the activated row or
 * notFound. Honors `one_active_survey_per_company` — at no point during
 * the transaction can the partial unique index be violated.
 */
export async function activateSurvey(
  surveyId: number | string,
  companyId: number,
): Promise<ActivateResult> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE surveys SET is_active=false, updated_at=NOW() WHERE company_id=$1',
      [companyId],
    );
    const result = await client.query(
      `UPDATE surveys SET is_active=true, updated_at=NOW()
       WHERE id=$1 AND company_id=$2 RETURNING *`,
      [surveyId, companyId],
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, notFound: true };
    }
    await client.query('COMMIT');
    return { ok: true, survey: result.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function deactivateSurvey(
  surveyId: number | string,
  companyId: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any | null> {
  const r = await getPool().query(
    `UPDATE surveys SET is_active=false, updated_at=NOW()
     WHERE id=$1 AND company_id=$2 RETURNING *`,
    [surveyId, companyId],
  );
  return r.rows[0] ?? null;
}

export async function reorderQuestions(
  surveyId: number | string,
  companyId: number,
  items: { id: number; order_index: number }[],
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      await client.query(
        `UPDATE survey_questions SET order_index=$1
         WHERE id=$2 AND survey_id=$3 AND company_id=$4`,
        [item.order_index, item.id, surveyId, companyId],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
