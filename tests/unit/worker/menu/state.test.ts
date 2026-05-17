/**
 * worker/menu/state — in-memory LRU keyed by (phone, companyId).
 *
 * Verifies:
 *   - MAX_STATES + 1 inserts evicts the oldest (LRU)
 *   - getState bumps recency
 *   - conversation_id mismatch returns null
 *   - clearState removes the entry
 *
 * The module holds module-scoped state, so we run all assertions in a
 * single file (vitest pool: forks isolates per file).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_STATES,
  clearState,
  getState,
  setState,
} from '@/worker/menu/state';

const CID = 'conv-1';
const CID2 = 'conv-2';
const COMPANY = 42;

function clean(phones: string[]): void {
  for (const p of phones) clearState(p, COMPANY);
}

describe('menu state', () => {
  afterEach(() => {
    // Best-effort cleanup of small ad-hoc fixtures (LRU eviction handles
    // the bulk-insert test). We don't try to clear all MAX_STATES entries
    // — they'll age out as later inserts push them.
    clean(['p:a', 'p:b', 'p:c', 'p:scoped', 'p:bumped', 'p:cleared']);
  });

  it('round-trips state for a (phone, companyId, conversationId)', () => {
    setState('p:a', COMPANY, { path: [0, 1], conversationId: CID });
    const got = getState('p:a', COMPANY, CID);
    expect(got).toEqual({ path: [0, 1], conversationId: CID });
  });

  it('returns null when the conversationId no longer matches (session rolled over)', () => {
    setState('p:scoped', COMPANY, { path: [2], conversationId: CID });
    expect(getState('p:scoped', COMPANY, CID2)).toBeNull();
  });

  it('clearState removes the entry', () => {
    setState('p:cleared', COMPANY, { path: [0], conversationId: CID });
    clearState('p:cleared', COMPANY);
    expect(getState('p:cleared', COMPANY, CID)).toBeNull();
  });

  it('LRU: inserting MAX_STATES + 1 evicts the first-inserted entry', () => {
    // Insert MAX_STATES + 1 entries. Use a unique companyId so this test's
    // fixtures don't collide with the others.
    const EVICT_CO = 9_999_999;
    setState('victim', EVICT_CO, { path: [0], conversationId: CID });
    for (let i = 0; i < MAX_STATES; i++) {
      setState(`bulk-${i}`, EVICT_CO, { path: [0], conversationId: CID });
    }
    expect(getState('victim', EVICT_CO, CID)).toBeNull();
    // A recent insert is still there.
    expect(getState(`bulk-${MAX_STATES - 1}`, EVICT_CO, CID)).not.toBeNull();
    // Clean up: clearState the bulk + the victim we just inserted.
    clearState('victim', EVICT_CO);
    for (let i = 0; i < MAX_STATES; i++) {
      clearState(`bulk-${i}`, EVICT_CO);
    }
  }, 60_000);

  it('getState bumps recency (LRU touch)', () => {
    const BUMP_CO = 9_999_998;
    setState('first', BUMP_CO, { path: [0], conversationId: CID });
    // Fill the rest of the cache so 'first' is at risk of eviction.
    for (let i = 0; i < MAX_STATES - 1; i++) {
      setState(`bump-${i}`, BUMP_CO, { path: [0], conversationId: CID });
    }
    // Touch 'first' — it should now be MRU.
    expect(getState('first', BUMP_CO, CID)).not.toBeNull();
    // One more insert pushes the cache to MAX_STATES + 1 → oldest evicted.
    // Since we just touched 'first', the oldest is now 'bump-0', not 'first'.
    setState('newcomer', BUMP_CO, { path: [0], conversationId: CID });
    expect(getState('first', BUMP_CO, CID)).not.toBeNull();
    expect(getState('bump-0', BUMP_CO, CID)).toBeNull();
    // Clean up
    clearState('first', BUMP_CO);
    clearState('newcomer', BUMP_CO);
    for (let i = 0; i < MAX_STATES - 1; i++) {
      clearState(`bump-${i}`, BUMP_CO);
    }
  }, 60_000);
});
