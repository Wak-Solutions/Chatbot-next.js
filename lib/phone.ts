/**
 * Phone-number helpers shared by app and worker.
 *
 * - maskPhone: redact-for-logs. Ported from server/lib/logger.ts:42.
 *     maskPhone("971501234567") → "****4567"
 * - sanitizePhone: normalize-for-IO. Ported from server/lib/whatsapp.ts:6.
 *     Strips non-digits, drops a leading "00" international prefix.
 *     "+971 50 123 4567" → "971501234567"; "0049170…" → "49170…"
 */

export function maskPhone(phone: string | null | undefined): string {
  if (!phone || phone.length < 4) return '****';
  return `****${phone.slice(-4)}`;
}

export function sanitizePhone(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '').replace(/^00/, '');
}
