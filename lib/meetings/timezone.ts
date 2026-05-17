/**
 * KSA timezone helpers (UTC+3, no DST). Port of server/lib/timezone.ts.
 *
 * All date math in the booking system is done in UTC; KSA local time
 * is computed only for display labels sent to customers.
 */

export const KSA_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Format a Date (already adjusted to KSA local time) as "Mon, 3 Apr 2026". */
export function formatKsaDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Format a Date (already adjusted to KSA local time) as "Monday, 3 April 2026 at 14:00". */
export function formatKsaDateTime(d: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const day = days[d.getUTCDay()];
  const month = months[d.getUTCMonth()];
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day}, ${d.getUTCDate()} ${month} ${d.getUTCFullYear()} at ${hh}:${mm}`;
}
