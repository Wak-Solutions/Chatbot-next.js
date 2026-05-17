/**
 * lib/auth/cookies — signSid / verifySid wire compatibility.
 *
 * The signed-cookie format must stay byte-identical to express-session's
 * `cookie-signature@1.x` so existing prod sessions verify after cutover.
 * We check that directly: sign with our implementation, sign with the
 * upstream package, compare the strings.
 */
import { describe, expect, it } from 'vitest';
import { sign as cookieSign } from 'cookie-signature';
import { signSid, verifySid } from '@/lib/auth/cookies';

const SECRET = 'test-only-session-secret-must-be-32-chars-long-or-more';

describe('signSid / verifySid', () => {
  it('is byte-compatible with cookie-signature@1.x output (s:<sid>.<sig>)', () => {
    const sid = 'abc123def456';
    const ours = signSid(sid, SECRET);
    const theirs = `s:${cookieSign(sid, SECRET)}`;
    expect(ours).toBe(theirs);
  });

  it('round-trips: verifySid(signSid(sid)) === sid', () => {
    const sid = 'user-session-id-9001';
    const signed = signSid(sid, SECRET);
    expect(verifySid(signed, SECRET)).toBe(sid);
  });

  it('returns null for a tampered signature', () => {
    const sid = 'tamper-target';
    const signed = signSid(sid, SECRET);
    const tampered = signed.slice(0, -2) + 'XX';
    expect(verifySid(tampered, SECRET)).toBeNull();
  });

  it('returns null for a tampered sid', () => {
    const sid = 'original-sid';
    const signed = signSid(sid, SECRET);
    // Swap the sid portion to a different value while keeping the old sig.
    const dot = signed.lastIndexOf('.');
    const fakeSid = 'attacker-sid';
    const forged = `s:${fakeSid}${signed.slice(dot)}`;
    expect(verifySid(forged, SECRET)).toBeNull();
  });

  it('returns null when the wrong secret is used to verify', () => {
    const sid = 'wrong-secret-test';
    const signed = signSid(sid, SECRET);
    expect(
      verifySid(signed, 'different-secret-also-32-chars-long-blah'),
    ).toBeNull();
  });

  it('returns null for input missing the s: prefix', () => {
    expect(verifySid('abc.def', SECRET)).toBeNull();
  });

  it('returns null for malformed input (no dot)', () => {
    expect(verifySid('s:nodothere', SECRET)).toBeNull();
  });

  it('returns null for non-string input', () => {
    // @ts-expect-error — intentional bad input
    expect(verifySid(undefined, SECRET)).toBeNull();
    // @ts-expect-error — intentional bad input
    expect(verifySid(null, SECRET)).toBeNull();
  });

  it('produces the documented base64-without-padding signature', () => {
    const signed = signSid('x', SECRET);
    const sig = signed.split('.').pop() ?? '';
    expect(sig.endsWith('=')).toBe(false);
  });
});
