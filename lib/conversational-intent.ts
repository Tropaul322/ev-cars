import type { LlmConversationTurn } from "./llm-conversation.ts";

export type ConversationTurnKind =
  | "small_talk"
  | "meta"
  | "ev_question"
  | "criteria"
  | "show_matches";

export type ResolveConversationTurnInput = {
  message: string;
  conversationHistory?: LlmConversationTurn[];
  currentPromptKey?: string | null;
  knownCriteria?: string[];
};

const DEFINITE_PATTERN_KINDS: ConversationTurnKind[] = ["meta", "small_talk", "show_matches"];

const turnClassifierPrompt = `You classify the user's latest message in an EV shopping assistant chat (FlowRyd).

Return ONLY valid JSON: {"turnKind":"small_talk"|"meta"|"ev_question"|"criteria"|"show_matches"}

Turn kinds:
- small_talk: greetings, how are you, thanks, casual chat not about car shopping
- meta: asks what the assistant can do, who it is, or how it works
- ev_question: asks about EV topics (charging, range, incentives, brands) without providing new search criteria
- criteria: provides or updates budget, use case, body style, charging needs, or answers the active clarification step
- show_matches: explicitly asks to see matches, results, listings, or cars now

Rules:
1. Use conversation history and currentPromptKey — if the assistant just asked a clarification and the user answers it, use criteria even for short replies.
2. Prefer criteria when the user states budget, use case, body type, charging preference, or brand/model constraints.
3. Do not label criteria updates as small_talk just because they are casual.
4. patternHint is a fast heuristic; override it when clearly wrong.
5. German and English are both supported.`;

const assistantMetaPatterns = [
  /\bwhat can you do\b/i,
  /\bwhat can (it|this|flowryd) do\b/i,
  /\bwhat (are|is) you\b/i,
  /\bwho are you\b/i,
  /\bwhat is flowryd\b/i,
  /\bwho is flowryd\b/i,
  /\bhow does (this|it|flowryd) work\b/i,
  /\bhow do you work\b/i,
  /\bwhat do you do\b/i,
  /\btell me about yourself\b/i,
  /\bwhat can i ask\b/i,
  /\bhow can you help\b/i,
  /\bcan you help me\b/i,
  /\bwas kannst du\b/i,
  /\bwas kann (es|das)\b/i,
  /\bwas ist flowryd\b/i,
  /\bwer bist du\b/i,
  /\bwas bist du\b/i,
  /\bwie funktioniert (das|es|flowryd)\b/i,
  /\bwobei kannst du (mir )?helfen\b/i,
  /\bwas machst du\b/i
];

const casualSmallTalkPatterns = [
  /^(y+o+|he+y+|hi+|hola+|sup)\b/i,
  /^(hi|hey|hello|hallo|servus|moin|good\s+(morning|afternoon|evening)|guten\s+(morgen|tag|abend))\b/i,
  /\b(how are you|how'?s it going|what'?s up|whats up|how do you do|nice to meet you|good to see you|how have you been)\b/i,
  /\b(wie geht|wie gehts|alles klar|was geht|na wie|wie läuft)\b/i,
  /^(thanks|thank you|danke|thx|ok|okay|cool|great|got it|understood|perfect|nice|cheers|sounds good|alright)\b/i
];

const evTopicPatterns = [
  /\b(charg\w*|range|reichweite|battery|batterie|ev|e-?auto|electric|wallbox|kilometer|mileage|suv|budget|price|preis|incentive|förder|foerder|tesla|kia|bmw|audi|vw|volkswagen|hyundai|polestar|byd|plug|laden|lade)\b/i,
  /\b(test drive|probefahrt|tco|leasing|finanz|warranty|garantie|heat pump|wärmepumpe|carplay|android auto)\b/i
];

const showMatchesPattern =
  /\b(show\s+(me\s+)?(the\s+)?(matches|results|cars|options|listings)|see\s+(the\s+)?(results|matches|cars)|matches?\s+anzeigen|treffer\s+anzeigen|ergebnisse\s+(anzeigen|zeigen)|zeig\s+mir\s+(die\s+)?(autos|treffer|ergebnisse))\b/i;

export function isAssistantMetaQuestion(message: string) {
  const text = message.trim();
  if (!text) return false;
  return assistantMetaPatterns.some((pattern) => pattern.test(text));
}

export function isCasualSmallTalk(message: string) {
  const text = message.trim();
  if (!text) return false;
  if (text.length <= 3) return true;
  return casualSmallTalkPatterns.some((pattern) => pattern.test(text));
}

export function isGreeting(message: string) {
  return isCasualSmallTalk(message);
}

export function isExplicitShowMatches(message: string) {
  return showMatchesPattern.test(message.trim());
}

export function looksLikeEvQuestion(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (isCasualSmallTalk(trimmed) || isAssistantMetaQuestion(trimmed)) return false;

  const isQuestion =
    trimmed.endsWith("?") ||
    /^(what|which|how|why|who|where|when|do|does|did|is|are|can|could|would|should|tell me|explain|was|welche[rs]?|wie|warum|wieso|wo|wann|gibt|kann|ist|sind|erklär|erkläre)\b/i.test(
      trimmed
    );

  if (!isQuestion) return false;
  return evTopicPatterns.some((pattern) => pattern.test(trimmed));
}

/**
 * Fast, deterministic turn classification used before matching or clarification.
 * Prefers chat-style replies for greetings and off-topic conversation.
 */
export function classifyConversationTurn(message: string): ConversationTurnKind {
  const text = message.trim();
  if (!text) return "criteria";

  if (isAssistantMetaQuestion(text)) return "meta";
  if (isCasualSmallTalk(text)) return "small_talk";
  if (isExplicitShowMatches(text)) return "show_matches";
  if (looksLikeEvQuestion(text)) return "ev_question";
  return "criteria";
}

/**
 * Combines fast pattern classification with optional LLM refinement.
 * Definite pattern hits (meta, small_talk, show_matches) are kept; the LLM
 * mainly improves criteria vs ev_question vs missed small talk.
 */
export function mergeConversationTurnClassification(
  pattern: ConversationTurnKind,
  llm: ConversationTurnKind | null
): ConversationTurnKind {
  if (DEFINITE_PATTERN_KINDS.includes(pattern)) return pattern;
  if (!llm) return pattern;
  if (llm === "criteria") return "criteria";
  if (pattern === "criteria") return llm;
  return llm;
}

export async function resolveConversationTurn(
  input: ResolveConversationTurnInput
): Promise<ConversationTurnKind> {
  const pattern = classifyConversationTurn(input.message);
  if (DEFINITE_PATTERN_KINDS.includes(pattern)) return pattern;

  const llm = await classifyConversationTurnWithLlm(input, pattern);
  return mergeConversationTurnClassification(pattern, llm);
}

export function isConversationalAside(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return /^(thanks|thank you|danke|thx|ok|okay|cool|great|got it|understood|perfect|nice|cheers|sounds good|alright)\b/i.test(
    trimmed
  );
}

function llmClassifierEnabled() {
  return process.env.FLOWRYD_DISABLE_LLM !== "1";
}

async function classifyConversationTurnWithLlm(
  input: ResolveConversationTurnInput,
  patternHint: ConversationTurnKind
): Promise<ConversationTurnKind | null> {
  if (!llmClassifierEnabled()) return null;

  const { createOpenAiChatCompletion, openAiConfigured, openAiModel } = await import("./openai-provider.ts");
  if (!openAiConfigured()) return null;

  const { buildLlmMessages } = await import("./llm-conversation.ts");

  try {
    const response = await createOpenAiChatCompletion(
      "turn-classifier",
      {
        model: openAiModel(),
        temperature: 0,
        response_format: { type: "json_object" },
        messages: buildLlmMessages(
          turnClassifierPrompt,
          input.conversationHistory ?? [],
          JSON.stringify({
            message: input.message,
            patternHint,
            currentPromptKey: input.currentPromptKey ?? null,
            knownCriteria: input.knownCriteria ?? []
          })
        )
      },
      { timeout: 2000 }
    );
    return parseTurnKindJson(response.choices[0]?.message?.content ?? "");
  } catch {
    return null;
  }
}

export function parseTurnKindJson(content: string): ConversationTurnKind | null {
  if (!content.trim()) return null;
  try {
    const parsed = JSON.parse(stripJsonFence(content)) as { turnKind?: unknown };
    return isConversationTurnKind(parsed.turnKind) ? parsed.turnKind : null;
  } catch {
    return null;
  }
}

function isConversationTurnKind(value: unknown): value is ConversationTurnKind {
  return (
    value === "small_talk" ||
    value === "meta" ||
    value === "ev_question" ||
    value === "criteria" ||
    value === "show_matches"
  );
}

function stripJsonFence(content: string) {
  return content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}
