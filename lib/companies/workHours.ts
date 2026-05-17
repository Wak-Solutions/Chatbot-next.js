/**
 * Per-company work-hours config — port of getWorkHours + WorkHours from
 * server/routes/settings.routes.ts:24-88. Needed by slot-generation and
 * booking-validation helpers in @/lib/meetings/slots.
 *
 * Stored in companies.work_hours JSONB. Falls back to DEFAULT_WORK_HOURS
 * on a missing row or a malformed value — matches the legacy behavior.
 */

import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('work-hours');

export interface WorkHours {
  days: string[];     // ["Sun","Mon",...]
  start: string;      // "09:00"
  end: string;        // "18:00"
  timezone: string;   // IANA name e.g. "Asia/Riyadh"
}

export const DEFAULT_WORK_HOURS: WorkHours = {
  days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'],
  start: '09:00',
  end: '18:00',
  timezone: 'Asia/Riyadh',
};

export async function getWorkHours(companyId: number): Promise<WorkHours> {
  try {
    const res = await getPool().query<{ work_hours: WorkHours | null }>(
      'SELECT work_hours FROM companies WHERE id = $1',
      [companyId],
    );
    const wh = res.rows[0]?.work_hours;
    if (wh && wh.days && wh.start && wh.end && wh.timezone) return wh;
  } catch (err) {
    logger.warn(
      { companyId, err: (err as Error)?.message },
      'getWorkHours — DB lookup failed, using default',
    );
  }
  return { ...DEFAULT_WORK_HOURS };
}
