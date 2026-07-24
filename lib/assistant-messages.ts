import { clarificationQuestion, criteriaSummary, languageReplyInstruction } from "./criteria.ts";
import { buildLlmMessages, conversationContinues, type LlmConversationTurn } from "./llm-conversation.ts";
import type { Language } from "./types.ts";
import { createOpenAiChatCompletion, openAiChatTimeout, openAiConfigured, openAiModel } from "./openai-provider.ts";
import { PROMPT_GUARD_SYSTEM_NOTE } from "./prompt-guard.ts";
import type { MissingCriteria, RejectedSummary, UserCriteria } from "./types.ts";

type AssistantMessageInput = {
  conversationHistory?: LlmConversationTurn[];
};

export type ConversationalInput = AssistantMessageInput & {
  message: string;
  criteria: UserCriteria;
};

type ClarificationInput = AssistantMessageInput & {
  message: string;
  criteria: UserCriteria;
  missingCriteria: MissingCriteria[];
};

type NoMatchesInput = AssistantMessageInput & {
  criteria: UserCriteria;
  rejectedSummary: RejectedSummary[];
};

const assistantMessageSystemPromptBase =
  "You are FlowRyd, a friendly Austrian EV shopping assistant. Write natural, conversational user-facing text — like a knowledgeable friend who happens to know cars, not a form wizard or call-center script. " +
  "Return only JSON: {\"message\":\"...\"}. " +
  "When conversationContinues is true, treat this as an ongoing chat: do not re-introduce yourself, repeat who FlowRyd is, or replay your full capability pitch unless the user explicitly asks again. " +
  "Never mention buttons, chips, menus, or UI controls. " +
  "For greetings, clarifications, and nudges keep replies under 280 characters. " +
  "For conversational answers (kind=conversational) or no-match explanations you may use up to 520 characters.";

function llmEnabled() {
  return process.env.FLOWRYD_DISABLE_LLM !== "1" && openAiConfigured();
}

export async function generateClarificationMessage(input: ClarificationInput): Promise<string> {
  const fallback = () => clarificationQuestion(input.criteria);
  if (!input.missingCriteria.length) return fallback();

  const generated = await generateMessage(
    "clarification",
    {
      task: "Ask one concise follow-up question for the highest-priority missing criteria. Acknowledge known criteria when present.",
      message: input.message,
      language: input.criteria.language,
      missingCriteria: input.missingCriteria,
      knownCriteria: criteriaSummary(input.criteria),
      criteria: input.criteria
    },
    input.conversationHistory
  );

  return generated ?? fallback();
}

export async function generateChatGreeting(input: {
  message: string;
  criteria: UserCriteria;
  conversationHistory?: LlmConversationTurn[];
}): Promise<string> {
  const history = input.conversationHistory ?? [];
  const continues = conversationContinues(history);
  const fallback = () => fallbackChatGreeting(input.criteria, history);
  const generated = await generateMessage(
    "chat_greeting",
    {
      task: continues
        ? "Reply warmly to the user's latest message only — like continuing a chat with a friend. Acknowledge what they said (thanks, ok, nice, etc.) in one short beat. Do NOT re-introduce yourself or mention FlowRyd by name. Do NOT ask a new shopping question, repeat the previous criteria question, or push budget/use-case follow-ups unless they clearly asked to continue searching. Keep it light and brief."
        : "Reply warmly and conversationally to the user's message — like a friendly chat, not a form. If they greet you or ask how you are, respond naturally first. Briefly mention you're FlowRyd and can help find an EV when they're ready, but do NOT immediately ask for budget or push criteria questions unless they already started sharing preferences.",
      message: input.message,
      language: input.criteria.language,
      knownCriteria: criteriaSummary(input.criteria),
      conversationContinues: continues
    },
    history
  );

  return generated ?? fallback();
}

/**
 * Greets the user and naturally leads into the first EV question.
 * Used when the turn is a greeting with no prior criteria.
 */
export async function generateGreetingResponse(input: {
  message: string;
  criteria: UserCriteria;
  catalogQuestion: string;
  conversationHistory?: LlmConversationTurn[];
}): Promise<string> {
  const history = input.conversationHistory ?? [];
  const continues = conversationContinues(history);
  const fallback = () =>
    continues
      ? input.catalogQuestion
      : input.criteria.language === "de"
        ? `Hey! Ich bin FlowRyd, dein E-Auto-Matchmaker. ${input.catalogQuestion}`
        : `Hey! I'm FlowRyd, your EV match-maker. ${input.catalogQuestion}`;

  const generated = await generateMessage(
    "greeting",
    {
      task: continues
        ? "You already greeted the user earlier in this chat. React naturally to their latest message, then smoothly lead into the guideQuestion in your own words — do NOT re-introduce yourself or mention FlowRyd by name."
        : "Introduce yourself briefly as FlowRyd, a friendly Austrian EV matchmaker. React naturally to the user's opening message (e.g. if they say thanks, acknowledge it warmly). Then smoothly lead into the guideQuestion — do NOT paste it verbatim, ask it in your own words.",
      message: input.message,
      language: input.criteria.language,
      guideQuestion: input.catalogQuestion,
      conversationContinues: continues
    },
    history
  );

  return generated ?? fallback();
}

/**
 * Rephrases a catalog clarification question in a natural, conversational way.
 * Acknowledges what the user has already said if there are known criteria.
 */
export async function generateClarificationResponse(input: {
  message: string;
  criteria: UserCriteria;
  catalogQuestion: string;
  conversationHistory?: LlmConversationTurn[];
}): Promise<string> {
  const fallback = () => input.catalogQuestion;
  const known = criteriaSummary(input.criteria);

  const generated = await generateMessage(
    "clarification_natural",
    {
      task:
        "Ask the user the guideQuestion in a natural, chat-like way. Stay faithful to the intent of guideQuestion — if it asks where they charge, ask about charging location (home/work/public), not about range targets. If knownCriteria is not empty, briefly acknowledge what you already know in a few words before asking. Never copy guideQuestion word-for-word — rephrase it. Ask exactly one question.",
      message: input.message,
      language: input.criteria.language,
      guideQuestion: input.catalogQuestion,
      knownCriteria: known
    },
    input.conversationHistory
  );

  return generated ?? fallback();
}

/**
 * Explains what FlowRyd can help with when the user asks about the assistant itself.
 */
export async function generateCapabilityResponse(input: {
  message: string;
  criteria: UserCriteria;
  conversationHistory?: LlmConversationTurn[];
}): Promise<string> {
  const history = input.conversationHistory ?? [];
  const continues = conversationContinues(history);
  const fallback = () => fallbackCapabilityMessage(input.criteria, history);
  const generated = await generateMessage(
    "capability",
    {
      task: continues
        ? "The user is asking again what you can do or how this works. Give a shorter reminder of your EV-shopping help in plain language without repeating your full introduction. Do NOT say who you are by name again. Do not mention buttons or chips."
        : "The user is asking what you can do, who you are, or how this works. Explain that you are FlowRyd, a friendly Austrian EV shopping assistant. Describe your capabilities in plain language: learn their budget and daily use, ask follow-up questions, find matching EV listings, explain EV topics like range/charging/incentives, and refine results as they chat. Do NOT ask for budget or other criteria in this reply unless they already shared some and you are briefly acknowledging it. Do not mention buttons or chips.",
      message: input.message,
      language: input.criteria.language,
      knownCriteria: criteriaSummary(input.criteria),
      conversationContinues: continues
    },
    history
  );

  return generated ?? fallback();
}

/**
 * Answers a general or off-topic user message conversationally without pushing chips.
 */
export async function generateConversationalResponse(input: {
  message: string;
  criteria: UserCriteria;
  stepContext?: string | null;
  ragEvidence?: string[];
  conversationHistory?: LlmConversationTurn[];
}): Promise<string> {
  const history = input.conversationHistory ?? [];
  const continues = conversationContinues(history);
  const fallback = () => fallbackConversationalMessage(input.criteria, history);

  const generated = await generateMessage(
    "conversational",
    {
      task:
        "Reply naturally to the user's message. If it is a general EV or shopping question, answer it directly and helpfully from your knowledge (Austrian/EU context when relevant: winters, wallboxes, Autobahn, Förderungen). Give a concrete takeaway, not a vague hedge. If stepContext is provided and the question relates to the current matching step, you may use it as background — but do not paste it verbatim and do not force the user back into a form-like flow. Do not ask them to tap buttons or chips. Keep it conversational. End with at most one optional soft offer to continue the search — never a mandatory criteria interrogation." +
        (continues
          ? " This chat is already underway — do not re-introduce yourself or repeat your opening pitch."
          : ""),
      message: input.message,
      language: input.criteria.language,
      knownCriteria: criteriaSummary(input.criteria),
      stepContext: input.stepContext ?? null,
      conversationContinues: continues
    },
    history
  );

  return generated ?? fallback();
}

/**
 * Gently re-prompts when the user hasn't answered the current question.
 */
export async function generateNudgeResponse(input: {
  message: string;
  criteria: UserCriteria;
  catalogQuestion: string;
  conversationHistory?: LlmConversationTurn[];
}): Promise<string> {
  const fallback = () =>
    input.criteria.language === "de"
      ? `Kein Stress – antworte einfach in eigenen Worten oder wähle unten etwas aus. ${input.catalogQuestion}`
      : `No rush — answer in your own words or pick an option below. ${input.catalogQuestion}`;

  const generated = await generateMessage(
    "nudge",
    {
      task:
        "The user hasn't answered the current question yet. Gently encourage them without pressure and re-ask guideQuestion in a fresh, casual way. Don't lecture or repeat the same phrasing as before.",
      message: input.message,
      language: input.criteria.language,
      guideQuestion: input.catalogQuestion
    },
    input.conversationHistory
  );

  return generated ?? fallback();
}

export async function generateNoMatchesMessage(input: NoMatchesInput): Promise<string> {
  const fallback = () => fallbackNoMatchesMessage(input.criteria, input.rejectedSummary);
  const generated = await generateMessage(
    "no_matches",
    {
      task: "Explain that no EV matched the hard filters and suggest which filter to relax. Mention the main rejection reason when provided.",
      language: input.criteria.language,
      criteria: input.criteria,
      rejectedSummary: input.rejectedSummary
    },
    input.conversationHistory
  );

  return generated ?? fallback();
}

export async function generateNoMoreMatchesMessage(
  criteria: UserCriteria,
  conversationHistory: LlmConversationTurn[] = []
): Promise<string> {
  const fallback = () => fallbackNoMoreMatchesMessage(criteria);
  const generated = await generateMessage(
    "no_more_matches",
    {
      task: "Explain that all matching cars for this search were already shown and suggest relaxing a hard filter to see more options.",
      language: criteria.language,
      criteria
    },
    conversationHistory
  );

  return generated ?? fallback();
}

export async function generateMatchIntroMessage(input: {
  criteria: UserCriteria;
  recommendationCount: number;
  lowConfidenceQuestion?: string | null;
  rejectedSummary?: RejectedSummary[];
  inventoryBrands?: string[];
  brandWiden?: boolean;
}): Promise<string> {
  const brands = [...new Set((input.inventoryBrands ?? []).filter(Boolean))];
  const fallback = () =>
    fallbackMatchIntroMessage(
      input.criteria,
      input.recommendationCount,
      input.lowConfidenceQuestion,
      input.brandWiden ? brands : undefined
    );

  // Brand-widen intros may use the LLM, but must stay inventory-grounded via isMatchIntroGrounded.
  const emptyBrandPrefs = !input.criteria.brandPreferences.length;
  const brandRule = emptyBrandPrefs
    ? " criteria.brandPreferences is empty — do not frame results as a preferred-brand search (avoid phrases like \"Ford cars for you\"). You may name makes only if they appear in inventoryBrands, as examples from the result set."
    : "";
  const widenRule = input.brandWiden
    ? " This is a brand-widen rematch: name only makes present in inventoryBrands; do not claim the catalog has no other brands when multiple makes are listed."
    : "";

  const generated = await generateMessage("match_intro", {
    task:
      "Briefly introduce the single best EV recommendation like a helpful advisor texting a customer. Sound specific and warm — reference the user's budget, use case, or must-haves when present. Do not reuse a fixed template. Do not say \"hard limits\" or \"hard filters\". Mention tradeoffs only if rejectedSummary is non-empty and useful. Do NOT ask a follow-up priority question in this message. When recommendationCount is 1, speak in the singular (a strong match / one recommendation) — never say you found multiple matching EVs." +
      brandRule +
      widenRule +
      " Never invent car brands that are absent from inventoryBrands. Prefer naming the top result's situation over listing every brand.",
    language: input.criteria.language,
    recommendationCount: input.recommendationCount,
    lowConfidenceQuestion: null,
    rejectedSummary: input.rejectedSummary ?? [],
    criteria: input.criteria,
    inventoryBrands: brands,
    brandWiden: Boolean(input.brandWiden)
  });

  if (!generated) return fallback();
  if (
    !isMatchIntroGrounded(generated, brands, {
      brandPreferences: input.criteria.brandPreferences,
      brandWiden: Boolean(input.brandWiden)
    })
  ) {
    return fallback();
  }
  return generated;
}

const MATCH_INTRO_BRAND_GUARD =
  /\b(?:Mazda|Toyota|BMW|Audi|Mercedes(?:-Benz)?|Volkswagen|VW|Hyundai|Kia|Nissan|Honda|Ford|Tesla|Porsche|Volvo|Peugeot|Renault|Opel|Skoda|Škoda|Cupra|BYD|Polestar|Fiat|Jeep|Lexus|Citroën|Citroen|AION|Leapmotor|XPENG|MG)\b/gi;

/** Brands that collide with common English words — match capitalized/all-caps forms only. */
const MATCH_INTRO_AMBIGUOUS_BRAND_GUARD = /\b(?:Mini|SEAT|Seat)\b/g;

/** Reject LLM intros that invent brands or sticky preferred-brand framing when prefs are empty. */
export function isMatchIntroGrounded(
  message: string,
  inventoryBrands: string[],
  options: { brandPreferences?: string[]; brandWiden?: boolean } = {}
): boolean {
  const allowed = new Set(
    [...inventoryBrands, ...(options.brandPreferences ?? [])].map((brand) => brand.toLowerCase())
  );
  const mentioned = [
    ...(message.match(MATCH_INTRO_BRAND_GUARD) ?? []),
    ...(message.match(MATCH_INTRO_AMBIGUOUS_BRAND_GUARD) ?? [])
  ];
  for (const brand of mentioned) {
    if (!allowed.has(brand.toLowerCase())) return false;
  }

  if (!(options.brandPreferences ?? []).length) {
    if (/\b[\w.-]+\s+(?:cars?|evs?|listings?)\s+for you\b/i.test(message) && mentioned.length) {
      return false;
    }
    if (/\bsporty\b[\s\w-]*\b(?:Ford|Tesla|BMW|Mazda|Toyota)\s+cars?\b/i.test(message)) {
      return false;
    }
  }

  if (
    options.brandWiden &&
    inventoryBrands.length > 1 &&
    /\b(?:no other brands|don'?t have other brands|do not have other brands|keine anderen Marken)\b/i.test(
      message
    )
  ) {
    return false;
  }

  return true;
}

export async function generateLowConfidenceQuestion(
  criteria: UserCriteria,
  conversationHistory: LlmConversationTurn[] = []
): Promise<string> {
  const fallback = () => fallbackLowConfidenceQuestion(criteria);
  const generated = await generateMessage(
    "low_confidence_followup",
    {
      task: "Ask one short question to clarify whether to prioritize lower mileage, longer range, or premium comfort.",
      language: criteria.language,
      criteria
    },
    conversationHistory
  );

  return generated ?? fallback();
}

function resolveMessageLanguage(context: Record<string, unknown>): Language {
  return context.language === "de" || context.language === "en" ? context.language : "en";
}

async function generateMessage(
  kind: string,
  context: Record<string, unknown>,
  conversationHistory: LlmConversationTurn[] = []
): Promise<string | null> {
  if (!llmEnabled()) return null;
  const language = resolveMessageLanguage(context);
  const systemPrompt = `${assistantMessageSystemPromptBase} ${languageReplyInstruction(language)} ${PROMPT_GUARD_SYSTEM_NOTE}`;

  try {
    const response = await createOpenAiChatCompletion(
      "assistant-message",
      {
        model: openAiModel(),
        temperature: 0.35,
        response_format: { type: "json_object" },
        messages: buildLlmMessages(systemPrompt, conversationHistory, JSON.stringify({ kind, ...context }))
      },
      { timeout: openAiChatTimeout("assistant-message") }
    );
    return parseMessageJson(response.choices[0]?.message?.content ?? "");
  } catch {
    return null;
  }
}

export function fallbackConversationalMessage(
  criteria: UserCriteria,
  conversationHistory: LlmConversationTurn[] = []
) {
  if (conversationContinues(conversationHistory)) {
    return criteria.language === "de"
      ? "Gern — frag einfach weiter, wenn dir noch etwas zu E-Autos oder deiner Suche einfällt."
      : "Sure — just keep asking if anything else comes to mind about EVs or your search.";
  }
  if (criteria.language === "de") {
    return "Gern — frag mich alles zu E-Autos, Laden oder deiner Suche. Wenn du soweit bist, beschreib einfach Budget, Alltag und Wünsche.";
  }
  return "Happy to help — ask me anything about EVs, charging, or your search. When you're ready, just share your budget, daily use, and preferences.";
}

function parseMessageJson(content: string): string | null {
  if (!content.trim()) return null;
  const parsed = JSON.parse(stripJsonFence(content)) as { message?: unknown };
  if (typeof parsed.message !== "string") return null;
  const trimmed = parsed.message.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, 900) : null;
}

function stripJsonFence(content: string) {
  return content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

export function fallbackCapabilityMessage(
  criteria: UserCriteria,
  conversationHistory: LlmConversationTurn[] = []
) {
  if (conversationContinues(conversationHistory)) {
    return criteria.language === "de"
      ? "Ich kann dir beim E-Auto-Kauf helfen: Budget und Alltag klären, passende Autos finden und Themen wie Reichweite oder Laden erklären."
      : "I can help with your EV search — clarify budget and daily use, find matching cars, and explain topics like range or charging.";
  }
  if (criteria.language === "de") {
    return "Ich bin FlowRyd, dein E-Auto-Matchmaker für Österreich. Beschreib mir Budget, Alltag und Wünsche – ich stelle Rückfragen, finde passende E-Autos, erkläre Themen wie Reichweite oder Laden und verfeinere die Suche mit dir im Chat.";
  }
  return "I'm FlowRyd, your EV match-maker for Austria. Tell me your budget, daily use, and preferences — I'll ask follow-ups, find matching EVs, explain topics like range or charging, and refine the search as we chat.";
}

export function fallbackChatGreeting(
  criteria: UserCriteria,
  conversationHistory: LlmConversationTurn[] = []
) {
  if (conversationContinues(conversationHistory)) {
    return criteria.language === "de"
      ? "Gern geschehen! Sag einfach Bescheid, wenn du weitermachen willst."
      : "You're welcome! Just say the word whenever you want to keep going.";
  }
  if (criteria.language === "de") {
    return "Hey! Mir geht's gut, danke der Nachfrage. Ich bin FlowRyd — wenn du magst, erzähl mir später einfach von Budget, Alltag und Wünschen für dein E-Auto.";
  }
  return "Hey! I'm doing well, thanks for asking. I'm FlowRyd — whenever you're ready, tell me about your budget, daily use, and what you're looking for in an EV.";
}

export function fallbackNoMatchesMessage(criteria: UserCriteria, rejectedSummary: RejectedSummary[]) {
  const mainReason = rejectedSummary[0]?.reason;
  if (criteria.language === "de") {
    return mainReason
      ? `Ich finde mit diesen harten Grenzen kein passendes E-Auto. Der staerkste Blocker ist: ${mainReason}.`
      : "Ich finde mit diesen harten Grenzen kein passendes E-Auto. Lockere bitte Budget, Reichweite, Kilometerstand oder Karosserieform.";
  }
  return mainReason
    ? `I could not find a matching EV inside those hard limits. The biggest blocker is: ${mainReason}.`
    : "I could not find a matching EV inside those hard limits. Try relaxing budget, range, mileage, or body type.";
}

export function fallbackNoMoreMatchesMessage(criteria: UserCriteria) {
  return criteria.language === "de"
    ? "Ich habe dir alle passenden Autos aus dieser Suche bereits gezeigt. Wenn du mehr Auswahl willst, lockere bitte Budget, Reichweite, Karosserieform oder andere harte Kriterien."
    : "I have already shown all matching cars for this search. To get more options, try relaxing budget, range, body type, or another hard filter.";
}

export function fallbackMatchIntroMessage(
  criteria: UserCriteria,
  recommendationCount: number,
  lowConfidenceQuestion?: string | null,
  inventoryBrands?: string[]
) {
  const brands = [...new Set((inventoryBrands ?? []).filter(Boolean))];
  const brandSentence =
    brands.length === 0
      ? ""
      : criteria.language === "de"
        ? ` Dabei sind unter anderem ${brands.slice(0, 3).join(", ")}.`
        : ` That includes makes like ${brands.slice(0, 3).join(", ")}.`;
  // Always speak about the visible recommendation count (usually 1), never cached runner-ups.
  const visibleCount = Math.max(1, recommendationCount);
  const base =
    criteria.language === "de"
      ? visibleCount === 1
        ? `Ich habe ein starkes Match für dich.${brandSentence}`
        : `Ich habe ${visibleCount} passende E-Autos für dich.${brandSentence}`
      : visibleCount === 1
        ? `I found a strong match for you.${brandSentence}`
        : `I found ${visibleCount} matching EVs for you.${brandSentence}`;
  // Never stitch a follow-up question into the match announcement (PoC Test Summary bug).
  void lowConfidenceQuestion;
  return base;
}

export function fallbackLowConfidenceQuestion(criteria: UserCriteria) {
  return criteria.language === "de"
    ? "Soll ich eher niedrigen Kilometerstand, laengere Reichweite oder Premium-Komfort priorisieren?"
    : "Should I prioritize lower mileage, longer range, or premium comfort?";
}
