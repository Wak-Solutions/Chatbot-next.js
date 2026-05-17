/**
 * lib/db/locks — lockKey() determinism + collision resistance.
 *
 * The advisory-lock key MUST be deterministic across processes (the
 * dashboard's /api/send and the worker both compute it from the same
 * string), and well-distributed enough that distinct names don't all
 * collide on a tiny subset of the int64 space.
 */
import { describe, expect, it } from 'vitest';
import { lockKey } from '@/lib/db/locks';

describe('lockKey', () => {
  it('is deterministic — same input → same bigint, 100 iterations', () => {
    const name = 'convo:42:+15551234567';
    const first = lockKey(name);
    for (let i = 0; i < 100; i++) {
      expect(lockKey(name)).toBe(first);
    }
  });

  it('returns a bigint that fits in a signed 64-bit Postgres bigint', () => {
    const k = lockKey('any-name');
    expect(typeof k).toBe('bigint');
    // PG bigint range
    expect(k >= -(2n ** 63n)).toBe(true);
    expect(k <= 2n ** 63n - 1n).toBe(true);
  });

  it('1000 distinct names produce 1000 distinct keys (no collisions)', () => {
    const keys = new Set<bigint>();
    for (let i = 0; i < 1000; i++) {
      keys.add(lockKey(`convo:1:phone-${i}`));
    }
    expect(keys.size).toBe(1000);
  });

  it('different names produce different keys', () => {
    expect(lockKey('convo:1:+15551234567')).not.toBe(
      lockKey('convo:1:+15551234568'),
    );
    expect(lockKey('convo:1:phone')).not.toBe(lockKey('convo:2:phone'));
  });
});
