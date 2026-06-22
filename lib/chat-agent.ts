import { generateChatGreeting, generateClarificationMessage } from "./assistant-messages.ts";
import {
  criteriaSummary,
  getCriteriaReadiness,
  languageLabel,
  languageReplyInstruction,
  type CriteriaReadiness
} from "./criteria.ts";
import { createOpenAiClient, openAiConfigured, openAiModel } from "./openai-provider.ts";
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

const agentSystemPrompt =
  "You are FlowRyd, a friendly Austrian EV shopping chat agent. Decide how to respond before any DB matching. Do not choose vehicles. Return only JSON: {\"action\":\"chat|clarification|match\",\"assistantMessage\":\"...\"}. " +
  "Use action chat for greetings, thanks, small talk, help requests, or other conversational messages that do not add search criteria — always write a warm assistantMessage in the user's language. " +
  "Use action clarification when the user is searching but readiness.readyToMatch is false — ask one concise question that targets the highest-priority missing criteria in readiness.missingCriteria, acknowledge knownCriteria when present, and always write assistantMessage. " +
  "Use action match only when readiness.readyToMatch is true and the user is providing or refining EV search criteria (not just greeting or thanking); set assistantMessage to null. " +
  "Always follow responseLanguageInstruction and write assistantMessage in requiredResponseLanguage.";

export async function planAgentTurn(input: PlanAgentTurnInput): Promise<AgentTurnPlan> {
  const readiness = getCriteriaReadiness(input.criteria);
  const basePlan = {
    missingCriteria: readiness.missingCriteria,
    readiness
  };

  if (process.env.FLOWRYD_DISABLE_LLM === "1") {
    return await buildFallbackPlan(input, readiness);
  }

  const generated = await generateAgentDecision(input, readiness);
  if (generated?.action) {
    return await reconcileLlmPlan(generated, input, basePlan);
  }

  return await buildFallbackPlan(input, readiness);
}

async function reconcileLlmPlan(
  generated: AgentLlmDecision,
  input: PlanAgentTurnInput,
  basePlan: Pick<AgentTurnPlan, "missingCriteria" | "readiness">
): Promise<AgentTurnPlan> {
  let action = generated.action!;
  const assistantMessage = sanitizeAssistantMessage(generated.assistantMessage ?? "") ?? null;

  if (action === "match" && !canMatch(input.criteria, basePlan.readiness)) {
    action = "clarification";
  }

  if (action === "match") {
    return { ...basePlan, action, assistantMessage: null };
  }

  if (!assistantMessage) {
    return await buildFallbackPlan(input, basePlan.readiness, action);
  }

  return { ...basePlan, action, assistantMessage };
}

async function buildFallbackPlan(
  input: PlanAgentTurnInput,
  readiness: CriteriaReadiness,
  preferredAction?: AgentAction
): Promise<AgentTurnPlan> {
  const basePlan = {
    missingCriteria: readiness.missingCriteria,
    readiness
  };

  if (canMatch(input.criteria, readiness) && preferredAction !== "chat" && preferredAction !== "clarification") {
    return { ...basePlan, action: "match", assistantMessage: null };
  }

  const action = preferredAction === "chat" ? "chat" : "clarification";
  const assistantMessage =
    action === "clarification"
      ? await generateClarificationMessage({
          message: input.message,
          criteria: input.criteria,
          missingCriteria: readiness.missingCriteria
        })
      : await generateChatGreeting({ message: input.message, criteria: input.criteria });

  return { ...basePlan, action, assistantMessage };
}

async function generateAgentDecision(
  input: PlanAgentTurnInput,
  readiness: CriteriaReadiness
): Promise<AgentLlmDecision | null> {
  if (openAiConfigured()) return generateOpenAiAgentDecision(input, readiness);
  return null;
}

async function generateOpenAiAgentDecision(
  input: PlanAgentTurnInput,
  readiness: CriteriaReadiness
): Promise<AgentLlmDecision | null> {
  if (!openAiConfigured()) return null;

  try {
    const response = await createOpenAiClient().chat.completions.create(
      {
        model: openAiModel(),
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: agentSystemPrompt },
          { role: "user", content: JSON.stringify(buildAgentDecisionInput(input, readiness)) }
        ]
      },
      { timeout: 1400 }
    );
    return parseAgentDecisionJson(response.choices[0]?.message?.content ?? "");
  } catch {
    return null;
  }
}

function buildAgentDecisionInput(input: PlanAgentTurnInput, readiness: CriteriaReadiness) {
  return {
    message: input.message,
    language: input.criteria.language,
    requiredResponseLanguage: languageLabel(input.criteria.language),
    responseLanguageInstruction: languageReplyInstruction(input.criteria.language),
    readiness,
    confidence: input.confidence,
    knownCriteria: criteriaSummary(input.criteria),
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
