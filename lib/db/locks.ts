/**
 * Deterministic Postgres advisory-lock key derivation.
 *
 * pg_advisory_lock / pg_try_advisory_lock take a signed 64-bit bigint.
 * To turn an arbitrary string (e.g. "meeting-reminders:tick") into a
 * stable key, we SHA-256 the name and read the first 8 bytes big-endian
 * as a signed BigInt64. Same input → same key, always.
 *
 * Postgres bigint is signed; readBigInt64BE matches that signedness so
 * the value round-trips correctly through the wire protocol.
 */

import { createHash } from 'node:crypto';

export function lockKey(name: string): bigint {
  const digest = createHash('sha256').update(name, 'utf8').digest();
  return digest.readBigInt64BE(0);
}
