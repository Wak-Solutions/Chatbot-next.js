/**
 * Global Vitest setup. Loaded once per test process via the
 * setupFiles entry in vitest.config.ts.
 *
 * Currently only loads .env so DATABASE_URL (and SESSION_SECRET for
 * cookie tests) are visible to tests that need them. Integration tests
 * skip themselves cleanly when DATABASE_URL isn't set.
 */
import 'dotenv/config';

// Defensive default for SESSION_SECRET — cookie tests need a non-empty
// secret. Real production secret is provided via .env; this is a fallback
// for CI runners that don't bother to set one.
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET =
    'test-only-session-secret-must-be-32-chars-long-or-more';
}
