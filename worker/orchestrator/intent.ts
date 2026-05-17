/**
 * Pure intent-detection helpers. Port of Chatbot/intent.py.
 *
 * All functions are stateless and side-effect-free.
 *
 *   wantsMeeting(message, history)     — true if the customer wants to book.
 *   wantsEscalation(message, history)  — true if the customer wants an agent.
 *   aiSchedulingManually(reply)        — true if OpenAI tried to collect a date/time.
 *
 * Word lists ported verbatim. Single-word ASCII keywords use word-boundary
 * regex to avoid substring false positives ("book" in "Facebook"). Multi-word
 * phrases and Arabic use plain substring matching (\b is unreliable for Unicode).
 */

export interface HistoryEntry {
  role: string;
  content: string | null;
}

const RESOLUTION_PHRASES = [
  'specialist will be in touch',
  'a member of our team will',
  'the team will follow up',
  'will be in touch shortly',
];

const MEETING_KEYWORDS = [
  'meeting', 'book', 'schedule', 'appointment', 'slot',
  'yes', 'yeah', 'sure', 'ok', 'okay', 'yep', 'please', 'definitely', 'great',
  'نعم', 'اوكي', 'تمام', 'حسنا', 'ايوه', 'اه', 'موافق', 'اجتماع', 'موعد', 'حجز',
];

const MEETING_QUESTION_PHRASES = [
  'schedule a meeting', 'book a meeting', 'meeting with our team',
  'speak with a customer service agent', 'whatsapp agent',
  'اجتماع', 'موعد', 'واتساب',
];

const ESCALATION_KEYWORDS = [
  'agent', 'human', 'person', 'staff', 'representative', 'support',
  'customer service', 'talk to someone', 'speak to someone', 'real person',
  'live agent', 'live person', 'call me', 'phone call',
  'وكيل', 'انسان', 'موظف', 'خدمة العملاء', 'دعم', 'شخص حقيقي',
  'تحدث مع شخص', 'اريد شخص', 'أريد شخص',
];

const AGENT_OFFER_PHRASES = [
  'speak with a customer service agent',
  'whatsapp agent',
  'customer service agent on whatsapp',
  'تحدث مع وكيل',
  'خدمة العملاء على واتساب',
];

const AI_SCHEDULING_PHRASES = [
  'what date', 'what time', 'when would you like', 'preferred time',
  'preferred date', 'which day', 'choose a date', 'pick a time',
  'let me know when', 'what day works', 'suggest a time',
  'أي يوم', 'متى تريد', 'اختر موعد', 'حدد وقت',
];

const AMBIGUOUS_AFFIRMATIVES: ReadonlySet<string> = new Set([
  'yes', 'yeah', 'sure', 'ok', 'okay', 'yep', 'please',
  'definitely', 'great', 'نعم', 'اوكي', 'تمام', 'حسنا',
  'ايوه', 'اه', 'موافق',
]);

function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 127) return false;
  }
  return true;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function kwMatch(keyword: string, text: string): boolean {
  if (keyword.includes(' ') || !isAscii(keyword)) return text.includes(keyword);
  const re = new RegExp(`\\b${escapeRegex(keyword)}\\b`);
  return re.test(text);
}

export function isResolved(reply: string): boolean {
  const lower = reply.toLowerCase();
  return RESOLUTION_PHRASES.some((p) => lower.includes(p));
}

function botJustAskedMeetingQuestion(history: HistoryEntry[] | undefined): boolean {
  if (!history) return false;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === 'assistant') {
      const content = (m.content ?? '').toLowerCase();
      return MEETING_QUESTION_PHRASES.some((p) => content.includes(p));
    }
  }
  return false;
}

function botJustOfferedAgent(history: HistoryEntry[] | undefined): boolean {
  if (!history) return false;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === 'assistant') {
      const content = (m.content ?? '').toLowerCase();
      return AGENT_OFFER_PHRASES.some((p) => content.includes(p));
    }
  }
  return false;
}

export function wantsMeeting(message: string, history?: HistoryEntry[]): boolean {
  const lower = message.toLowerCase();
  const matched = MEETING_KEYWORDS.filter((kw) => kwMatch(kw, lower));
  if (matched.length === 0) return false;
  const nonAmbiguous = matched.filter((kw) => !AMBIGUOUS_AFFIRMATIVES.has(kw));
  if (nonAmbiguous.length > 0) return true;
  return botJustAskedMeetingQuestion(history);
}

export function wantsEscalation(message: string, history?: HistoryEntry[]): boolean {
  const lower = message.toLowerCase();
  if (ESCALATION_KEYWORDS.some((kw) => kwMatch(kw, lower))) return true;
  const ambiguousHit = [...AMBIGUOUS_AFFIRMATIVES].some((kw) => kwMatch(kw, lower));
  if (ambiguousHit && botJustOfferedAgent(history)) return true;
  return false;
}

export function aiSchedulingManually(reply: string): boolean {
  const lower = reply.toLowerCase();
  return AI_SCHEDULING_PHRASES.some((p) => lower.includes(p));
}
