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

import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { generateText } from 'ai';
import { getProvider, getTranscribeModelId } from '@/lib/llm/provider';

const logger = createLogger('voice');

/**
 * Transcode arbitrary input audio (WhatsApp sends OGG/Opus) to mono 16 kHz
 * MP3. The transcription model is reached via OpenRouter's OpenAI-compatible
 * chat-audio path, which only accepts wav/mp3 — OGG is rejected before it
 * even sends. MP3 mono 16 kHz is the standard speech-recognition format and
 * loses no detail the model needs. Streams via stdin/stdout (no temp files).
 */
async function transcodeToMp3(input: Buffer): Promise<Buffer> {
  if (!ffmpegPath) throw new Error('ffmpeg binary not found (ffmpeg-static)');
  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn(ffmpegPath as string, [
      '-i', 'pipe:0',
      '-ac', '1',
      '-ar', '16000',
      '-f', 'mp3',
      'pipe:1',
    ]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on('data', (d: Buffer) => out.push(d));
    proc.stderr.on('data', (d: Buffer) => err.push(d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(err).toString().slice(-300)}`));
    });
    // Ignore EPIPE if ffmpeg exits before we finish writing.
    proc.stdin.on('error', () => {});
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

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
    // Convert OGG/Opus (and anything else) → MP3 so the OpenRouter chat-audio
    // path accepts it; sending the original OGG fails before it leaves here.
    const mp3 = await transcodeToMp3(bytes);
    logger.info({ inBytes: bytes.length, mp3Bytes: mp3.length }, 'Audio transcoded to mp3');

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
            { type: 'file', data: new Uint8Array(mp3), mediaType: 'audio/mpeg' },
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

/**
 * Download an audio file from a URL and transcribe it. Used by the Bread
 * Crumbs path, where a voice note arrives as a hosted audio URL (their blob
 * storage) instead of a Meta media id. Returns null when the URL isn't audio,
 * is too large, or transcription fails — the caller then falls back to the
 * original content. The caller is responsible for restricting which hosts may
 * be fetched (SSRF).
 */
export async function transcribeAudioUrl(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, 'transcribeAudioUrl — fetch failed');
      return null;
    }
    const mime = (resp.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!mime.startsWith('audio/')) {
      logger.info({ mime }, 'transcribeAudioUrl — not audio, skipping');
      return null;
    }
    const bytes = Buffer.from(await resp.arrayBuffer());
    if (bytes.length > MAX_AUDIO_BYTES) {
      logger.warn({ sizeBytes: bytes.length, limit: MAX_AUDIO_BYTES }, 'transcribeAudioUrl — too large');
      return null;
    }
    const text = await transcribeWithWhisper(bytes, mime);
    return text || null;
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, 'transcribeAudioUrl — failed');
    return null;
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
