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

/**
 * Canonicalize a phone to the exact shape Meta delivers in a webhook `from`
 * field (the wa_id): digits only, full international, no "+", no leading trunk
 * zero. This is the format messages.customer_phone is stored in, so a contact
 * saved through this matches inbound WhatsApp rows byte-for-byte — including the
 * exact-match joins in /api/customers and the journey route.
 *
 * Returns null for anything that isn't a plausible international number. A
 * local-format number (leading 0 / no country code, e.g. "0501234567") is
 * REJECTED rather than guessed at — we can't know its country, and accepting it
 * would create a thread that never lines up with the customer's WhatsApp wa_id.
 *
 *   "+966 50 123 4567" → "966501234567"
 *   "00966501234567"   → "966501234567"
 *   "966501234567"     → "966501234567"
 *   "0501234567"       → null   (local, ambiguous)
 *   "+0501234567"      → null   (leading trunk zero)
 */
export function toMetaPhone(phone: string | null | undefined): string | null {
  const digits = sanitizePhone(phone);
  // First digit 1-9 (no leading zero) + 6..14 more = 7..15 digits total (E.164).
  if (!/^[1-9]\d{6,14}$/.test(digits)) return null;
  return digits;
}
