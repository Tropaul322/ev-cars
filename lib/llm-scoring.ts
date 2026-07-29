import { criteriaSummary, languageLabel, languageReplyInstruction } from "./criteria.ts";
import {
  createOpenAiChatCompletion,
  openAiChatTimeout,
  openAiConfigured,
  openAiModel
} from "./openai-provider.ts";
import { PROMPT_GUARD_SYSTEM_NOTE } from "./prompt-guard.ts";
import type { MatchResult, RagContext, UserCriteria } from "./types.ts";

export type LlmVehicleRanking = {
  vehicleId: string;
  score: number;
  fitSummary?: string;
};

export type LlmScoringResult = {
  rankings: LlmVehicleRanking[];
  usedLlm: boolean;
};

/** Keep the prompt small enough to finish inside the match-scoring timeout. */
export const LLM_SCORING_CANDIDATE_LIMIT = 8;

export const llmScoringSystemPrompt =
  "You are FlowRyd's EV fit-scoring engine for the Austrian market. " +
  "Each candidate vehicle already passed hard filters (budget ceiling, body type, brand, mileage, etc.). " +
  "Your job is to assign an overall fit score from 0 to 100 for how well each vehicle matches the shopper's intent. " +
  "Use only the provided userMessage, criteriaSummary, vehicle facts, ruleScore hints, and retrievedEvidence. " +
  "Never invent specs, prices, range, or availability. " +
  "Scoring guidance: " +
  "90-100 excellent fit across budget, range, brand/model intent, use case, and features; " +
  "75-89 strong fit with minor tradeoffs; " +
  "60-74 acceptable but meaningful compromises; " +
  "below 60 weak fit for this shopper. " +
  "Weight range and trip suitability heavily when the user mentions road trips, long drives, or good range. " +
  "Weight brand/model preferences when explicitly named. " +
  "Penalize vehicles far from budget unless monthly lease makes them viable. " +
  "Penalize missing must-have features. " +
  "Prefer vehicles that clearly match qualitative signals such as premium, low mileage, or battery health. " +
  "ruleScore is a deterministic hint only; you may override it when user intent clearly favors a different ranking. " +
  "Return JSON only: {\"rankings\":[{\"vehicleId\":\"...\",\"score\":0-100,\"fitSummary\":\"one short sentence\"}]}. " +
  "Every provided vehicleId must appear exactly once. " +
  PROMPT_GUARD_SYSTEM_NOTE;

export function llmScoringEnabled() {
  // Opt-in only: scoring is too slow/timeout-prone on the match hot path.
  return (
    process.env.FLOWRYD_ENABLE_LLM_SCORING === "1" &&
    process.env.FLOWRYD_DISABLE_LLM !== "1" &&
    process.env.FLOWRYD_DISABLE_LLM_SCORING !== "1" &&
    openAiConfigured()
  );
}

export async function rankRecommendationsWithLlm(
  matches: MatchResult[],
  criteria: UserCriteria,
  message: string,
  ragContext?: RagContext
): Promise<LlmScoringResult> {
  if (!llmScoringEnabled() || matches.length < 2) {
    return { rankings: [], usedLlm: false };
  }

  const candidates = matches.slice(0, LLM_SCORING_CANDIDATE_LIMIT);
  const llmRankings = await scoreVehiclesWithLlm(candidates, criteria, message, ragContext);
  if (!llmRankings.length) {
    return { rankings: [], usedLlm: false };
  }

  return {
    rankings: llmRankings,
    usedLlm: true
  };
}

export function applyLlmRankings(matches: MatchResult[], rankings: LlmVehicleRanking[]) {
  if (!rankings.length) return matches;

  const byVehicleId = new Map(rankings.map((ranking) => [ranking.vehicleId, ranking]));
  const ranked = matches
    .map((match) => {
      const ranking = byVehicleId.get(match.vehicle.id);
      if (!ranking) return match;
      return {
        ...match,
        ruleScore: match.ruleScore ?? match.score,
        llmScore: ranking.score,
        score: ranking.score,
        scoreSource: "llm" as const,
        llmFitSummary: ranking.fitSummary,
        // LLM replaces the displayed score; semantic boost no longer explains the delta.
        semanticBoost: undefined
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.vehicle.embeddingSimilarity ?? 0) - (left.vehicle.embeddingSimilarity ?? 0) ||
        right.ragScore - left.ragScore
    );

  return ranked;
}

async function scoreVehiclesWithLlm(
  matches: MatchResult[],
  criteria: UserCriteria,
  message: string,
  ragContext?: RagContext
) {
  // Single attempt: retries double latency when the usual failure mode is timeout.
  return scoreVehiclesWithLlmOnce(matches, criteria, message, ragContext);
}

async function scoreVehiclesWithLlmOnce(
  matches: MatchResult[],
  criteria: UserCriteria,
  message: string,
  ragContext?: RagContext
): Promise<LlmVehicleRanking[]> {
  if (!openAiConfigured()) return [];

  try {
    const response = await createOpenAiChatCompletion(
      "match-scoring",
      {
        model: openAiModel(),
        temperature: 0.1,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: llmScoringSystemPrompt },
          {
            role: "user",
            content: JSON.stringify(buildLlmScoringInput(matches, criteria, message, ragContext))
          }
        ]
      },
      { timeout: openAiChatTimeout("match-scoring") }
    );
    const content = response.choices[0]?.message?.content;
    if (!content) return [];
    const rankings = parseLlmScoringJson(content);
    return hasUsableLlmRankings(rankings, matches) ? rankings : [];
  } catch {
    // createOpenAiChatCompletion already logs the timeout/error.
    return [];
  }
}

function hasUsableLlmRankings(rankings: LlmVehicleRanking[], matches: MatchResult[]) {
  if (rankings.length < Math.min(2, matches.length)) return false;
  const validIds = new Set(matches.map((match) => match.vehicle.id));
  return rankings.every((ranking) => validIds.has(ranking.vehicleId));
}

export function buildLlmScoringInput(
  matches: MatchResult[],
  criteria: UserCriteria,
  message: string,
  ragContext?: RagContext
) {
  return {
    userMessage: message,
    language: criteria.language,
    requiredResponseLanguage: languageLabel(criteria.language),
    responseLanguageInstruction: languageReplyInstruction(criteria.language),
    criteriaSummary: criteriaSummary(criteria),
    ragTopicAffinity: ragContext?.topicAffinity ?? {},
    vehicles: matches.slice(0, LLM_SCORING_CANDIDATE_LIMIT).map((match) => ({
      vehicleId: match.vehicle.id,
      vehicle: {
        make: match.vehicle.make,
        model: match.vehicle.model,
        year: match.vehicle.year,
        condition: match.vehicle.condition,
        bodyType: match.vehicle.bodyType,
        brandOrigin: match.vehicle.brandOrigin,
        priceEUR: match.vehicle.priceEUR,
        monthlyLeaseEUR: match.vehicle.monthlyLeaseEUR,
        rangeKm: match.vehicle.rangeKm,
        batterySoH: match.vehicle.batterySoH,
        mileageKm: match.vehicle.mileageKm,
        drivetrain: match.vehicle.drivetrain,
        seats: match.vehicle.seats,
        cargoLiters: match.vehicle.cargoLiters,
        features: match.vehicle.features.slice(0, 8),
        available: match.vehicle.available
      },
      ruleScore: match.ruleScore ?? match.score,
      tradeoffs: match.ruledOutReasons.slice(0, 2),
      retrievedEvidence: match.ragEvidence.slice(0, 1).map((evidence, evidenceIndex) => ({
        evidenceId: `E${evidenceIndex + 1}`,
        topic: evidence.topic,
        excerpt: evidence.excerpt.slice(0, 160),
        score: evidence.score
      }))
    }))
  };
}

export function parseLlmScoringJson(content: string): LlmVehicleRanking[] {
  const parsed = JSON.parse(stripJsonFence(content)) as { rankings?: unknown };
  if (!Array.isArray(parsed.rankings)) return [];

  return parsed.rankings
    .filter(isLlmVehicleRanking)
    .map((ranking) => ({
      vehicleId: ranking.vehicleId,
      score: clampScore(ranking.score),
      fitSummary: ranking.fitSummary
    }));
}

function stripJsonFence(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1] ?? trimmed;
}

function isLlmVehicleRanking(value: unknown): value is LlmVehicleRanking {
  if (!value || typeof value !== "object") return false;
  const ranking = value as Partial<LlmVehicleRanking>;
  return typeof ranking.vehicleId === "string" && Number.isFinite(Number(ranking.score));
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
