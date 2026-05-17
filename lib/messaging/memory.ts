/**
 * Conversation history + message persistence for the worker.
 *
 * Port of Chatbot/memory.py with one intentional change: the advisory
 * lock key is derived via lib/db/locks.lockKey (SHA-256 → bigint) rather
 * than Python's process-randomised hash(). Same key used by PR 7's
 * /api/send so the dashboard outbound writer and the worker inbound
 * writer serialize on the SAME (companyId, phone) key. Cross-process
 * race protection — critical now that the worker is also writing
 * conversation_ids in PR 13.
 *
 * MEMORY_WINDOW = 20 messages — same as Chatbot/config.py:56.
 * CONVERSATION_WINDOW_HOURS = 24 — same as memory.py:96.
 */

import crypto from 'node:crypto';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { lockKey } from '@/lib/db/locks';
import { maskPhone } from '@/lib/phone';

const logger = createLogger('memory');

export const MEMORY_WINDOW = 20;
export const CONVERSATION_WINDOW_HOURS = 24;

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Returns the last MEMORY_WINDOW messages for (customerPhone, companyId)
 * in chronological order, formatted for an OpenAI conversation. Empty
 * for new customers — orchestrator.getReply uses that signal to fire
 * the mandatory opening message.
 */
export async function loadHistory(
  customerPhone: string,
  companyId: number,
): Promise<HistoryMessage[]> {
  try {
    const r = await getPool().query<{ role: string; message_text: string }>(
      `SELECT role, message_text
       FROM (
         SELECT sender AS role, message_text, created_at
         FROM messages
         WHERE customer_phone = $1 AND company_id = $3
         ORDER BY created_at DESC
         LIMIT $2
       ) recent_messages
       ORDER BY created_at ASC`,
      [customerPhone, MEMORY_WINDOW, companyId],
    );
    if (r.rows.length === 0) {
      logger.info({ phone: maskPhone(customerPhone) }, 'No history found (new customer)');
      return [];
    }
    const history: HistoryMessage[] = r.rows.map((row) => ({
      role: row.role === 'customer' ? 'user' : 'assistant',
      content: row.message_text,
    }));
    logger.info(
      { phone: maskPhone(customerPhone), messages: history.length },
      'History loaded',
    );
    return history;
  } catch (err) {
    logger.error(
      { phone: maskPhone(customerPhone), err: (err as Error)?.message },
      'loadHistory failed',
    );
    throw err;
  }
}

/**
 * Returns the active conversation_id for this customer within the last
 * CONVERSATION_WINDOW_HOURS, or null. READ-only — does NOT create. The
 * orchestrator uses this for menu state scoping.
 */
export async function getConversationId(
  customerPhone: string,
  companyId: number,
): Promise<string | null> {
  try {
    const r = await getPool().query<{ conversation_id: string | null }>(
      `SELECT conversation_id FROM messages
       WHERE customer_phone = $1 AND company_id = $2
         AND conversation_id IS NOT NULL
         AND created_at > NOW() - INTERVAL '${CONVERSATION_WINDOW_HOURS} hours'
       ORDER BY created_at DESC LIMIT 1`,
      [customerPhone, companyId],
    );
    return r.rows[0]?.conversation_id ?? null;
  } catch (err) {
    logger.error(
      { phone: maskPhone(customerPhone), err: (err as Error)?.message },
      'getConversationId failed',
    );
    return null;
  }
}

// Process-scoped LRU of seen (companyId, phone) pairs. Avoids a DB
// round-trip on every inbound auto-capture-contact. Bounded; LRU
// eviction matches Python's _KNOWN_CONTACTS_MAX = 10_000.
const KNOWN_CONTACTS_MAX = 10_000;
const knownContacts: Map<string, true> = new Map();

async function autoCaptureContact(customerPhone: string, companyId: number): Promise<void> {
  const key = `${companyId}:${customerPhone}`;
  if (knownContacts.has(key)) {
    knownContacts.delete(key);
    knownContacts.set(key, true);
    return;
  }
  try {
    const client = await getPool().connect();
    try {
      const row = await client.query<{ id: number }>(
        `INSERT INTO contacts (phone_number, source)
         VALUES ($1, 'whatsapp')
         ON CONFLICT (phone_number) DO UPDATE SET phone_number = EXCLUDED.phone_number
         RETURNING id`,
        [customerPhone],
      );
      const contactId = row.rows[0].id;
      await client.query(
        `INSERT INTO contact_companies (contact_id, company_id, source)
         VALUES ($1, $2, 'whatsapp')
         ON CONFLICT (contact_id, company_id) DO NOTHING`,
        [contactId, companyId],
      );
    } finally {
      client.release();
    }
    knownContacts.set(key, true);
    if (knownContacts.size > KNOWN_CONTACTS_MAX) {
      const oldest = knownContacts.keys().next().value;
      if (oldest !== undefined) knownContacts.delete(oldest);
    }
  } catch (err) {
    // Non-fatal — log and continue. The customer's message still saves.
    logger.error(
      { phone: maskPhone(customerPhone), err: (err as Error)?.message },
      'autoCaptureContact failed (non-fatal)',
    );
  }
}

export interface SaveMessageInput {
  customerPhone: string;
  companyId: number;
  direction: 'inbound' | 'outbound';
  messageText: string;
  sender?: string;
  mediaType?: string | null;
  mediaUrl?: string | null;
  transcription?: string | null;
}

/**
 * Persist a single message row.
 *
 * Resolves the conversation_id under a pg_advisory_xact_lock keyed via
 * @/lib/db/locks.lockKey('convo:<companyId>:<phone>'). The lock prevents
 * two near-simultaneous writers (inbound + outbound, or two inbound
 * retries) from minting two different conversation_ids for what should
 * be the same session.
 *
 * Same key the dashboard's /api/send uses (PR 7), so cross-writer
 * serialization is real, not nominal.
 *
 * On inbound, also fires autoCaptureContact (LRU-cached, fire-and-forget
 * style — non-fatal on failure).
 */
export async function saveMessage(input: SaveMessageInput): Promise<void> {
  const {
    customerPhone,
    companyId,
    direction,
    messageText,
    sender,
    mediaType = null,
    mediaUrl = null,
    transcription = null,
  } = input;

  const effectiveSender = sender ?? (direction === 'inbound' ? 'customer' : 'ai');
  const key = lockKey(`convo:${companyId}:${customerPhone}`);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [key.toString()]);

    const existing = await client.query<{ conversation_id: string | null }>(
      `SELECT conversation_id FROM messages
       WHERE customer_phone = $1 AND company_id = $2
         AND conversation_id IS NOT NULL
         AND created_at > NOW() - INTERVAL '${CONVERSATION_WINDOW_HOURS} hours'
       ORDER BY created_at DESC LIMIT 1`,
      [customerPhone, companyId],
    );
    const conversationId =
      existing.rows[0]?.conversation_id ?? crypto.randomUUID();

    await client.query(
      `INSERT INTO messages
         (customer_phone, direction, sender, message_text,
          media_type, media_url, transcription, company_id, created_at,
          conversation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9::uuid)`,
      [
        customerPhone,
        direction,
        effectiveSender,
        messageText,
        mediaType,
        mediaUrl,
        transcription,
        companyId,
        conversationId,
      ],
    );
    await client.query('COMMIT');
    logger.info(
      {
        phone: maskPhone(customerPhone),
        direction,
        sender: effectiveSender,
        mediaType: mediaType || 'text',
      },
      'Message saved',
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error(
      {
        phone: maskPhone(customerPhone),
        direction,
        err: (err as Error)?.message,
      },
      'saveMessage failed',
    );
    throw err;
  } finally {
    client.release();
  }

  if (direction === 'inbound') {
    await autoCaptureContact(customerPhone, companyId);
  }
}
