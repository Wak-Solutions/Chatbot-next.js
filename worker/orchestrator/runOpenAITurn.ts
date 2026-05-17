/**
 * Execute one OpenAI chat completion (with optional tool dispatch).
 *
 * Port of Chatbot/_agent_openai.py. The `messages` array is MUTATED to
 * include the assistant + tool messages on the path through a tool
 * call — same as the Python source, same as what OpenAI's API expects.
 *
 * Timeout: 30s per OpenAI call (first + tool follow-up).
 * Retries: none — on APITimeoutError, throw OpenAITimeoutError carrying
 *          the legacy fallback string. The orchestrator catches it and
 *          returns the fallback as the user-facing reply.
 *
 * Tool dispatch path: append the assistant message (carries tool_calls),
 * run each call through @/lib/llm/tools.dispatchTool, append the tool
 * message(s), then run a follow-up completion with tools still enabled
 * (matches Python — the model can theoretically chain a second tool call
 * but in practice doesn't).
 */

import { getOpenAI, getOpenAIModel } from '@/lib/llm/openai';
import { TOOLS, dispatchTool } from '@/lib/llm/tools';
import { createLogger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';
import type { OpenAIMessage } from './buildMessages';

const logger = createLogger('openai-turn');

const TIMEOUT_MS = 30_000;

export class OpenAITimeoutError extends Error {
  constructor(public readonly fallback: string) {
    super(fallback);
    this.name = 'OpenAITimeoutError';
  }
}

const FALLBACK_TEXT = "I'm taking too long to respond. Please try again in a moment.";

function isTimeoutError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string; code?: string; status?: number };
  return (
    e.name === 'APITimeoutError' ||
    e.name === 'AbortError' ||
    e.code === 'ETIMEDOUT' ||
    /timeout/i.test(e.message ?? '')
  );
}

export async function runOpenAITurn(
  messages: OpenAIMessage[],
  customerPhone: string,
  companyId: number,
): Promise<string | null> {
  const model = getOpenAIModel();
  const client = getOpenAI();

  // First turn.
  let response;
  try {
    response = await client.chat.completions.create(
      {
        model,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: messages as any,
        tools: TOOLS,
        tool_choice: 'auto',
      },
      { timeout: TIMEOUT_MS },
    );
  } catch (err) {
    if (isTimeoutError(err)) {
      logger.error({ model, phone: maskPhone(customerPhone) }, 'OpenAI timeout');
      throw new OpenAITimeoutError(FALLBACK_TEXT);
    }
    throw err;
  }

  const usage = response.usage;
  logger.info(
    {
      model,
      prompt_tokens: usage?.prompt_tokens ?? 'n/a',
      completion_tokens: usage?.completion_tokens ?? 'n/a',
      phone: maskPhone(customerPhone),
    },
    'OpenAI response',
  );

  const message = response.choices[0]?.message;
  if (!message) return null;

  const toolCalls = message.tool_calls;
  if (!toolCalls || toolCalls.length === 0) {
    return message.content ?? null;
  }

  // Append the assistant message (carries tool_calls).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages.push(message as any);

  for (const call of toolCalls) {
    if (call.type !== 'function') continue;
    const functionName = call.function.name;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments) as Record<string, unknown>;
    } catch {
      args = {};
    }
    logger.info(
      { functionName, phone: maskPhone(customerPhone) },
      'Tool call',
    );
    const toolResult = await dispatchTool(functionName, args, companyId);
    messages.push({
      role: 'tool',
      tool_call_id: call.id,
      content: JSON.stringify(toolResult),
    });
  }

  // Second turn with tool results.
  let second;
  try {
    second = await client.chat.completions.create(
      {
        model,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: messages as any,
        tools: TOOLS,
        tool_choice: 'auto',
      },
      { timeout: TIMEOUT_MS },
    );
  } catch (err) {
    if (isTimeoutError(err)) {
      logger.error(
        { model, phone: maskPhone(customerPhone) },
        'OpenAI tool-followup timeout',
      );
      throw new OpenAITimeoutError(FALLBACK_TEXT);
    }
    throw err;
  }

  const secondUsage = second.usage;
  logger.info(
    {
      model,
      prompt_tokens: secondUsage?.prompt_tokens ?? 'n/a',
      completion_tokens: secondUsage?.completion_tokens ?? 'n/a',
      phone: maskPhone(customerPhone),
    },
    'OpenAI tool-follow-up',
  );

  return second.choices[0]?.message?.content ?? null;
}
