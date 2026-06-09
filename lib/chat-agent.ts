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
  "You are FlowRyd, a friendly Austrian EV shopping chat agent. Decide how to respond before any DB matching. Do not choose vehicles. Return only JSON: {\"action\":\"chat|clarification|match\",\"assistantMessage\":\"...\"}. " +
  "Use action chat for greetings, thanks, small talk, help requests, or other conversational messages that do not add search criteria — always write a warm assistantMessage in the user's language. " +
  "Use action clarification when the user is searching but readiness.readyToMatch is false — ask one concise question that targets the highest-priority missing criteria in readiness.missingCriteria, acknowledge knownCriteria when present, and always write assistantMessage. " +
  "Use action match only when readiness.readyToMatch is true and the user is providing or refining EV search criteria (not just greeting or thanking); set assistantMessage to null. " +
  "Reply in the language field or match the user's message language.";

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

  if (action === "match" && !basePlan.readiness.readyToMatch) {
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

  if (readiness.readyToMatch && preferredAction !== "chat" && preferredAction !== "clarification") {
    return { ...basePlan, action: "match", assistantMessage: null };
  }

  const action = preferredAction === "chat" ? "chat" : "clarification";
  const assistantMessage =
    action === "clarification"
      ? clarificationQuestion(input.criteria)
      : "Hey, how can I help you today? Tell me your EV budget, use case, charging or range needs, and one preference.";

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
    previousCriteria: input.previousCriteria,
    criteria: input.criteria
  };
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
