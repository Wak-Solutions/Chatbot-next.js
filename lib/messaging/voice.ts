/**
 * WhatsApp voice-note pipeline — port of Chatbot/transcribe.py +
 * Chatbot/_db_voice_notes.py.
 *
 *   downloadMediaFromMeta(mediaId, token) — Meta Graph v21.0 two-step
 *     resolve-then-fetch. Enforces a 20 MB ceiling (10s timeout for
 *     metadata, 30s for the audio fetch).
 *
 *   transcribeWithWhisper(bytes, mime) — OpenAI Whisper. Uses the
 *     globally-available File constructor (Node 20+). Per Q-2 in the
 *     Phase 2 review.
 *
 *   storeVoiceNote(bytes, mime, companyId) — INSERT into voice_notes,
 *     returns the row's UUID. The dashboard reads this via the PR 5
 *     /api/voice-notes/[id] route. BYTEA storage is the same shape the
 *     legacy code uses (CR-017 acknowledges S3 as a future migration).
 */

import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { generateText } from 'ai';
import { getProvider, getTranscribeModelId } from '@/lib/llm/provider';

const logger = createLogger('voice');

const GRAPH_VERSION = 'v21.0';
const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // 20 MB; Whisper hard limit is 25 MB.

const MIME_TO_EXT: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/ogg; codecs=opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'mp4',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
};

function extFor(mime: string): string {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  return MIME_TO_EXT[base] ?? MIME_TO_EXT[mime.toLowerCase()] ?? 'ogg';
}

export interface DownloadResult {
  bytes: Buffer;
  mimeType: string;
}

export class VoiceDownloadError extends Error {
  constructor(
    message: string,
    public readonly kind: 'too_large' | 'no_url' | 'http' | 'unknown',
  ) {
    super(message);
    this.name = 'VoiceDownloadError';
  }
}

export async function downloadMediaFromMeta(
  mediaId: string,
  token: string,
): Promise<DownloadResult> {
  const headers = { Authorization: `Bearer ${token}` };

  const metaRes = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`,
    { headers, signal: AbortSignal.timeout(10_000) },
  );
  if (!metaRes.ok) {
    throw new VoiceDownloadError(`Meta metadata HTTP ${metaRes.status}`, 'http');
  }
  const meta = (await metaRes.json()) as {
    url?: string;
    mime_type?: string;
    file_size?: number;
  };

  const cdnUrl = meta.url;
  const mimeType = meta.mime_type ?? 'audio/ogg';
  const fileSize = meta.file_size ?? 0;

  logger.info(
    { mediaId, mime: mimeType, sizeBytes: fileSize || 'unknown' },
    'Media metadata',
  );

  if (!cdnUrl) {
    throw new VoiceDownloadError(`No CDN URL for media_id=${mediaId}`, 'no_url');
  }
  if (fileSize > MAX_AUDIO_BYTES) {
    logger.warn(
      { sizeBytes: fileSize, limit: MAX_AUDIO_BYTES },
      'Audio too large before download',
    );
    throw new VoiceDownloadError(
      `Voice note too large: ${fileSize} bytes (limit ${MAX_AUDIO_BYTES})`,
      'too_large',
    );
  }

  const audioRes = await fetch(cdnUrl, {
    headers,
    signal: AbortSignal.timeout(30_000),
    redirect: 'follow',
  });
  if (!audioRes.ok) {
    throw new VoiceDownloadError(`Meta audio HTTP ${audioRes.status}`, 'http');
  }
  const arr = await audioRes.arrayBuffer();
  const bytes = Buffer.from(arr);

  if (bytes.length > MAX_AUDIO_BYTES) {
    logger.warn(
      { sizeBytes: bytes.length, limit: MAX_AUDIO_BYTES },
      'Audio too large after download',
    );
    throw new VoiceDownloadError(
      `Voice note too large after download: ${bytes.length} bytes`,
      'too_large',
    );
  }

  logger.info(
    { mediaId, sizeBytes: bytes.length, mime: mimeType },
    'Audio downloaded',
  );
  return { bytes, mimeType };
}

/**
 * Transcribe a voice note. OpenRouter has no dedicated transcription
 * endpoint, so we send the audio to a multimodal chat model (audio input)
 * routed through OpenRouter — Gemini Flash by default (see
 * getTranscribeModelId). Function name kept for caller compatibility.
 */
export async function transcribeWithWhisper(bytes: Buffer, mime: string): Promise<string> {
  const ext = extFor(mime);
  logger.info({ sizeBytes: bytes.length, ext, mime, model: getTranscribeModelId() }, 'Transcription request');

  try {
    const result = await generateText({
      model: getProvider().chat(getTranscribeModelId()),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Transcribe this audio verbatim in its original language. Output only the transcription text — no translation, no commentary, no quotes.',
            },
            { type: 'file', data: new Uint8Array(bytes), mediaType: mime },
          ],
        },
      ],
      abortSignal: AbortSignal.timeout(30_000),
    });
    const text = (result.text ?? '').trim();
    if (text) {
      logger.info(
        { sizeBytes: bytes.length, resultChars: text.length },
        'Transcription success',
      );
    } else {
      logger.info({ sizeBytes: bytes.length }, 'Transcription returned empty');
    }
    return text;
  } catch (err) {
    logger.error(
      { sizeBytes: bytes.length, err: (err as Error)?.message },
      'Transcription failed',
    );
    throw err;
  }
}

export async function storeVoiceNote(
  bytes: Buffer,
  mime: string,
  companyId: number,
): Promise<string> {
  try {
    const r = await getPool().query<{ id: string }>(
      `INSERT INTO voice_notes (audio_data, mime_type, company_id)
       VALUES ($1, $2, $3)
       RETURNING id::text`,
      [bytes, mime, companyId],
    );
    const id = r.rows[0].id;
    logger.info(
      { id: id.slice(0, 8) + '…', sizeBytes: bytes.length, mime },
      'Voice note stored',
    );
    return id;
  } catch (err) {
    logger.error(
      { mime, err: (err as Error)?.message },
      'storeVoiceNote failed',
    );
    throw err;
  }
}
