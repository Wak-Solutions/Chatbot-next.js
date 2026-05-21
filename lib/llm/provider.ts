/**
 * Vercel AI SDK provider + model accessors.
 *
 * Replaces the openai-singleton client at lib/llm/openai.ts (deleted in
 * Phase 1 Step 1).
 *
 * Reads OPENAI_API_KEY / OPENAI_MODEL directly from process.env rather
 * than going through @/lib/env. The spec asked for getAppEnv() here, but
 * appEnvSchema requires SESSION_SECRET (min 32) and workerEnvSchema
 * requires VERIFY_TOKEN (min 32) — those are mutually exclusive across
 * processes, so a single env-module accessor would crash whichever
 * service it's NOT designed for. Reading process.env keeps this module
 * usable from both the Next.js app and the worker, matching how
 * lib/llm/openai.ts worked.
 */

import { createOpenAI } from '@ai-sdk/openai';

export function getProvider() {
  return createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export function getModel() {
  return getProvider()(process.env.OPENAI_MODEL ?? 'gpt-4o-mini');
}
