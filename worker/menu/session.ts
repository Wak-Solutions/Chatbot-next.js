/**
 * XState-backed menu navigation session store. Drop-in replacement for
 * state.ts — exports the same getState / setState / clearState / MAX_STATES
 * interface so handler.ts only needs its import path changed.
 *
 * State is stored as a persisted XState snapshot (JSON-safe object) so it
 * can later be moved to Redis without changing the handler or machine code.
 *
 * LRU eviction at MAX_STATES = 10_000 matches the old state.ts ceiling.
 * Conversation scoping: a session is only returned when its stored
 * conversationId matches the current one — new 24-hour sessions
 * self-invalidate on the next read.
 */

import { createActor } from 'xstate';
import { menuMachine } from './machine';

export const MAX_STATES = 10_000;

export interface MenuState {
  /** 0-based index path through the tree, e.g. [0, 1]. */
  path: number[];
  /** Scopes the session to the active 24-hour conversation. */
  conversationId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PersistedSnapshot = any;

interface Entry {
  snapshot: PersistedSnapshot;
  conversationId: string;
}

const sessions = new Map<string, Entry>();

function key(phone: string, companyId: number): string {
  return `${companyId}:${phone}`;
}

function makeActor(snapshot?: PersistedSnapshot) {
  const actor = createActor(menuMachine, snapshot ? { snapshot } : undefined);
  actor.start();
  return actor;
}

export function getState(
  phone: string,
  companyId: number,
  conversationId: string,
): MenuState | null {
  const k = key(phone, companyId);
  const entry = sessions.get(k);
  if (!entry || entry.conversationId !== conversationId) return null;
  // LRU bump
  sessions.delete(k);
  sessions.set(k, entry);
  const actor = makeActor(entry.snapshot);
  const path = [...actor.getSnapshot().context.path];
  actor.stop();
  return { path, conversationId };
}

export function setState(
  phone: string,
  companyId: number,
  state: MenuState,
): void {
  // Replay SELECT events to reach the target path from a fresh machine.
  const actor = makeActor();
  for (const idx of state.path) {
    actor.send({ type: 'SELECT', index: idx });
  }
  const snapshot = actor.getPersistedSnapshot();
  actor.stop();
  const k = key(phone, companyId);
  sessions.delete(k);
  sessions.set(k, { snapshot, conversationId: state.conversationId });
  if (sessions.size > MAX_STATES) {
    const oldest = sessions.keys().next().value;
    if (oldest !== undefined) sessions.delete(oldest);
  }
}

export function clearState(phone: string, companyId: number): void {
  sessions.delete(key(phone, companyId));
}
