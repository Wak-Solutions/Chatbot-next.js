/**
 * Language detection + locale-aware system-prompt suffix.
 *
 * Port of Chatbot/_prompt_language.py. The single Arabic-vs-English
 * regex check is identical — substring matching on the Arabic Unicode
 * block ranges. detectLanguage returns null when there's no language
 * signal at all (digits-only, emoji-only) so the suffix isn't appended
 * to a turn whose language can't be inferred.
 */

export const LANGUAGE_OVERRIDE =
  '\n\nOVERRIDE — CURRENT MESSAGE LANGUAGE:\n' +
  "The customer's current message is in {language}.\n" +
  'You MUST reply in {language} only. ' +
  'This overrides all conversation history.';

const ARABIC_RANGE = /[؀-ۿ]/;
const LATIN_RANGE = /[a-zA-Z]/;

export type DetectedLanguage = 'Arabic' | 'English';

export function detectLanguage(text: string): DetectedLanguage | null {
  if (ARABIC_RANGE.test(text)) return 'Arabic';
  if (LATIN_RANGE.test(text)) return 'English';
  return null;
}
