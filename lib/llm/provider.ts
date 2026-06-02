/**
 * Vercel AI SDK provider + model accessors.
 *
 * Replaces the openai-singleton client at lib/llm/openai.ts (deleted in
 * Phase 1 Step 1).
 *
 * Reads OPENROUTER_* directly from process.env rather than going through
 * @/lib/env. The spec asked for getAppEnv() here, but appEnvSchema requires
 * SESSION_SECRET (min 32) and workerEnvSchema requires VERIFY_TOKEN (min 32)
 * — those are mutually exclusive across processes, so a single env-module
 * accessor would crash whichever service it's NOT designed for. Reading
 * process.env keeps this module usable from both the Next.js app and the
 * worker.
 *
 * All chat goes through OpenRouter (createOpenAI pointed at OpenRouter's
 * OpenAI-compatible endpoint). There is no direct OpenAI dependency.
 */

import { createOpenAI } from '@ai-sdk/openai';

// Route chat completions through OpenRouter. We keep the Vercel AI SDK's
// OpenAI provider and point it at OpenRouter's OpenAI-compatible endpoint
// rather than adding @openrouter/ai-sdk-provider — that provider does not
// yet declare support for `ai` v6, so the base-URL approach avoids a
// peer-dependency mismatch while keeping every generateText() call site
// unchanged. Model selection is the single config point below.
//
// NOTE: chat only. Whisper transcription (lib/messaging/voice.ts) stays on
// OpenAI directly — OpenRouter does not cover that endpoint.
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** The configured chat model id, in OpenRouter's namespaced form. */
export function getModelId(): string {
  return process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini';
}

/**
 * Audio transcription model. OpenRouter has no transcription endpoint, so
 * voice notes are transcribed via a multimodal chat model that accepts
 * audio input. Gemini Flash is the default — strong on Arabic, which the
 * chat model (gpt-4o-mini) can't transcribe anyway (no audio input).
 */
export function getTranscribeModelId(): string {
  return process.env.OPENROUTER_TRANSCRIBE_MODEL ?? 'google/gemini-2.5-flash';
}

export function getProvider() {
  return createOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: OPENROUTER_BASE_URL,
  });
}

export function getModel() {
  // .chat() forces the chat-completions endpoint OpenRouter exposes.
  return getProvider().chat(getModelId());
}
