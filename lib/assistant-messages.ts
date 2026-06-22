import { clarificationQuestion, criteriaSummary, languageReplyInstruction } from "./criteria.ts";
import type { Language } from "./types.ts";
import { createOpenAiClient, openAiConfigured, openAiModel } from "./openai-provider.ts";
import type { MissingCriteria, RejectedSummary, UserCriteria } from "./types.ts";

type ClarificationInput = {
  message: string;
  criteria: UserCriteria;
  missingCriteria: MissingCriteria[];
};

type NoMatchesInput = {
  criteria: UserCriteria;
  rejectedSummary: RejectedSummary[];
};

const assistantMessageSystemPromptBase =
  "You are FlowRyd, a friendly Austrian EV shopping assistant. Write natural, concise user-facing text. " +
  "Return only JSON: {\"message\":\"...\"}. Keep replies under 280 characters unless explaining why no cars matched.";

function llmEnabled() {
  return process.env.FLOWRYD_DISABLE_LLM !== "1" && openAiConfigured();
}

export async function generateClarificationMessage(input: ClarificationInput): Promise<string> {
  const fallback = () => clarificationQuestion(input.criteria);
  if (!input.missingCriteria.length) return fallback();

  const generated = await generateMessage("clarification", {
    task: "Ask one concise follow-up question for the highest-priority missing criteria. Acknowledge known criteria when present.",
    message: input.message,
    language: input.criteria.language,
    missingCriteria: input.missingCriteria,
    knownCriteria: criteriaSummary(input.criteria),
    criteria: input.criteria
  });

  return generated ?? fallback();
}

export async function generateChatGreeting(input: {
  message: string;
  criteria: UserCriteria;
}): Promise<string> {
  const fallback = () => fallbackChatGreeting(input.criteria);
  const generated = await generateMessage("chat_greeting", {
    task: "Reply warmly to a conversational message and invite the user to share EV budget, use case, charging or range needs, and one preference.",
    message: input.message,
    language: input.criteria.language,
    knownCriteria: criteriaSummary(input.criteria)
  });

  return generated ?? fallback();
}

export async function generateNoMatchesMessage(input: NoMatchesInput): Promise<string> {
  const fallback = () => fallbackNoMatchesMessage(input.criteria, input.rejectedSummary);
  const generated = await generateMessage("no_matches", {
    task: "Explain that no EV matched the hard filters and suggest which filter to relax. Mention the main rejection reason when provided.",
    language: input.criteria.language,
    criteria: input.criteria,
    rejectedSummary: input.rejectedSummary
  });

  return generated ?? fallback();
}

export async function generateNoMoreMatchesMessage(criteria: UserCriteria): Promise<string> {
  const fallback = () => fallbackNoMoreMatchesMessage(criteria);
  const generated = await generateMessage("no_more_matches", {
    task: "Explain that all matching cars for this search were already shown and suggest relaxing a hard filter to see more options.",
    language: criteria.language,
    criteria
  });

  return generated ?? fallback();
}

export async function generateMatchIntroMessage(input: {
  criteria: UserCriteria;
  recommendationCount: number;
  lowConfidenceQuestion?: string | null;
  rejectedSummary?: RejectedSummary[];
}): Promise<string> {
  const fallback = () =>
    fallbackMatchIntroMessage(input.criteria, input.recommendationCount, input.lowConfidenceQuestion);
  const generated = await generateMessage("match_intro", {
    task: "Briefly introduce the ranked EV listings. Mention that hard limits like budget, availability, and explicit range were respected. Add the lowConfidenceQuestion when provided.",
    language: input.criteria.language,
    recommendationCount: input.recommendationCount,
    lowConfidenceQuestion: input.lowConfidenceQuestion ?? null,
    rejectedSummary: input.rejectedSummary ?? [],
    criteria: input.criteria
  });

  return generated ?? fallback();
}

export async function generateLowConfidenceQuestion(criteria: UserCriteria): Promise<string> {
  const fallback = () => fallbackLowConfidenceQuestion(criteria);
  const generated = await generateMessage("low_confidence_followup", {
    task: "Ask one short question to clarify whether to prioritize lower mileage, longer range, or premium comfort.",
    language: criteria.language,
    criteria
  });

  return generated ?? fallback();
}

function resolveMessageLanguage(context: Record<string, unknown>): Language {
  return context.language === "de" || context.language === "en" ? context.language : "en";
}

async function generateMessage(kind: string, context: Record<string, unknown>): Promise<string | null> {
  if (!llmEnabled()) return null;
  const language = resolveMessageLanguage(context);
  const systemPrompt = `${assistantMessageSystemPromptBase} ${languageReplyInstruction(language)}`;

  try {
    const response = await createOpenAiClient().chat.completions.create(
      {
        model: openAiModel(),
        temperature: 0.35,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify({ kind, ...context }) }
        ]
      },
      { timeout: 1400 }
    );
    return parseMessageJson(response.choices[0]?.message?.content ?? "");
  } catch {
    return null;
  }
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

export function fallbackChatGreeting(criteria: UserCriteria) {
  if (criteria.language === "de") {
    return "Hey, wie kann ich dir helfen? Nenn mir Budget, Einsatzzweck, Lade- oder Reichweitenbedarf und eine Praeferenz.";
  }
  return "Hey, how can I help you today? Tell me your EV budget, use case, charging or range needs, and one preference.";
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
  lowConfidenceQuestion?: string | null
) {
  const base =
    criteria.language === "de"
      ? `${recommendationCount} passende E-Auto${recommendationCount === 1 ? "" : "s"} gefunden. Ich habe harte Grenzen wie Budget, Verfuegbarkeit und explizite Reichweite zuerst eingehalten.`
      : `Found ${recommendationCount} matching EV${recommendationCount === 1 ? "" : "s"}. I kept hard limits like budget, availability, and explicit range first.`;
  return lowConfidenceQuestion ? `${base} ${lowConfidenceQuestion}` : base;
}

export function fallbackLowConfidenceQuestion(criteria: UserCriteria) {
  return criteria.language === "de"
    ? "Soll ich eher niedrigen Kilometerstand, laengere Reichweite oder Premium-Komfort priorisieren?"
    : "Should I prioritize lower mileage, longer range, or premium comfort?";
}
