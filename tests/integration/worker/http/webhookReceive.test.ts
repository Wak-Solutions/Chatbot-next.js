/**
 * worker/http/webhookReceive — handler contract test.
 *
 * Focuses on the response code contract Meta cares about:
 *   200 = ack, do NOT retry      403 = signature failure
 *
 * Verifies eight scenarios:
 *   1. valid HMAC → 200 + 'process-text' enqueued
 *   2. invalid HMAC → 403
 *   3. missing X-Hub-Signature-256 → 403
 *   4. missing app_secret for the phone_number_id → 403 (fail-closed)
 *   5. malformed JSON → 200 (anti-flood)
 *   6. payload with no phone_number_id (status callback) → 200
 *   7. DB error during company lookup → 200 (anti-flood)
 *   8. duplicate message_id → 200 + NOT enqueued
 *
 * Phase 2: dispatch is now via BullMQ (botQueue.add) instead of the
 * in-process Semaphore + processText/processAudio direct calls. The
 * test mocks botQueue.add so no Redis connection is required.
 *
 * We mock the deep deps (DB lookups, queue, etc.) via vi.hoisted
 * so no real Postgres, Redis, or Meta call happens. The handler itself
 * runs unmodified — this is a contract test, not a unit test of internals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLogger } from '@/lib/logger';

// ── Mocks (hoisted so they live in module-load order) ─────────────────────
const botQueueAddMock = vi.hoisted(() =>
  vi.fn<(name: string, data: unknown) => Promise<unknown>>(),
);
const lookupSecretMock = vi.hoisted(() =>
  vi.fn<(phoneNumberId: string) => Promise<string | null>>(),
);
const resolveCompanyMock = vi.hoisted(() =>
  vi.fn<(phoneNumberId: string) => Promise<number | null>>(),
);
const getCredsMock = vi.hoisted(() =>
  vi.fn<(companyId: number) => Promise<{ token: string; phoneId: string } | null>>(),
);
const claimMessageIdMock = vi.hoisted(() =>
  vi.fn<(id: string) => Promise<boolean>>(),
);
const queryMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{ rows: unknown[] }>>(),
);

vi.mock('@/lib/queue/queues', () => ({
  botQueue: { add: botQueueAddMock },
}));
vi.mock('@/lib/companies/creds', () => ({
  lookupAppSecretByPhoneNumberId: lookupSecretMock,
  getWhatsappCreds: getCredsMock,
}));
vi.mock('@/lib/companies/resolveByPhoneNumberId', () => ({
  resolveCompanyByPhoneNumberId: resolveCompanyMock,
}));
vi.mock('@/lib/inbox/messageIdClaim', () => ({
  claimMessageId: claimMessageIdMock,
}));
vi.mock('@/lib/db/client', () => ({
  getPool: () => ({ query: queryMock }),
}));

const { makeWebhookReceiveHandler } = await import(
  '@/worker/http/webhookReceive'
);

// ── Test infra: fake req / res ────────────────────────────────────────────
function fakeReq(rawBody: Buffer, headers: Record<string, string> = {}): IncomingMessage {
  const stream = Readable.from([rawBody]) as unknown as IncomingMessage;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (stream as any).headers = headers;
  return stream;
}

interface CapturedRes {
  res: ServerResponse;
  status(): number;
  body(): string;
  done: Promise<void>;
}
function fakeRes(): CapturedRes {
  let status = 0;
  let body = '';
  let resolve: () => void = () => {};
  const done = new Promise<void>((r) => {
    resolve = r;
  });
  const e = new EventEmitter() as unknown as ServerResponse;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (e as any).writeHead = (s: number) => {
    status = s;
    return e;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (e as any).end = (chunk?: string) => {
    if (typeof chunk === 'string') body = chunk;
    resolve();
    return e;
  };
  return {
    res: e,
    status: () => status,
    body: () => body,
    done,
  };
}

// ── Fixture builders ──────────────────────────────────────────────────────
const SECRET = 'meta-app-secret-for-tests';
const PHONE_ID = 'phone-id-123';
const COMPANY_ID = 42;

function metaPayload(
  text = 'hello',
  opts: { messageId?: string; phoneNumberId?: string; from?: string } = {},
): object {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: opts.phoneNumberId ?? PHONE_ID },
              messages: [
                {
                  id: opts.messageId ?? 'msg-abc',
                  from: opts.from ?? '+15551234567',
                  type: 'text',
                  timestamp: '1700000000',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function sign(body: Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

// ── Tests ─────────────────────────────────────────────────────────────────
describe('webhookReceive (contract)', () => {
  const logger = createLogger('test-webhook');
  let handler: ReturnType<typeof makeWebhookReceiveHandler>;

  beforeEach(() => {
    handler = makeWebhookReceiveHandler(logger);
    botQueueAddMock.mockReset();
    botQueueAddMock.mockResolvedValue({ id: 'job-1' });
    lookupSecretMock.mockReset();
    lookupSecretMock.mockResolvedValue(SECRET);
    resolveCompanyMock.mockReset();
    resolveCompanyMock.mockResolvedValue(COMPANY_ID);
    getCredsMock.mockReset();
    getCredsMock.mockResolvedValue({ token: 'fake-token', phoneId: PHONE_ID });
    claimMessageIdMock.mockReset();
    claimMessageIdMock.mockResolvedValue(true);
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    // No queue drain needed — handler awaits botQueue.add inline before 200.
  });

  it('valid HMAC → 200 + process-text enqueued', async () => {
    const body = Buffer.from(JSON.stringify(metaPayload()));
    const sig = sign(body, SECRET);
    const r = fakeRes();
    await handler(
      fakeReq(body, { 'x-hub-signature-256': sig }),
      r.res,
    );
    await r.done;
    expect(r.status()).toBe(200);
    expect(botQueueAddMock).toHaveBeenCalledTimes(1);
    expect(botQueueAddMock).toHaveBeenCalledWith(
      'process-text',
      expect.objectContaining({
        customerPhone: '+15551234567',
        messageText: 'hello',
        companyId: COMPANY_ID,
      }),
    );
  });

  it('invalid HMAC → 403', async () => {
    const body = Buffer.from(JSON.stringify(metaPayload()));
    const r = fakeRes();
    await handler(
      fakeReq(body, { 'x-hub-signature-256': 'sha256=deadbeef' }),
      r.res,
    );
    await r.done;
    expect(r.status()).toBe(403);
    expect(botQueueAddMock).not.toHaveBeenCalled();
  });

  it('missing X-Hub-Signature-256 header → 403', async () => {
    const body = Buffer.from(JSON.stringify(metaPayload()));
    const r = fakeRes();
    await handler(fakeReq(body, {}), r.res);
    await r.done;
    expect(r.status()).toBe(403);
    expect(botQueueAddMock).not.toHaveBeenCalled();
  });

  it('missing app_secret for the phone_number_id → 403 (fail-closed)', async () => {
    lookupSecretMock.mockResolvedValue(null);
    const body = Buffer.from(JSON.stringify(metaPayload()));
    const r = fakeRes();
    await handler(
      fakeReq(body, { 'x-hub-signature-256': 'sha256=anything' }),
      r.res,
    );
    await r.done;
    expect(r.status()).toBe(403);
    expect(botQueueAddMock).not.toHaveBeenCalled();
  });

  it('malformed JSON → 200 (anti-flood)', async () => {
    const body = Buffer.from('{not json at all');
    const sig = sign(body, SECRET);
    const r = fakeRes();
    await handler(
      fakeReq(body, { 'x-hub-signature-256': sig }),
      r.res,
    );
    await r.done;
    expect(r.status()).toBe(200);
    expect(botQueueAddMock).not.toHaveBeenCalled();
  });

  it('payload with no phone_number_id (status callback) → 200', async () => {
    const body = Buffer.from(
      JSON.stringify({ entry: [{ changes: [{ value: { statuses: [] } }] }] }),
    );
    const sig = sign(body, SECRET);
    const r = fakeRes();
    await handler(
      fakeReq(body, { 'x-hub-signature-256': sig }),
      r.res,
    );
    await r.done;
    expect(r.status()).toBe(200);
    expect(botQueueAddMock).not.toHaveBeenCalled();
    // lookupAppSecret should NOT be called — short-circuited before it
    expect(lookupSecretMock).not.toHaveBeenCalled();
  });

  it('DB error during company lookup → 200 (anti-flood)', async () => {
    resolveCompanyMock.mockRejectedValue(new Error('pg connection lost'));
    const body = Buffer.from(JSON.stringify(metaPayload()));
    const sig = sign(body, SECRET);
    const r = fakeRes();
    await handler(
      fakeReq(body, { 'x-hub-signature-256': sig }),
      r.res,
    );
    await r.done;
    expect(r.status()).toBe(200);
    expect(botQueueAddMock).not.toHaveBeenCalled();
  });

  it('duplicate message_id → 200 + NOT enqueued', async () => {
    claimMessageIdMock.mockResolvedValue(false);
    const body = Buffer.from(JSON.stringify(metaPayload()));
    const sig = sign(body, SECRET);
    const r = fakeRes();
    await handler(
      fakeReq(body, { 'x-hub-signature-256': sig }),
      r.res,
    );
    await r.done;
    expect(r.status()).toBe(200);
    expect(botQueueAddMock).not.toHaveBeenCalled();
  });
});
