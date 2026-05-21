/**
 * worker/tasks/meetingReminder — integration test.
 *
 * The atomic claim pattern (UPDATE meetings SET link_sent = TRUE WHERE
 * link_sent = FALSE RETURNING id) is the entire race-protection between
 * the legacy Express CRON_ONLY service and the new worker during the
 * cutover overlap window. Tests verify:
 *
 *   1. Happy path: pending meeting in the 14-16min window → sendWhatsAppText
 *      is called and link_sent flips to TRUE.
 *   2. Second tick: same meeting is NOT sent again (claim already taken).
 *   3. Failed send: link_sent is released back to FALSE so a later tick
 *      can retry (matches legacy fail-and-release).
 *
 * Mocks @/lib/messaging/whatsapp at the module boundary so no Meta call
 * is ever attempted, and @/lib/notifications/email so the branding lookup
 * doesn't depend on a companies row.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Pool } from 'pg';
import { hasDatabaseUrl, newTestPool } from '@/tests/helpers/db';

const sendMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<boolean>>(),
);
const brandingMock = vi.hoisted(() =>
  vi.fn<() => Promise<{ brandName: string }>>(),
);

vi.mock('@/lib/messaging/whatsapp', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/messaging/whatsapp')>(
      '@/lib/messaging/whatsapp',
    );
  return { ...actual, sendWhatsAppText: sendMock };
});
vi.mock('@/lib/notifications/email', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/notifications/email')>(
      '@/lib/notifications/email',
    );
  return { ...actual, getCompanyBranding: brandingMock };
});

// Imported AFTER vi.mock so the mocked deps are in place.
const { meetingReminderTask } = await import('@/worker/tasks/meetingReminder');

const COMPANY_ID = 999_997;
const PHONE_PREFIX = '+testreminder';
const LINK = 'https://example.com/meeting/test';

describe.skipIf(!hasDatabaseUrl())(
  'worker/tasks/meetingReminder (integration)',
  () => {
    let pool: Pool;

    beforeAll(() => {
      pool = newTestPool();
    });

    beforeEach(async () => {
      sendMock.mockReset();
      brandingMock.mockReset();
      brandingMock.mockResolvedValue({ brandName: 'Test Co' });
      await pool.query(
        `DELETE FROM meetings WHERE customer_phone LIKE $1 OR company_id = $2`,
        [`${PHONE_PREFIX}%`, COMPANY_ID],
      );
    });

    afterEach(async () => {
      await pool.query(
        `DELETE FROM meetings WHERE customer_phone LIKE $1 OR company_id = $2`,
        [`${PHONE_PREFIX}%`, COMPANY_ID],
      );
    });

    afterAll(async () => {
      await pool.end();
    });

    /** Insert a pending meeting scheduled 15 minutes from NOW(). */
    async function insertPendingMeeting(phone: string): Promise<number> {
      const r = await pool.query<{ id: number }>(
        `INSERT INTO meetings
           (customer_phone, meeting_link, scheduled_at, status, link_sent, company_id, created_at)
         VALUES ($1, $2, NOW() + INTERVAL '15 minutes', 'pending', FALSE, $3, NOW())
         RETURNING id`,
        [phone, LINK, COMPANY_ID],
      );
      return r.rows[0].id;
    }

    it('sends reminder and flips link_sent=TRUE on success', async () => {
      const phone = `${PHONE_PREFIX}-happy`;
      const id = await insertPendingMeeting(phone);
      sendMock.mockResolvedValue(true);

      await meetingReminderTask();

      expect(sendMock).toHaveBeenCalledTimes(1);
      const flagged = await pool.query<{ link_sent: boolean }>(
        `SELECT link_sent FROM meetings WHERE id = $1`,
        [id],
      );
      expect(flagged.rows[0].link_sent).toBe(true);
    });

    it('second tick is a no-op — claim is already taken', async () => {
      const phone = `${PHONE_PREFIX}-once`;
      await insertPendingMeeting(phone);
      sendMock.mockResolvedValue(true);

      await meetingReminderTask();
      expect(sendMock).toHaveBeenCalledTimes(1);

      await meetingReminderTask();
      // Still 1 — the claim filter (link_sent = FALSE) excludes the row.
      expect(sendMock).toHaveBeenCalledTimes(1);
    });

    it('releases the claim back to FALSE if the send fails', async () => {
      const phone = `${PHONE_PREFIX}-fail`;
      const id = await insertPendingMeeting(phone);
      sendMock.mockResolvedValue(false);

      await meetingReminderTask();

      const r = await pool.query<{ link_sent: boolean }>(
        `SELECT link_sent FROM meetings WHERE id = $1`,
        [id],
      );
      expect(r.rows[0].link_sent).toBe(false);

      // A later tick can retry once the mock is told to succeed.
      sendMock.mockResolvedValue(true);
      await meetingReminderTask();
      expect(sendMock).toHaveBeenCalledTimes(2);
      const r2 = await pool.query<{ link_sent: boolean }>(
        `SELECT link_sent FROM meetings WHERE id = $1`,
        [id],
      );
      expect(r2.rows[0].link_sent).toBe(true);
    });
  },
);
