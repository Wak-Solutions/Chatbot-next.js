/**
 * Meta WhatsApp Cloud API wrapper — unified port of
 *   server/lib/whatsapp.ts (TypeScript) and Chatbot/whatsapp.py (Python).
 *
 *   sendWhatsAppText        — high-level: looks up creds, sends text
 *   sendWhatsAppTemplate    — high-level: template message (e.g. reminders)
 *   sendWhatsAppTextWithCreds / sendWhatsAppTemplateWithCreds —
 *                             low-level variants the caller passes creds to
 *   verifyMetaSignature     — HMAC-SHA256 verify of x-hub-signature-256
 *
 * 10s timeout per request, no retries — matches Chatbot/whatsapp.py:57 and
 * server/lib/whatsapp.ts:45. Phone normalization via sanitizePhone in
 * @/lib/phone (strips non-digits, drops a leading "00").
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { createLogger } from '@/lib/logger';
import { maskPhone, sanitizePhone } from '@/lib/phone';
import { getWhatsappCreds } from '@/lib/companies/creds';

const logger = createLogger('whatsapp');

const META_BASE = 'https://graph.facebook.com/v19.0';
const META_TIMEOUT_MS = 10_000;

interface MetaCreds {
  token: string;
  phoneId: string;
}

async function postToMeta(
  creds: MetaCreds,
  body: Record<string, unknown>,
  to: string,
): Promise<boolean> {
  const url = `${META_BASE}/${creds.phoneId}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      logger.error(
        {
          phone: maskPhone(to),
          status: res.status,
          body: errBody.slice(0, 200),
        },
        'Meta send failed',
      );
      return false;
    }
    logger.info({ phone: maskPhone(to) }, 'WhatsApp sent');
    return true;
  } catch (err) {
    logger.error(
      { phone: maskPhone(to), err: (err as Error)?.message },
      'WhatsApp send exception',
    );
    return false;
  }
}

export async function sendWhatsAppTextWithCreds(input: {
  phone: string;
  body: string;
  creds: MetaCreds;
}): Promise<boolean> {
  const to = sanitizePhone(input.phone);
  if (!to) {
    logger.error('sendWhatsAppText skipped — empty phone');
    return false;
  }
  return postToMeta(
    input.creds,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: input.body },
    },
    to,
  );
}

export async function sendWhatsAppText(input: {
  companyId: number;
  phone: string;
  body: string;
}): Promise<boolean> {
  const creds = await getWhatsappCreds(input.companyId);
  if (!creds) {
    logger.error({ companyId: input.companyId }, 'sendWhatsAppText — missing credentials');
    return false;
  }
  return sendWhatsAppTextWithCreds({
    phone: input.phone,
    body: input.body,
    creds: { token: creds.token, phoneId: creds.phoneId },
  });
}

export async function sendWhatsAppTemplateWithCreds(input: {
  phone: string;
  templateName: string;
  languageCode: string;
  components?: unknown[];
  creds: MetaCreds;
}): Promise<boolean> {
  const to = sanitizePhone(input.phone);
  if (!to) {
    logger.error('sendWhatsAppTemplate skipped — empty phone');
    return false;
  }
  const template: Record<string, unknown> = {
    name: input.templateName,
    language: { code: input.languageCode },
  };
  if (input.components && input.components.length > 0) {
    template.components = input.components;
  }
  return postToMeta(
    input.creds,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template,
    },
    to,
  );
}

export async function sendWhatsAppTemplate(input: {
  companyId: number;
  phone: string;
  templateName: string;
  languageCode: string;
  components?: unknown[];
}): Promise<boolean> {
  const creds = await getWhatsappCreds(input.companyId);
  if (!creds) {
    logger.error({ companyId: input.companyId }, 'sendWhatsAppTemplate — missing credentials');
    return false;
  }
  return sendWhatsAppTemplateWithCreds({
    phone: input.phone,
    templateName: input.templateName,
    languageCode: input.languageCode,
    components: input.components,
    creds: { token: creds.token, phoneId: creds.phoneId },
  });
}

/**
 * Verify the x-hub-signature-256 header against an HMAC-SHA256 of the
 * raw request body using the company's whatsapp_app_secret.
 *
 *   Header format: "sha256=<hex>"
 *
 * Returns false on any malformed header, length mismatch, or signature
 * mismatch. Uses timingSafeEqual to avoid leaking the signature byte-by-byte.
 */
export function verifyMetaSignature(
  rawBody: Buffer | Uint8Array | string,
  signatureHeader: string | null | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const m = signatureHeader.match(/^sha256=([0-9a-fA-F]+)$/);
  if (!m) return false;
  const supplied = Buffer.from(m[1], 'hex');
  const expected = createHmac('sha256', appSecret)
    .update(rawBody as Buffer | string)
    .digest();
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}
