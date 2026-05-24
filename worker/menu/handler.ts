/**
 * Menu navigator — port of Chatbot/menu/_handler.py.
 *
 * Public API:
 *
 *   formatTopLevel(companyId)
 *       — return the top-level menu as a numbered string, or null if
 *         no menu is configured. Side-effect-free.
 *
 *   start(phone, companyId, conversationId)
 *       — reset navigation to the top level for this customer.
 *         Returns the formatted top-level menu, or null if no menu.
 *
 *   handle(phone, companyId, message, conversationId)
 *       — process one customer turn during menu navigation.
 *         Returns [reply, leafLabel]. reply is non-null when the
 *         navigator handled the turn; null means "fall through to the
 *         OpenAI path". leafLabel is always null in this port (the
 *         legacy code set it on leaf reach, but the deterministic 1/2
 *         next-step menu now replaces that signal).
 */

import { createLogger } from '@/lib/logger';
import { loadMenuConfig, type MenuNode } from './config';
import { clearState, getState, setState } from './session';

const logger = createLogger('menu-handler');

type Node = string | MenuNode;

function labelOf(node: Node): string {
  return typeof node === 'string' ? node : node.label || '';
}

function childrenOf(node: Node): Node[] {
  if (typeof node === 'string') return [];
  return node.subItems ?? [];
}

function formatLevel(nodes: Node[], header?: string): string {
  const lines: string[] = [];
  if (header) lines.push(header);
  nodes.forEach((n, i) => lines.push(`${i + 1}. ${labelOf(n)}`));
  return lines.join('\n');
}

export async function formatTopLevel(companyId: number): Promise<string | null> {
  const items = await loadMenuConfig(companyId);
  if (items.length === 0) return null;
  return formatLevel(items);
}

export async function start(
  phone: string,
  companyId: number,
  conversationId: string,
): Promise<string | null> {
  const items = await loadMenuConfig(companyId);
  if (items.length === 0) return null;
  setState(phone, companyId, { path: [], conversationId });
  return formatLevel(items);
}

export async function handle(
  phone: string,
  companyId: number,
  message: string,
  conversationId: string,
): Promise<[string | null, string | null]> {
  const items = await loadMenuConfig(companyId);
  if (items.length === 0) return [null, null];

  const state = getState(phone, companyId, conversationId);
  if (state === null) return [null, null];

  const text = message.trim();

  // Non-numeric input exits the menu and falls through to the LLM.
  if (!/^\d+$/.test(text)) {
    clearState(phone, companyId);
    return [null, null];
  }

  // Resolve current level's nodes by walking the stored path.
  let currentNodes: Node[] = items as Node[];
  for (const idx of state.path) {
    currentNodes = childrenOf(currentNodes[idx]);
  }

  const choice = parseInt(text, 10);
  if (choice < 1 || choice > currentNodes.length) {
    const reply = formatLevel(
      currentNodes,
      `Please choose a valid option (1–${currentNodes.length}):`,
    );
    return [reply, null];
  }

  const selected = currentNodes[choice - 1];
  const newPath = state.path.concat(choice - 1);

  // Build human-readable breadcrumb for the chosen path.
  let breadcrumbNodes: Node[] = items as Node[];
  const labels: string[] = [];
  for (const idx of newPath) {
    const node = breadcrumbNodes[idx];
    labels.push(labelOf(node));
    breadcrumbNodes = childrenOf(node);
  }
  const breadcrumb = labels.join(' > ');

  const kids = childrenOf(selected);
  if (kids.length === 0) {
    // Leaf — selection complete. Emit the deterministic 1/2 next-step
    // menu directly so the customer sees a routable prompt instead of
    // a model-generated dead-end. The 1/2 router in getReply.ts picks
    // up the next reply.
    clearState(phone, companyId);
    logger.info(
      { phone: '...' + phone.slice(-4), selection: breadcrumb },
      'Leaf reached',
    );
    const leafReply =
      `You selected: ${breadcrumb}\n\n` +
      '1. Book a meeting\n' +
      '2. Chat with an agent';
    return [leafReply, null];
  }

  setState(phone, companyId, { path: newPath, conversationId });
  logger.info(
    { phone: '...' + phone.slice(-4), level: newPath.length, path: breadcrumb },
    'Navigated to next level',
  );
  return [formatLevel(kids), null];
}
