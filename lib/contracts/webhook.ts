/**
 * Zod schemas for the Meta WhatsApp Business webhook payload shape.
 *
 * Scope: tight to what the legacy Python worker reads (see
 * Chatbot/routes/webhook.py). Unknown fields are allowed via .passthrough()
 * so Meta extending the payload doesn't break parsing — we only fail when
 * a field the worker actually depends on is missing or malformed.
 *
 * Shape (per Meta docs / observed payloads):
 *   {
 *     object: "whatsapp_business_account",
 *     entry: [{
 *       id: string,
 *       changes: [{
 *         field: "messages",
 *         value: {
 *           messaging_product: "whatsapp",
 *           metadata: { display_phone_number, phone_number_id },
 *           contacts?: [{ profile: { name }, wa_id }],
 *           messages?: [...],
 *           statuses?: [...],
 *         }
 *       }]
 *     }]
 *   }
 *
 * Also exports the verify-GET querystring schema used by the webhook
 * handshake endpoint (?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…).
 */

import { z } from 'zod';

export const webhookVerifyQuerySchema = z.object({
  'hub.mode': z.literal('subscribe'),
  'hub.verify_token': z.string().min(1),
  'hub.challenge': z.string().min(1),
});

export const webhookMetadataSchema = z
  .object({
    display_phone_number: z.string().optional(),
    phone_number_id: z.string().min(1),
  })
  .passthrough();

export const webhookContactSchema = z
  .object({
    wa_id: z.string().optional(),
    profile: z.object({ name: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const textMessageSchema = z
  .object({
    type: z.literal('text'),
    id: z.string(),
    from: z.string().min(1),
    timestamp: z.string(),
    text: z.object({ body: z.string() }).passthrough(),
  })
  .passthrough();

const audioMessageSchema = z
  .object({
    type: z.literal('audio'),
    id: z.string(),
    from: z.string().min(1),
    timestamp: z.string(),
    audio: z
      .object({
        id: z.string(),
        mime_type: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

// Any other message type the worker doesn't specifically handle — captured
// here so the parser doesn't reject the whole payload over an interactive,
// image, sticker, button, etc. Type is required; everything else is open.
const otherMessageSchema = z
  .object({
    type: z.string(),
    id: z.string(),
    from: z.string().min(1),
    timestamp: z.string(),
  })
  .passthrough();

export const webhookMessageSchema = z.union([
  textMessageSchema,
  audioMessageSchema,
  otherMessageSchema,
]);

export const webhookStatusSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    timestamp: z.string(),
    recipient_id: z.string().optional(),
  })
  .passthrough();

export const webhookValueSchema = z
  .object({
    messaging_product: z.literal('whatsapp').optional(),
    metadata: webhookMetadataSchema,
    contacts: z.array(webhookContactSchema).optional(),
    messages: z.array(webhookMessageSchema).optional(),
    statuses: z.array(webhookStatusSchema).optional(),
  })
  .passthrough();

export const webhookChangeSchema = z
  .object({
    field: z.string(),
    value: webhookValueSchema,
  })
  .passthrough();

export const webhookEntrySchema = z
  .object({
    id: z.string(),
    changes: z.array(webhookChangeSchema).min(1),
  })
  .passthrough();

export const webhookPayloadSchema = z
  .object({
    object: z.literal('whatsapp_business_account'),
    entry: z.array(webhookEntrySchema).min(1),
  })
  .passthrough();

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
export type WebhookValue = z.infer<typeof webhookValueSchema>;
export type WebhookMessage = z.infer<typeof webhookMessageSchema>;
export type WebhookStatus = z.infer<typeof webhookStatusSchema>;
export type WebhookVerifyQuery = z.infer<typeof webhookVerifyQuerySchema>;
