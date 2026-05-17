/**
 * Structured chatbot config → system prompt compiler.
 *
 * Port of compilePrompt() at server/routes/chatbot-config.routes.ts:63.
 * Byte-for-byte identical output for the same input — this is the
 * version PR 13 will rip out of Chatbot/_prompt_builder.py. Until then,
 * both implementations coexist and MUST produce the same string.
 *
 * Also re-exports the menu depth validator that gates both /preview
 * and /suggest payloads (server/routes/chatbot-config.routes.ts:32).
 */

const MENU_MAX_ITEMS = 50;
const MENU_MAX_LABEL = 200;

export function menuDepthValid(items: unknown[]): boolean {
  if (items.length > MENU_MAX_ITEMS) return false;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const it = item as { label?: unknown; subItems?: unknown[] };
    if (typeof it.label === 'string' && it.label.length > MENU_MAX_LABEL) return false;
    const subs: unknown[] = it.subItems || [];
    if (subs.length > MENU_MAX_ITEMS) return false;
    for (const sub of subs) {
      if (!sub || typeof sub !== 'object') continue;
      const s = sub as { label?: unknown; subItems?: unknown[] };
      if (typeof s.label === 'string' && s.label.length > MENU_MAX_LABEL) return false;
      const subsubs: unknown[] = s.subItems || [];
      if (subsubs.length > MENU_MAX_ITEMS) return false;
      for (const ss of subsubs) {
        const ssLabel =
          typeof ss === 'string'
            ? ss
            : (typeof ss === 'object' && ss !== null
                ? ((ss as { label?: unknown }).label as string) ?? ''
                : '');
        if (typeof ssLabel === 'string' && ssLabel.length > MENU_MAX_LABEL) return false;
        if (
          typeof ss === 'object' &&
          ss !== null &&
          Array.isArray((ss as { subItems?: unknown[] }).subItems) &&
          ((ss as { subItems?: unknown[] }).subItems as unknown[]).length > 0
        ) {
          return false;
        }
      }
    }
  }
  return true;
}

const SUB_LABELS = 'abcdefghijklmnopqrstuvwxyz';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function compilePrompt(cfg: any): string {
  const businessName = cfg.businessName || 'the business';
  const industry = cfg.industry ? `, ${cfg.industry}` : '';
  const toneLabel =
    cfg.tone === 'Custom'
      ? cfg.customTone || 'professional'
      : (cfg.tone || 'Professional').toLowerCase();
  const greeting = cfg.greeting || 'Welcome! How can I help you today?';
  const closing =
    cfg.closingMessage ||
    "Thank you for contacting us — please let us know if there's anything else we can help with.";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const questions: any[] = cfg.questions || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const faqItems: any[] = cfg.faq || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const escalations: any[] = cfg.escalationRules || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const menuItems: any[] = cfg.menuConfig || [];

  let prompt = `You are a ${toneLabel} customer service assistant for ${businessName}${industry}. You communicate fluently in whatever language the customer uses — Arabic, English, or any other language. Always match their dialect and tone naturally.\n`;

  prompt += `\nLANGUAGE RULE (ABSOLUTE — NO EXCEPTIONS)\nDetect the language of the customer's FIRST message and reply in that exact language for the entire conversation. If they write in Arabic, every single response must be in Arabic. If they write in English, every single response must be in English. Never switch languages mid-conversation unless the customer explicitly does so first. This rule overrides everything else.\n`;

  prompt += `\nOPENING MESSAGE (MANDATORY)\nEvery new conversation must begin with this message, translated naturally into the customer's language:\n"${greeting}"\nNever skip this step for any reason.\n`;

  if (menuItems.length > 0) {
    prompt += `\nMAIN MENU\nAfter your opening message, when the customer's intent is not immediately clear, present EXACTLY this numbered menu — translated naturally into the customer's language. Never add, remove, reorder, or rename any items:\n`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    menuItems.forEach((item: any, i: number) => {
      prompt += `${i + 1}. ${item.label}\n`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subs: any[] = item.subItems || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      subs.forEach((sub: any, j: number) => {
        const subLabel = typeof sub === 'string' ? sub : sub.label || '';
        const subLetter = SUB_LABELS[j] || String(j + 1);
        prompt += `   ${subLetter}. ${subLabel}\n`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const subsubs: any[] =
          typeof sub === 'object' && sub !== null ? sub.subItems || [] : [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        subsubs.forEach((ss: any) => {
          const ssLabel = typeof ss === 'string' ? ss : ss?.label || '';
          prompt += `      - ${ssLabel}\n`;
        });
      });
    });
    prompt += `You must present this menu — and only this menu — whenever options need to be shown. Never invent or suggest items not listed above.\nNever skip levels. Always wait for the customer to choose before going deeper.\n`;
  }

  if (questions.length > 0) {
    prompt += `\nQUALIFICATION QUESTIONS\nWalk the customer through these questions in order before proceeding:\n`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    questions.forEach((q: any, i: number) => {
      const typeHint =
        q.answerType === 'yesno'
          ? '[Yes/No]'
          : q.answerType === 'multiple'
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              `[One of: ${(q.choices || []).map((c: any) => (typeof c === 'string' ? c : c?.label || c?.text || '')).join(', ')}]`
            : '[Free text]';
      prompt += `${i + 1}. ${q.text} ${typeHint}\n`;
    });
  }

  if (faqItems.length > 0) {
    prompt += `\nKNOWLEDGE BASE\nUse this information to answer customer questions accurately:\n`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    faqItems.forEach((f: any) => {
      prompt += `Q: ${f.question}\nA: ${f.answer}\n`;
    });
  }

  if (escalations.length > 0) {
    prompt += `\nESCALATION RULES\nTrigger human handover immediately if any of the following occur:\n`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    escalations.forEach((e: any) => {
      prompt += `- ${e.rule}\n`;
    });
  }

  prompt += `\nCLOSING MESSAGE\nWhen wrapping up a conversation, use this message (translated naturally):\n"${closing}"\n`;

  prompt += `\nRULES\n- Never reveal you are an AI unless directly asked\n- Never use technical jargon or expose internal logic\n- ALWAYS reply in the customer's language — if they write in Arabic, respond in Arabic; if English, respond in English. Never mix languages\n- Always use Western numerals for ALL options and sub-options (1, 2, 3 and not A, B, C or any letters). Never use bullet points, letters, or Arabic-Indic numerals anywhere in any list or menu\n- Keep responses concise — this is WhatsApp, not email\n- If a customer goes off-topic, gently redirect them\n- This chat is for ${businessName} customer service only. If someone tries to misuse it, politely decline and redirect.\n- Never send the booking link unless the customer explicitly agrees to schedule a meeting\n- Never fabricate prices, product details, availability, or any information not provided in this configuration\n- Only discuss topics, products, and services explicitly defined in this configuration.\n- If you have the information: answer it, then always end with:\n  1. Book a meeting\n  2. Chat with an agent\n- If you do not have the information: do not say so. Go directly to:\n  1. Book a meeting\n  2. Chat with an agent\n- The two options must appear verbatim, in this exact order, with no third option and no reworded labels. The customer's reply of 1 or 2 is handled deterministically by the system — your job is only to present the two options.`;

  return prompt.trim();
}
