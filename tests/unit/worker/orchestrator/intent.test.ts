/**
 * worker/orchestrator/intent — pure intent-detection helpers + the 1/2
 * next-step router helpers (which live in getReply.ts, exported for tests).
 *
 * These are the deterministic guards that decide whether to short-circuit
 * the LLM (book a meeting, escalate to human, route digit menu) — getting
 * them wrong silently regresses migrated behavior.
 */
import { describe, expect, it } from 'vitest';
import {
  aiSchedulingManually,
  isResolved,
  wantsEscalation,
  wantsMeeting,
} from '@/worker/orchestrator/intent';
import {
  isNextStepChoice,
  normaliseMenuNumbers,
} from '@/worker/orchestrator/getReply';

describe('wantsMeeting', () => {
  const cases: Array<[string, boolean]> = [
    ['I want to book a meeting', true],
    ['schedule please', true],
    ['can I get an appointment?', true],
    ['أريد حجز اجتماع', true],
    ['موعد من فضلك', true],
    ['hello there', false],
    ['I love Facebook', false], // 'book' substring must not match
    ['what time do you open?', false],
  ];

  for (const [msg, expected] of cases) {
    it(`${expected ? 'matches' : 'rejects'}: "${msg}"`, () => {
      expect(wantsMeeting(msg)).toBe(expected);
    });
  }

  it('"yes" alone only counts when the bot just asked about a meeting', () => {
    expect(wantsMeeting('yes')).toBe(false);
    expect(
      wantsMeeting('yes', [
        { role: 'assistant', content: 'Would you like to schedule a meeting?' },
      ]),
    ).toBe(true);
  });

  it('"yes" alone does NOT match when the prior assistant turn was off-topic', () => {
    expect(
      wantsMeeting('yes', [
        { role: 'assistant', content: 'Our office opens at 9am.' },
      ]),
    ).toBe(false);
  });
});

describe('wantsEscalation', () => {
  const cases: Array<[string, boolean]> = [
    ['I want to speak to an agent', true],
    ['can I talk to a real person?', true],
    ['need human support', true],
    ['أريد وكيل', true],
    ['just browsing thanks', false],
    ['booking sounds great', false],
  ];

  for (const [msg, expected] of cases) {
    it(`${expected ? 'matches' : 'rejects'}: "${msg}"`, () => {
      expect(wantsEscalation(msg)).toBe(expected);
    });
  }

  it('"yes" alone only counts when the bot just offered an agent', () => {
    expect(wantsEscalation('yes')).toBe(false);
    expect(
      wantsEscalation('yes', [
        {
          role: 'assistant',
          content: 'Would you like to speak with a customer service agent?',
        },
      ]),
    ).toBe(true);
  });
});

describe('aiSchedulingManually', () => {
  it('detects "what date" / "what time" attempts', () => {
    expect(aiSchedulingManually('What date works for you?')).toBe(true);
    expect(aiSchedulingManually('Please let me know when you can.')).toBe(true);
  });

  it('does not match normal replies', () => {
    expect(aiSchedulingManually('Sure, here is the link.')).toBe(false);
  });
});

describe('isResolved', () => {
  it('matches the canonical handover phrases', () => {
    expect(isResolved('A specialist will be in touch shortly.')).toBe(true);
    expect(isResolved('a member of our team will reach out.')).toBe(true);
  });

  it('does not match arbitrary replies', () => {
    expect(isResolved('Thanks for your message.')).toBe(false);
  });
});

describe('isNextStepChoice', () => {
  it('recognises plain "1" and "2"', () => {
    expect(isNextStepChoice('1')).toBe(1);
    expect(isNextStepChoice('2')).toBe(2);
  });

  it('recognises "1." / "1)" / "2." / "2)"', () => {
    expect(isNextStepChoice('1.')).toBe(1);
    expect(isNextStepChoice('1)')).toBe(1);
    expect(isNextStepChoice('2.')).toBe(2);
    expect(isNextStepChoice('2)')).toBe(2);
  });

  it('recognises Arabic-Indic ١ and ٢', () => {
    expect(isNextStepChoice('١')).toBe(1);
    expect(isNextStepChoice('٢')).toBe(2);
  });

  it('returns null for anything that is not a bare 1 or 2', () => {
    expect(isNextStepChoice('1 please')).toBeNull();
    expect(isNextStepChoice('hello')).toBeNull();
    expect(isNextStepChoice('3')).toBeNull();
    expect(isNextStepChoice('')).toBeNull();
  });
});

describe('normaliseMenuNumbers', () => {
  it('converts Arabic-Indic digits to Western digits', () => {
    expect(normaliseMenuNumbers('١٢٣٤٥')).toBe('12345');
  });

  it('renumbers lettered list markers (A./B.) into 1./2.', () => {
    expect(normaliseMenuNumbers('A. apples\nB. bananas')).toBe(
      '1. apples\n2. bananas',
    );
  });

  it('leaves already-numbered lists untouched', () => {
    expect(normaliseMenuNumbers('1. apples\n2. bananas')).toBe(
      '1. apples\n2. bananas',
    );
  });

  it('does not renumber inside text (no leading letter+./)', () => {
    expect(normaliseMenuNumbers('Apples are great')).toBe('Apples are great');
  });
});
