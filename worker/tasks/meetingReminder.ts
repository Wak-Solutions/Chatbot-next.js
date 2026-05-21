/**
 * Meeting-reminder task body — port of the legacy
 * server/lib/meeting-reminders.ts tick(), now using the lib/ primitives
 * landed in PR 8 (findPendingReminders / claimReminder / releaseReminder).
 *
 * The atomic claim pattern is preserved verbatim:
 *
 *   UPDATE meetings SET link_sent = TRUE
 *   WHERE id = $1 AND link_sent = FALSE
 *   RETURNING id
 *
 * This single UPDATE is the entire race-protection between the legacy
 * Express CRON_ONLY service and the new worker during the PR 12
 * cutover overlap window. Only one writer wins per meeting; the loser
 * sees an empty RETURNING and moves on.
 *
 * Log message strings mirror the legacy verbatim so log-based monitoring
 * (grep / alerting on "Reminder sent" / "Reminder send failed — released
 * claim" / "Reminder tick failed") keeps working through the cutover.
 */

import { createLogger } from '@/lib/logger';
import {
  findPendingReminders,
  claimReminder,
  releaseReminder,
} from '@/lib/meetings/reminders';
import { sendWhatsAppText } from '@/lib/messaging/whatsapp';
import { getCompanyBranding } from '@/lib/notifications/email';
import { maskPhone } from '@/lib/phone';

const logger = createLogger('meeting-reminder');

export async function meetingReminderTask(): Promise<void> {
  try {
    const pending = await findPendingReminders();

    for (const m of pending) {
      // Atomic claim — only one writer wins.
      const claimed = await claimReminder(m.id);
      if (!claimed) continue;

      let brandName = 'Our team';
      try {
        const branding = await getCompanyBranding(m.company_id);
        brandName = branding.brandName;
      } catch (err) {
        logger.warn(
          {
            meetingId: m.id,
            companyId: m.company_id,
            err: (err as Error)?.message,
          },
          'Branding lookup failed, using default',
        );
      }

      const ok = await sendWhatsAppText({
        companyId: m.company_id,
        phone: m.customer_phone,
        body: `Your meeting with ${brandName} starts in 15 minutes.\n\nJoin here: ${m.meeting_link}`,
      });

      if (ok) {
        logger.info(
          { meetingId: m.id, phone: maskPhone(m.customer_phone) },
          'Reminder sent',
        );
      } else {
        // Release the claim so a later tick can retry — same fail-and-release
        // pattern as the legacy server/lib/meeting-reminders.ts:46.
        await releaseReminder(m.id);
        logger.error({ meetingId: m.id }, 'Reminder send failed — released claim');
      }
    }
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, 'Reminder tick failed');
  }
}
