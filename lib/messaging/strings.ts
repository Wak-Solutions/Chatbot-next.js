/**
 * Shared customer-facing message strings.
 *
 * CONNECTING_TO_AGENT is sent in two places:
 *   1. worker/orchestrator/getReply menu option "2" (digit-router branch).
 *   2. app/api/conversations/[phone]/pause when an agent activates pause.
 *
 * Both paths import this constant — do NOT inline the string elsewhere.
 */

export const CONNECTING_TO_AGENT =
  'Connecting you to an agent now — please hold on a moment.';
