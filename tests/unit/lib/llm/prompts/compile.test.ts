/**
 * lib/llm/prompts/compile — system prompt compilation snapshots.
 *
 * compilePrompt() must produce byte-identical output to the legacy
 * Python builder until PR 13 retires the Python side. Snapshots live in
 * an external .snap file so they can be reviewed as a committed artifact
 * on first run.
 *
 * Fixtures cover the four interesting code paths:
 *   - minimal (no menu, no questions, no FAQ, no escalation)
 *   - menu only (one-deep)
 *   - menu with two levels of subItems
 *   - full config (menu + questions + FAQ + escalation + Custom tone)
 */
import { describe, expect, it } from 'vitest';
import { compilePrompt, menuDepthValid } from '@/lib/llm/prompts/compile';

describe('compilePrompt', () => {
  it('matches snapshot — minimal config', () => {
    const cfg = {
      businessName: 'Acme Co',
      industry: 'plumbing',
    };
    expect(compilePrompt(cfg)).toMatchSnapshot();
  });

  it('matches snapshot — menu only (one-deep)', () => {
    const cfg = {
      businessName: 'Acme Co',
      industry: 'plumbing',
      tone: 'Friendly',
      menuConfig: [{ label: 'Services' }, { label: 'Pricing' }],
    };
    expect(compilePrompt(cfg)).toMatchSnapshot();
  });

  it('matches snapshot — menu with two levels of subItems', () => {
    const cfg = {
      businessName: 'Acme Co',
      menuConfig: [
        {
          label: 'Services',
          subItems: [
            { label: 'Drain cleaning', subItems: ['Residential', 'Commercial'] },
            'Leak repair',
          ],
        },
      ],
    };
    expect(compilePrompt(cfg)).toMatchSnapshot();
  });

  it('matches snapshot — full config (menu + questions + FAQ + escalation + Custom tone)', () => {
    const cfg = {
      businessName: 'Acme Co',
      industry: 'plumbing',
      tone: 'Custom',
      customTone: 'warm and chatty',
      greeting: 'Hi! Welcome to Acme.',
      closingMessage: 'Thanks for chatting with us.',
      menuConfig: [
        { label: 'Services', subItems: [{ label: 'Drain cleaning' }] },
      ],
      questions: [
        { text: 'Are you a homeowner?', answerType: 'yesno' },
        {
          text: 'Which service?',
          answerType: 'multiple',
          choices: ['Drain', 'Leak', { label: 'Inspection' }],
        },
        { text: 'When did the issue start?', answerType: 'free' },
      ],
      faq: [
        { question: 'Do you serve weekends?', answer: 'Yes, Saturdays only.' },
      ],
      escalationRules: [
        { rule: 'Customer asks about pricing for commercial projects' },
      ],
    };
    expect(compilePrompt(cfg)).toMatchSnapshot();
  });
});

describe('menuDepthValid', () => {
  it('accepts a reasonable 3-level menu', () => {
    expect(
      menuDepthValid([
        { label: 'A', subItems: [{ label: 'A1', subItems: ['A1a'] }] },
      ]),
    ).toBe(true);
  });

  it('rejects > 50 top-level items', () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ label: `i${i}` }));
    expect(menuDepthValid(items)).toBe(false);
  });

  it('rejects > 50 subItems on a top-level item', () => {
    const items = [
      {
        label: 'A',
        subItems: Array.from({ length: 51 }, (_, i) => ({ label: `s${i}` })),
      },
    ];
    expect(menuDepthValid(items)).toBe(false);
  });

  it('rejects label > 200 chars', () => {
    expect(menuDepthValid([{ label: 'x'.repeat(201) }])).toBe(false);
  });

  it('rejects a 4th level of nesting', () => {
    expect(
      menuDepthValid([
        {
          label: 'A',
          subItems: [
            {
              label: 'A1',
              subItems: [{ label: 'A1a', subItems: ['too deep'] }],
            },
          ],
        },
      ]),
    ).toBe(false);
  });
});
