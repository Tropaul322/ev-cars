import { criteriaSummary, languageLabel, languageReplyInstruction } from "./criteria.ts";
import { llmDebug } from "./llm-debug.ts";
import {
  createOpenAiChatCompletion,
  openAiChatTimeout,
  openAiConfigured,
  openAiModel
} from "./openai-provider.ts";
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

export const llmScoringSystemPrompt =
  "You are FlowRyd's EV fit-scoring engine for the Austrian market. " +
  "Each candidate vehicle already passed hard filters (budget ceiling, body type, brand, mileage, etc.). " +
  "Your job is to assign an overall fit score from 0 to 100 for how well each vehicle matches the shopper's intent. " +
  "Use only the provided userMessage, criteria, vehicle facts, ruleScore hints, and retrievedEvidence. " +
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
  "Every provided vehicleId must appear exactly once.";

export function llmScoringEnabled() {
  return process.env.FLOWRYD_DISABLE_LLM !== "1" && process.env.FLOWRYD_DISABLE_LLM_SCORING !== "1" && openAiConfigured();
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

  const candidates = matches.slice(0, 20);
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
        llmFitSummary: ranking.fitSummary
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
  const first = await scoreVehiclesWithLlmOnce(matches, criteria, message, ragContext);
  if (hasUsableLlmRankings(first, matches)) return first;

  const retry = await scoreVehiclesWithLlmOnce(matches, criteria, message, ragContext);
  return hasUsableLlmRankings(retry, matches) ? retry : first.length ? first : retry;
}

function hasUsableLlmRankings(rankings: LlmVehicleRanking[], matches: MatchResult[]) {
  if (rankings.length < Math.min(2, matches.length)) return false;
  const validIds = new Set(matches.map((match) => match.vehicle.id));
  return rankings.every((ranking) => validIds.has(ranking.vehicleId));
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
    return parseLlmScoringJson(content);
  } catch (error) {
    llmDebug("match-scoring", {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
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
    criteria,
    ragTopicAffinity: ragContext?.topicAffinity ?? {},
    vehicles: matches.map((match) => ({
      vehicleId: match.vehicle.id,
      vehicle: {
        make: match.vehicle.make,
        model: match.vehicle.model,
        trim: match.vehicle.trim,
        year: match.vehicle.year,
        condition: match.vehicle.condition,
        bodyType: match.vehicle.bodyType,
        brandOrigin: match.vehicle.brandOrigin,
        priceEUR: match.vehicle.priceEUR,
        monthlyLeaseEUR: match.vehicle.monthlyLeaseEUR,
        rangeKm: match.vehicle.rangeKm,
        efficiencyKwhPer100Km: match.vehicle.efficiencyKwhPer100Km,
        batteryKwh: match.vehicle.batteryKwh,
        batterySoH: match.vehicle.batterySoH,
        mileageKm: match.vehicle.mileageKm,
        drivetrain: match.vehicle.drivetrain,
        seats: match.vehicle.seats,
        cargoLiters: match.vehicle.cargoLiters,
        features: match.vehicle.features,
        location: match.vehicle.location,
        available: match.vehicle.available,
        notes: match.vehicle.notes,
        reviewTags: match.vehicle.reviewTags
      },
      ruleScore: match.score,
      scoringBreakdown: match.scoringBreakdown,
      tradeoffs: match.ruledOutReasons,
      retrievedEvidence: match.ragEvidence.slice(0, 2).map((evidence, evidenceIndex) => ({
        evidenceId: `E${evidenceIndex + 1}`,
        sourceType: evidence.sourceType,
        title: evidence.title,
        topic: evidence.topic,
        excerpt: evidence.excerpt,
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
