/**
 * Menu navigation state — in-memory LRU keyed by (phone, companyId).
 * Port of Chatbot/menu/_state.py verbatim. MAX_STATES = 10_000.
 *
 * conversation_id scoping: state is only returned when it belongs to
 * the current 24-hour conversation. When a new session starts (the
 * conversation_id rolls over), the old state self-invalidates on the
 * next read instead of leaking across sessions.
 */

export const MAX_STATES = 10_000;

export interface MenuState {
  /** 0-based index path through the tree, e.g. [0, 1]. */
  path: number[];
  /** Scopes state to the active 24-hour session. */
  conversationId: string;
}

const states: Map<string, MenuState> = new Map();

function keyFor(phone: string, companyId: number): string {
  return `${companyId}:${phone}`;
}

export function getState(
  phone: string,
  companyId: number,
  conversationId: string,
): MenuState | null {
  const key = keyFor(phone, companyId);
  const s = states.get(key);
  if (!s || s.conversationId !== conversationId) return null;
  // LRU bump
  states.delete(key);
  states.set(key, s);
  return s;
}

export function setState(
  phone: string,
  companyId: number,
  state: MenuState,
): void {
  const key = keyFor(phone, companyId);
  states.delete(key);
  states.set(key, state);
  if (states.size > MAX_STATES) {
    const oldest = states.keys().next().value;
    if (oldest !== undefined) states.delete(oldest);
  }
}

export function clearState(phone: string, companyId: number): void {
  states.delete(keyFor(phone, companyId));
}
