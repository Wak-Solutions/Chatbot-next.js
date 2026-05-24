/**
 * XState menu navigation machine.
 *
 * Tracks the customer's position in the menu tree as a `path: number[]`
 * context — a sequence of 0-based indices, e.g. [1, 0] means the customer
 * chose option 2 at the top level then option 1 at the next level.
 *
 * The machine itself is intentionally simple: a single `navigating` state
 * with a `SELECT` event that appends the chosen index. Display logic (which
 * labels to show, whether a node is a leaf) lives in handler.ts and uses
 * the path to walk the MenuNode[] tree from config.ts — this keeps the
 * machine pure and easy to test without a DB.
 *
 * Persisting via getPersistedSnapshot() / createActor({ snapshot }) makes
 * state ready for Redis storage when needed.
 */

import { createMachine, assign } from 'xstate';

export const menuMachine = createMachine({
  id: 'menu',
  types: {} as {
    context: { path: number[] };
    events: { type: 'SELECT'; index: number };
  },
  context: { path: [] },
  initial: 'navigating',
  states: {
    navigating: {
      on: {
        SELECT: {
          actions: assign({
            path: ({ context, event }) => [...context.path, event.index],
          }),
        },
      },
    },
  },
});
