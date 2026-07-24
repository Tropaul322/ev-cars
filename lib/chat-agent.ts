import {
  clarificationQuestion,
  criteriaSummary,
  getCriteriaReadiness,
  type CriteriaReadiness
} from "./criteria.ts";
import type { MissingCriteria, UserCriteria } from "./types.ts";

type AgentAction = "chat" | "clarification" | "match";

export type AgentTurnPlan = {
  action: AgentAction;
  assistantMessage: string | null;
  missingCriteria: MissingCriteria[];
  readiness: CriteriaReadiness;
};

type PlanAgentTurnInput = {
  message: string;
  criteria: UserCriteria;
  previousCriteria?: UserCriteria | null;
  confidence: number;
};

type AgentLlmDecision = {
  action?: AgentAction;
  assistantMessage?: string;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

const agentSystemPrompt =
  "You are FlowRyd, a warm, concise Austrian EV shopping assistant. Decide how to respond before any DB matching. Do not choose vehicles. Return only JSON: {\"action\":\"chat|clarification|match\",\"assistantMessage\":\"...\"}. " +
  "Sound like a helpful human texting — natural, specific, never robotic. " +
  "Use action chat for greetings, thanks, small talk, help requests, capability questions, or conversational turns that do not add search criteria. Always write a warm assistantMessage in the user's language that briefly explains you help find EVs in Austria and invites budget + use case. " +
  "Use action clarification when the user is searching but readiness.readyToMatch is false — ask ONE concise question targeting the highest-priority item in readiness.missingCriteria, briefly acknowledge knownCriteria when present, and always write assistantMessage. " +
  "Use action match only when readiness.readyToMatch is true and the user is providing or refining EV search criteria (including follow-ups like cheaper/more range/show more). For match set assistantMessage to null. " +
  "Never ask for a criterion that is already present in knownCriteria/groups. Prefer the user's language field, otherwise mirror the message language.";

export async function planAgentTurn(input: PlanAgentTurnInput): Promise<AgentTurnPlan> {
  const readiness = getCriteriaReadiness(input.criteria);
  const basePlan = {
    missingCriteria: readiness.missingCriteria,
    readiness
  };

  if (process.env.FLOWRYD_DISABLE_LLM === "1") {
    return buildFallbackPlan(input, readiness);
  }

  const generated = await generateAgentDecision(input, readiness);
  if (generated?.action) {
    return reconcileLlmPlan(generated, input, basePlan);
  }

  return buildFallbackPlan(input, readiness);
}

function reconcileLlmPlan(
  generated: AgentLlmDecision,
  input: PlanAgentTurnInput,
  basePlan: Pick<AgentTurnPlan, "missingCriteria" | "readiness">
): AgentTurnPlan {
  let action = generated.action!;
  const assistantMessage = sanitizeAssistantMessage(generated.assistantMessage ?? "") ?? null;

  if (detectConversationalIntent(input.message) && !hasFreshSearchSignal(input) && !canMatch(input.criteria, basePlan.readiness)) {
    action = "chat";
  }

  if (action === "match" && !canMatch(input.criteria, basePlan.readiness)) {
    action = "clarification";
  }

  if (action === "match") {
    return { ...basePlan, action, assistantMessage: null };
  }

  if (!assistantMessage) {
    return buildFallbackPlan(input, basePlan.readiness, action);
  }

  return { ...basePlan, action, assistantMessage };
}

function buildFallbackPlan(
  input: PlanAgentTurnInput,
  readiness: CriteriaReadiness,
  preferredAction?: AgentAction
): AgentTurnPlan {
  const basePlan = {
    missingCriteria: readiness.missingCriteria,
    readiness
  };

  const conversational = detectConversationalIntent(input.message);
  if (
    (conversational || preferredAction === "chat") &&
    !hasFreshSearchSignal(input) &&
    preferredAction !== "match" &&
    preferredAction !== "clarification"
  ) {
    return {
      ...basePlan,
      action: "chat",
      assistantMessage: conversationalChatReply(input.criteria, conversational)
    };
  }

  if (canMatch(input.criteria, readiness) && preferredAction !== "chat" && preferredAction !== "clarification") {
    return { ...basePlan, action: "match", assistantMessage: null };
  }

  const action = preferredAction === "chat" ? "chat" : "clarification";
  const assistantMessage =
    action === "clarification"
      ? clarificationQuestion(input.criteria)
      : conversationalChatReply(input.criteria, conversational || "greeting");

  return { ...basePlan, action, assistantMessage };
}

async function generateAgentDecision(
  input: PlanAgentTurnInput,
  readiness: CriteriaReadiness
): Promise<AgentLlmDecision | null> {
  if (process.env.GEMINI_API_KEY) return generateGeminiAgentDecision(input, readiness);
  if (process.env.OPENAI_API_KEY) return generateOpenAiAgentDecision(input, readiness);
  return null;
}

async function generateOpenAiAgentDecision(
  input: PlanAgentTurnInput,
  readiness: CriteriaReadiness
): Promise<AgentLlmDecision | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: agentSystemPrompt },
          { role: "user", content: JSON.stringify(buildAgentDecisionInput(input, readiness)) }
        ]
      }),
      signal: AbortSignal.timeout(1400)
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return parseAgentDecisionJson(data.choices?.[0]?.message?.content ?? "");
  } catch {
    return null;
  }
}

async function generateGeminiAgentDecision(
  input: PlanAgentTurnInput,
  readiness: CriteriaReadiness
): Promise<AgentLlmDecision | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";
  const model = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
  const modelPath = model.startsWith("models/") ? model : `models/${model}`;

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/${modelPath}:generateContent?${new URLSearchParams({ key: apiKey })}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: agentSystemPrompt }] },
          contents: [
            {
              role: "user",
              parts: [{ text: JSON.stringify(buildAgentDecisionInput(input, readiness)) }]
            }
          ],
          generationConfig: {
            temperature: 0.3,
            response_mime_type: "application/json"
          }
        }),
        signal: AbortSignal.timeout(1600)
      }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as GeminiGenerateContentResponse;
    const content = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
    return parseAgentDecisionJson(content ?? "");
  } catch {
    return null;
  }
}

function buildAgentDecisionInput(input: PlanAgentTurnInput, readiness: CriteriaReadiness) {
  return {
    message: input.message,
    language: input.criteria.language,
    readiness,
    confidence: input.confidence,
    knownCriteria: criteriaSummary(input.criteria),
    conversationalIntent: detectConversationalIntent(input.message),
    previousCriteria: input.previousCriteria,
    criteria: input.criteria
  };
}

function canMatch(criteria: UserCriteria, readiness: CriteriaReadiness) {
  return (
    readiness.readyToMatch ||
    Boolean(criteria.brandPreferences.length || criteria.preferredBrandOrigins.length || criteria.modelPreferences.length)
  );
}

function hasFreshSearchSignal(input: PlanAgentTurnInput) {
  const message = input.message.trim();
  if (!message) return false;
  if (detectConversationalIntent(message) && message.length < 48) return false;
  return Boolean(
    /\b(\d+\s?k|\d{4,6}|budget|€|eur|lease|leasing|suv|range|reichweite|km|family|familie|commute|pendel|wallbox|tesla|kia|bmw|audi|vw|ford|byd|ioniq|model\s?[3y]|ev\s?\d)\b/i.test(
      message
    ) ||
      input.criteria.budgetMaxEUR ||
      input.criteria.monthlyBudgetEUR ||
      input.criteria.brandPreferences.length ||
      input.criteria.modelPreferences.length ||
      input.criteria.preferredBrandOrigins.length ||
      input.criteria.bodyTypes.length ||
      input.criteria.tripNeeds.length ||
      input.criteria.mustHaveFeatures.length
  );
}

export type ConversationalIntent = "greeting" | "thanks" | "help" | "small_talk" | null;

export function detectConversationalIntent(message: string): ConversationalIntent {
  const text = message.trim().toLowerCase();
  if (!text) return "greeting";
  if (
    /^(hi|hey|hello|hallo|servus|grüß(?:\s*gott)?|gruss|guten (?:tag|morgen|abend)|moin)(?:\s+there)?[\s!.?]*$/i.test(
      text
    )
  ) {
    return "greeting";
  }
  if (/^(thanks|thank you|thx|ty|danke|dankeschön|perfekt,?\s*danke)[\s!.?]*$/i.test(text)) {
    return "thanks";
  }
  if (
    /\b(what can you (do|help)|how (can|do) you help|help me|was kannst du|wobei kannst du helfen|wie funktioniert)\b/i.test(
      text
    )
  ) {
    return "help";
  }
  if (/^(how are you|how's it going|was geht|alles klar\??|wie geht'?s)[\s!.?]*$/i.test(text)) {
    return "small_talk";
  }
  return null;
}

function conversationalChatReply(criteria: UserCriteria, intent: ConversationalIntent) {
  const language = criteria.language;
  if (intent === "thanks") {
    return language === "de"
      ? "Gerne! Wenn du willst, kann ich die Suche verfeinern (günstiger, mehr Reichweite, mehr Platz) oder dir weitere Autos zeigen."
      : "You're welcome! I can refine the search (cheaper, more range, more space) or show more cars whenever you're ready.";
  }
  if (intent === "help") {
    return language === "de"
      ? "Ich helfe dir, passende E-Autos in Österreich zu finden. Sag mir am besten Budget (Kauf oder Leasing), Nutzung (Stadt, Pendeln, Familie, Langstrecke) und ob du zu Hause laden kannst."
      : "I help you find fitting EVs in Austria. Share a budget (purchase or lease), how you'll use the car (city, commute, family, road trips), and whether you can charge at home.";
  }
  if (intent === "small_talk") {
    return language === "de"
      ? "Mir geht's gut — bereit, dir ein passendes E-Auto zu suchen. Was ist dein Budget und wofür brauchst du das Auto?"
      : "Doing well — ready to help you find the right EV. What's your budget, and what will you mainly use the car for?";
  }
  return language === "de"
    ? "Hey! Ich bin FlowRyd und helfe dir bei der E-Auto-Suche in Österreich. Erzähl mir kurz Budget, Nutzung und Lade-/Reichweitenbedarf."
    : "Hey! I'm FlowRyd — I help you find EVs in Austria. Tell me your budget, use case, and charging or range needs.";
}

function parseAgentDecisionJson(content: string): AgentLlmDecision | null {
  if (!content.trim()) return null;
  const parsed = JSON.parse(stripJsonFence(content)) as {
    action?: unknown;
    assistantMessage?: unknown;
  };
  if (parsed.action !== "chat" && parsed.action !== "clarification" && parsed.action !== "match") {
    return null;
  }
  return {
    action: parsed.action,
    assistantMessage:
      typeof parsed.assistantMessage === "string" ? sanitizeAssistantMessage(parsed.assistantMessage) ?? undefined : undefined
  };
}

function stripJsonFence(content: string) {
  return content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

function sanitizeAssistantMessage(message: string) {
  const trimmed = message.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 900);
}
