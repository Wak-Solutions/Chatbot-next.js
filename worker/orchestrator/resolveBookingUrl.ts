/**
 * Resolve (or mint) a booking URL for a customer.
 *
 * Direct in-process call to @/lib/meetings/createToken.issueMeetingToken
 * (PR 8) — NO HTTP roundtrip to the dashboard. The legacy Python flow
 * (Chatbot/_agent_booking.py:34) posted to /api/meetings/create-token;
 * that route is deleted in this PR. The advisory lock + 3-attempt retry
 * pattern is already inside issueMeetingToken, keyed via
 * lib/db/locks.lockKey('booking-token:<companyId>:<phone>') — SHA-256-based,
 * which is the cross-process-safe lock key (not Python's hash()).
 *
 * Returns the customer-facing booking URL of the form
 * `<DASHBOARD_URL>/book/<token>`, or null when:
 *   - the helper exhausts its 3 attempts, or
 *   - DASHBOARD_URL isn't configured on the worker.
 */

import { issueMeetingToken } from '@/lib/meetings/createToken';
import { createLogger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';
import type { PendingMeeting } from '@/lib/meetings/queries';

const logger = createLogger('resolve-booking');

export interface ResolveBookingInput {
  customerPhone: string;
  companyId: number;
  pendingMeeting: PendingMeeting | null;
}

export async function resolveBookingUrl(
  input: ResolveBookingInput,
): Promise<string | null> {
  const { customerPhone, companyId, pendingMeeting } = input;

  const dashboardUrl = (process.env.DASHBOARD_URL ?? '').replace(/\/$/, '');
  if (!dashboardUrl) {
    logger.error(
      { companyId },
      'resolveBookingUrl — DASHBOARD_URL not configured on the worker',
    );
    return null;
  }

  // Fast path: an existing pending token with no scheduled_at is reusable.
  if (pendingMeeting && !pendingMeeting.scheduled_at && pendingMeeting.meeting_token) {
    logger.info(
      { phone: maskPhone(customerPhone) },
      'Reusing existing meeting token',
    );
    return `${dashboardUrl}/book/${pendingMeeting.meeting_token}`;
  }

  const result = await issueMeetingToken({ companyId, customerPhone });
  if (!result) {
    logger.error(
      { phone: maskPhone(customerPhone), companyId },
      'resolveBookingUrl — token issuance exhausted retries',
    );
    return null;
  }
  return `${dashboardUrl}/book/${result.token}`;
}
