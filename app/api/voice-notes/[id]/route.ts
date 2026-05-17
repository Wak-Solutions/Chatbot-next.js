/**
 * GET /api/voice-notes/:id — port of
 * server/routes/messages.routes.ts:54-77.
 *
 * Streams the BYTEA payload from voice_notes back to the browser with
 * the original mime_type (allowlisted) and the same caching headers
 * the legacy server set:
 *
 *   Content-Type:  ogg / mpeg / wav / webm (allowlisted; falls back to
 *                  audio/ogg if the stored value isn't on the list)
 *   Cache-Control: private, max-age=86400
 *
 * Tenant-scoping comes from AuthContext.companyId; the id param flows
 * into the SQL via $1::uuid so a malformed id raises an exception that
 * we 500 on (matches the original).
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('messages');

const AUDIO_MIME_ALLOWLIST = new Set([
  'audio/ogg',
  'audio/mpeg',
  'audio/wav',
  'audio/webm',
]);

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ params: Promise<{ id: string }> }>(
  async (_request, auth, ctx) => {
    const { id } = await ctx.params;
    try {
      const result = await getPool().query<{ audio_data: Buffer; mime_type: string }>(
        'SELECT audio_data, mime_type FROM voice_notes WHERE id = $1::uuid AND company_id = $2',
        [id, auth.companyId],
      );
      if (result.rows.length === 0) {
        logger.warn({ id }, 'Voice note not found');
        return NextResponse.json({ message: 'Voice note not found' }, { status: 404 });
      }
      const { audio_data, mime_type } = result.rows[0];
      const safeType = AUDIO_MIME_ALLOWLIST.has(mime_type) ? mime_type : 'audio/ogg';
      return new NextResponse(new Uint8Array(audio_data), {
        headers: {
          'Content-Type': safeType,
          'Cache-Control': 'private, max-age=86400',
        },
      });
    } catch (err) {
      logger.error({ id, err: (err as Error)?.message }, 'getVoiceNote failed');
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  },
);
