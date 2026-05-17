import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the new (post-PR 15) tree.
 *
 * - environment: 'node'. No DOM. UI tests are out of scope per the brief.
 * - pool: 'forks'. Each test file in its own process so `vi.mock()`
 *   hoisting doesn't bleed across files. Matches the old config's pool.
 * - alias: '@/*' resolves to repo root, mirroring tsconfig.json so source
 *   imports work unchanged in tests.
 * - include: tests/**\/*.test.ts only. Source files don't get picked up
 *   as tests even if they contain describe/it (none do).
 * - testTimeout: 30s — accommodates integration tests that wait on a real
 *   Postgres pool. Unit tests are fast and won't trip this.
 * - setupFiles: tests/helpers/setup.ts loads .env (so DATABASE_URL is
 *   visible to integration tests when set).
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ['tests/helpers/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
