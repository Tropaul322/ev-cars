import { criteriaSummary } from "./criteria.ts";
import {
  createOpenAiChatCompletion,
  openAiChatTimeout,
  openAiConfigured,
  openAiModel
} from "./openai-provider.ts";
import type { MatchResult, UserCriteria } from "./types.ts";

export type RecommendationExplanationInput = {
  question: string;
  criteria: UserCriteria;
  recommendations: MatchResult[];
};

const explanationSystemPrompt =
  "You explain cached EV recommendations. do not search, do not add vehicles, and use only supplied facts. " +
  "Answer the user's question using only the supplied criteria, vehicle facts, deterministic reason ledger, and RAG evidence. " +
  "Do not infer or invent facts. Return only JSON: {\"answer\":\"...\"}.";

export async function generateRecommendationExplanation(input: RecommendationExplanationInput): Promise<string> {
  const fallback = fallbackRecommendationExplanation(input);
  if (process.env.FLOWRYD_DISABLE_LLM === "1" || !openAiConfigured()) return fallback;

  try {
    const response = await createOpenAiChatCompletion(
      "recommendation-explanation",
      {
        model: openAiModel(),
        temperature: 0,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: explanationSystemPrompt },
          { role: "user", content: JSON.stringify(buildRecommendationExplanationInput(input)) }
        ]
      },
      { timeout: openAiChatTimeout("recommendation-explanation") }
    );
    return parseRecommendationExplanationJson(response.choices[0]?.message?.content ?? "") ?? fallback;
  } catch {
    return fallback;
  }
}

export function fallbackRecommendationExplanation(input: RecommendationExplanationInput) {
  const first = input.recommendations[0];
  if (!first) {
    return input.criteria.language === "de"
      ? "Ich kann die vorherigen Empfehlungen in diesem Chat nicht mehr sehen. Soll ich erneut suchen?"
      : "I can no longer see the earlier recommendations in this chat. Would you like me to search again?";
  }
  const reasons = first.reasonLedger.positiveReasons
    .slice(0, 3)
    .map((reason) => `${reason.label}: ${reason.value}`)
    .join(", ");
  const tradeoff = first.reasonLedger.tradeoffs[0];
  return `${first.vehicle.make} ${first.vehicle.model} fits because of ${reasons}.${tradeoff ? ` The trade-off is ${tradeoff}.` : ""}`;
}

export function parseRecommendationExplanationJson(content: string): string | null {
  if (!content.trim()) return null;
  try {
    const parsed = JSON.parse(stripJsonFence(content)) as { answer?: unknown };
    return typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim() : null;
  } catch {
    return null;
  }
}

function buildRecommendationExplanationInput(input: RecommendationExplanationInput) {
  return {
    question: input.question,
    criteriaSummary: criteriaSummary(input.criteria),
    recommendations: input.recommendations.slice(0, 3).map((match) => ({
      vehicle: {
        make: match.vehicle.make,
        model: match.vehicle.model,
        year: match.vehicle.year,
        condition: match.vehicle.condition,
        bodyType: match.vehicle.bodyType,
        priceEUR: match.vehicle.priceEUR,
        monthlyLeaseEUR: match.vehicle.monthlyLeaseEUR,
        rangeKm: match.vehicle.rangeKm,
        mileageKm: match.vehicle.mileageKm,
        efficiencyKwhPer100Km: match.vehicle.efficiencyKwhPer100Km,
        batteryKwh: match.vehicle.batteryKwh,
        batterySoH: match.vehicle.batterySoH,
        drivetrain: match.vehicle.drivetrain,
        seats: match.vehicle.seats,
        cargoLiters: match.vehicle.cargoLiters,
        features: match.vehicle.features,
        location: match.vehicle.location,
        available: match.vehicle.available
      },
      reasonLedger: match.reasonLedger,
      ragEvidence: match.ragEvidence.map((evidence) => ({
        title: evidence.title,
        excerpt: evidence.excerpt,
        topic: evidence.topic
      }))
    }))
  };
}

function stripJsonFence(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1] ?? trimmed;
}
