/**
 * Daily.co video-room creation — port of server/integrations/daily.ts.
 *
 * One-shot room with 24h TTL, no retries on failure. Callers handle the
 * fallback (meeting row still gets created, no meeting_link, admins
 * notified anyway — see /api/book/:token).
 *
 * Throws Error when DAILY_API_KEY is unset or the upstream returns
 * non-2xx. 10s timeout per request.
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('daily');

export interface DailyRoom {
  url: string;
  name: string;
}

export async function createDailyRoom(): Promise<DailyRoom> {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) {
    throw new Error('DAILY_API_KEY is not configured — cannot create meeting room');
  }

  logger.info('Creating Daily.co room');

  const response = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      properties: {
        enable_prejoin_ui: false,
        enable_knocking: false,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    logger.error(
      { status: response.status, body: errText.slice(0, 200) },
      'Daily.co room creation failed',
    );
    throw new Error(`Daily.co room creation failed: ${errText}`);
  }

  const data = (await response.json()) as { url: string; name: string };
  logger.info({ name: data.name }, 'Daily.co room created');
  return { url: data.url, name: data.name };
}
