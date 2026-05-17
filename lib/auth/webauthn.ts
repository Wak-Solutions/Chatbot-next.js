/**
 * WebAuthn wrapper over @simplewebauthn/server.
 *
 * RP_ID / RP_ORIGIN come from env (validated lazily here so this module
 * doesn't force every consumer to load the full app env). When neither is
 * set, callers can fall back to per-request derivation — see
 * deriveRpFromRequest() — which matches the legacy getRpId/getRpOrigin
 * helpers at server/routes/auth.routes.ts:35-44.
 *
 * Verification surfaces a discriminated result rather than throwing.
 * RP-ID / origin mismatches are coalesced into a single
 * WEBAUTHN_RP_MISMATCH error code — PR 10 wires up the login-page UX.
 *
 * Challenges live in session.webauthnChallenge; callers persist them
 * around the option/verify round-trip themselves. This wrapper is pure.
 */

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type GenerateAuthenticationOptionsOpts,
  type GenerateRegistrationOptionsOpts,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifyAuthenticationResponseOpts,
  type VerifyRegistrationResponseOpts,
} from '@simplewebauthn/server';
import { z } from 'zod';

export const RP_NAME = 'WAK Solutions Agent';

const webauthnEnvSchema = z.object({
  RP_ID: z.string().min(1).optional(),
  RP_ORIGIN: z.string().url().optional(),
});

export interface RpContext {
  rpId: string;
  rpOrigin: string;
}

/**
 * Read RP_ID/RP_ORIGIN from env. Returns nulls when unset — callers can
 * pass a request-derived RpContext to deriveRpFromRequest() instead.
 */
export function readRpFromEnv(source: NodeJS.ProcessEnv = process.env): Partial<RpContext> {
  const parsed = webauthnEnvSchema.parse(source);
  return { rpId: parsed.RP_ID, rpOrigin: parsed.RP_ORIGIN };
}

export interface RequestRpHints {
  hostname: string;
  protocol: string;
}

export function deriveRpFromRequest(hints: RequestRpHints): RpContext {
  const env = readRpFromEnv();
  const rpId = env.rpId ?? hints.hostname;
  const rpOrigin = env.rpOrigin ?? `${hints.protocol}://${hints.hostname}`;
  return { rpId, rpOrigin };
}

export type RegistrationOptions = Awaited<ReturnType<typeof generateRegistrationOptions>>;
export type AuthenticationOptions = Awaited<ReturnType<typeof generateAuthenticationOptions>>;

export interface BuildRegistrationOptionsInput {
  rp: RpContext;
  agentId: number;
  agentName: string;
  excludeCredentialIds?: string[];
}

export async function buildRegistrationOptions(
  input: BuildRegistrationOptionsInput,
): Promise<RegistrationOptions> {
  const opts: GenerateRegistrationOptionsOpts = {
    rpName: RP_NAME,
    rpID: input.rp.rpId,
    userID: new TextEncoder().encode(String(input.agentId)),
    userName: input.agentName || 'agent',
    attestationType: 'none',
    excludeCredentials: (input.excludeCredentialIds ?? []).map((id) => ({ id })),
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
      userVerification: 'required',
    },
  };
  return generateRegistrationOptions(opts);
}

export interface BuildAuthenticationOptionsInput {
  rp: RpContext;
  allowCredentialIds?: string[];
}

export async function buildAuthenticationOptions(
  input: BuildAuthenticationOptionsInput,
): Promise<AuthenticationOptions> {
  const opts: GenerateAuthenticationOptionsOpts = {
    rpID: input.rp.rpId,
    allowCredentials: (input.allowCredentialIds ?? []).map((id) => ({ id })),
    userVerification: 'required',
  };
  return generateAuthenticationOptions(opts);
}

export type WebauthnErrorCode =
  | 'WEBAUTHN_NO_CHALLENGE'
  | 'WEBAUTHN_VERIFICATION_FAILED'
  | 'WEBAUTHN_RP_MISMATCH'
  | 'WEBAUTHN_INTERNAL';

export type VerifyResult<T> =
  | { ok: true; info: T }
  | { ok: false; code: WebauthnErrorCode; message: string };

function classifyError(err: unknown): { code: WebauthnErrorCode; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  // @simplewebauthn/server throws plain Errors. RP-ID mismatches mention
  // "Unexpected RP ID"; origin mismatches mention "Unexpected ... origin".
  if (/Unexpected RP ID|Unexpected (authentication|registration) response origin|origin.+expected/i.test(message)) {
    return { code: 'WEBAUTHN_RP_MISMATCH', message };
  }
  return { code: 'WEBAUTHN_VERIFICATION_FAILED', message };
}

export interface VerifyRegistrationInput {
  rp: RpContext;
  expectedChallenge: string | undefined;
  response: VerifyRegistrationResponseOpts['response'];
}

export async function verifyRegistration(
  input: VerifyRegistrationInput,
): Promise<VerifyResult<VerifiedRegistrationResponse>> {
  if (!input.expectedChallenge) {
    return { ok: false, code: 'WEBAUTHN_NO_CHALLENGE', message: 'No pending registration challenge' };
  }
  try {
    const info = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.rp.rpOrigin,
      expectedRPID: input.rp.rpId,
    });
    if (!info.verified) {
      return { ok: false, code: 'WEBAUTHN_VERIFICATION_FAILED', message: 'Verification failed' };
    }
    return { ok: true, info };
  } catch (err) {
    return { ok: false, ...classifyError(err) };
  }
}

export interface VerifyAuthenticationInput {
  rp: RpContext;
  expectedChallenge: string | undefined;
  response: VerifyAuthenticationResponseOpts['response'];
  credential: VerifyAuthenticationResponseOpts['credential'];
}

export async function verifyAuthentication(
  input: VerifyAuthenticationInput,
): Promise<VerifyResult<VerifiedAuthenticationResponse>> {
  if (!input.expectedChallenge) {
    return { ok: false, code: 'WEBAUTHN_NO_CHALLENGE', message: 'No pending login challenge' };
  }
  try {
    const info = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.rp.rpOrigin,
      expectedRPID: input.rp.rpId,
      credential: input.credential,
    });
    if (!info.verified) {
      return { ok: false, code: 'WEBAUTHN_VERIFICATION_FAILED', message: 'Verification failed' };
    }
    return { ok: true, info };
  } catch (err) {
    return { ok: false, ...classifyError(err) };
  }
}
