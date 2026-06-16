import {
  fallbackChatGreeting,
  generateLowConfidenceQuestion,
  generateNoMatchesMessage,
  generateNoMoreMatchesMessage
} from "./assistant-messages.ts";
import { planAgentTurn } from "./chat-agent.ts";
import { clarificationQuestion } from "./criteria.ts";
import { normalizeCriteria } from "./criteria-normalizer.ts";
import { selectAndExplainMatches } from "./explanations.ts";
import { matchDebug } from "./match-debug.ts";
import { retrieveRagContext } from "./rag.ts";
import {
  getMatchSession,
  saveMatchSession
} from "./repositories/match-session-repository.ts";
import { listVehicles, searchVehicles } from "./repositories/vehicle-repository.ts";
import { matchVehicles } from "./scoring.ts";
import type { MatchResponse, RejectedSummary, RejectedVehicle, UserCriteria, Vehicle } from "./types.ts";
import { vehicleMatchesModelPreferences } from "./vehicle-matching.ts";

const MATCH_CANDIDATE_LIMIT = 24;
const MATCH_MODEL_CANDIDATE_LIMIT = 3;
const DEFAULT_RECOMMENDATION_LIMIT = 8;
const FOCUSED_RECOMMENDATION_LIMIT = 12;

export type MatchServiceRequest = {
  message: string;
  sessionId?: string;
  previousCriteria?: UserCriteria;
  criteriaOverride?: UserCriteria;
  testerLocation?: string | null;
};

export async function runMatchRequest(body: MatchServiceRequest): Promise<MatchResponse> {
  const sessionId = body.sessionId ?? crypto.randomUUID();
  const storedSession = body.sessionId ? await getMatchSession(sessionId) : null;
  const previousCriteria = body.previousCriteria ?? storedSession?.criteria ?? null;
  const isNextBatch = isNextBatchRequest(body.message) && Boolean(previousCriteria);
  const normalized = await normalizeCriteria({
    message: body.message,
    previousCriteria,
    criteriaOverride: body.criteriaOverride ?? null
  });
  let criteria = normalized.criteria;
  if (!criteria.location && body.testerLocation) {
    criteria = { ...criteria, location: body.testerLocation };
  }
  matchDebug("criteria", {
    sessionId,
    message: body.message,
    budgetMaxEUR: criteria.budgetMaxEUR,
    rangeFloorKm: criteria.rangeFloorKm,
    bodyTypes: criteria.bodyTypes,
    brandPreferences: criteria.brandPreferences,
    modelPreferences: criteria.modelPreferences,
    preferredBrandOrigins: criteria.preferredBrandOrigins,
    missingCriteria: normalized.missingCriteria,
    confidence: normalized.confidence
  });
  let agentPlan = await planAgentTurn({
    message: body.message,
    criteria,
    previousCriteria,
    confidence: normalized.confidence
  });
  if (isNextBatch && agentPlan.readiness.readyToMatch) {
    agentPlan = { ...agentPlan, action: "match", assistantMessage: null };
  }

  const storedSelectedVehicleIds = storedSession?.selectedVehicleIds ?? [];
  const shownVehicleIds =
    isNextBatch && !body.criteriaOverride ? new Set(storedSelectedVehicleIds) : new Set<string>();
  let nextSelectedVehicleIds = new Set(body.criteriaOverride ? [] : storedSelectedVehicleIds);

  if (agentPlan.action === "chat") {
    await saveMatchSession({
      id: sessionId,
      criteria,
      selectedVehicleIds: [...nextSelectedVehicleIds]
    });
    const assistantMessage = agentPlan.assistantMessage ?? fallbackChatGreeting(criteria);
    return {
      type: "chat",
      sessionId,
      assistantMessage,
      message: assistantMessage,
      criteria,
      missingCriteria: agentPlan.missingCriteria,
      recommendations: [],
      ragCitations: [],
      rejectedSummary: []
    };
  }

  if (agentPlan.action === "clarification") {
    await saveMatchSession({
      id: sessionId,
      criteria,
      selectedVehicleIds: [...nextSelectedVehicleIds]
    });
    const assistantMessage =
      agentPlan.assistantMessage ?? normalized.clarificationQuestion ?? clarificationQuestion(criteria);
    return {
      type: "clarification",
      sessionId,
      assistantMessage,
      message: assistantMessage,
      criteria,
      missingCriteria: agentPlan.missingCriteria,
      recommendations: [],
      ragCitations: [],
      rejectedSummary: []
    };
  }

  const candidateVehicles = await searchVehicles(criteria);
  const scoringVehicles = dedupeVehiclesForMatching(candidateVehicles.length ? candidateVehicles : await listVehicles());
  matchDebug("candidate-pool", {
    sessionId,
    searchedVehicles: candidateVehicles.length,
    scoringVehicles: scoringVehicles.length,
    usedFallbackList: candidateVehicles.length === 0
  });
  const nextBatchVehicles = isNextBatch
    ? scoringVehicles.filter((vehicle) => !vehicleHasShownKey(vehicle, shownVehicleIds))
    : scoringVehicles;
  const matchingCandidates = limitVehiclesPerModel(nextBatchVehicles, criteria, MATCH_MODEL_CANDIDATE_LIMIT);
  matchDebug("matching-candidates", {
    sessionId,
    nextBatchVehicles: nextBatchVehicles.length,
    matchingCandidates: matchingCandidates.length,
    modelBuckets: new Set(matchingCandidates.map(vehicleModelKey)).size
  });
  const ragContext = await retrieveRagContext(body.message, criteria, matchingCandidates);
  const recommendationLimit = resolveRecommendationLimit(criteria);
  const result = matchVehicles(matchingCandidates, criteria, MATCH_CANDIDATE_LIMIT, { ragContext });
  const rejectedSummary = summarizeRejected(result.rejected, criteria);
  matchDebug("scored", {
    sessionId,
    passed: result.recommendations.length,
    rejected: result.rejected.length,
    rejectedSummary,
    topRecommendations: result.recommendations.slice(0, 8).map((match) => ({
      id: match.vehicle.id,
      make: match.vehicle.make,
      model: match.vehicle.model,
      score: match.score,
      ragScore: match.ragScore
    })),
    sampleRejected: result.rejected.slice(0, 8).map((item) => ({
      id: item.vehicle.id,
      make: item.vehicle.make,
      model: item.vehicle.model,
      reasons: item.reasons
    }))
  });

  if (!result.recommendations.length) {
    await saveMatchSession({
      id: sessionId,
      criteria,
      selectedVehicleIds: [...nextSelectedVehicleIds]
    });
    const assistantMessage =
      isNextBatch && shownVehicleIds.size
        ? await generateNoMoreMatchesMessage(criteria)
        : await generateNoMatchesMessage({ criteria, rejectedSummary });
    return {
      type: "no_matches",
      sessionId,
      assistantMessage,
      message: assistantMessage,
      criteria,
      missingCriteria: agentPlan.missingCriteria,
      recommendations: [],
      ragCitations: ragContext.documents,
      rejectedSummary
    };
  }

  const finalSelection = await selectAndExplainMatches(result.recommendations, criteria, {
    maxRecommendations: recommendationLimit,
    rejectedSummary,
    lowConfidenceQuestion:
      normalized.confidence < 0.72 && agentPlan.missingCriteria.includes("use_case")
        ? await generateLowConfidenceQuestion(criteria)
        : null
  });
  nextSelectedVehicleIds = new Set([
    ...(!isNextBatch || body.criteriaOverride ? [] : shownVehicleIds),
    ...finalSelection.recommendations.flatMap((match) => vehicleExclusionKeys(match.vehicle))
  ]);

  await saveMatchSession({
    id: sessionId,
    criteria,
    selectedVehicleIds: [...nextSelectedVehicleIds]
  });

  return {
    type: "matches",
    sessionId,
    assistantMessage: finalSelection.assistantMessage,
    message: finalSelection.assistantMessage,
    criteria,
    missingCriteria: agentPlan.missingCriteria,
    recommendations: finalSelection.recommendations,
    ragCitations: ragContext.documents,
    rejectedSummary
  };
}

function resolveRecommendationLimit(criteria: UserCriteria) {
  if (criteria.modelPreferences.length || criteria.brandPreferences.length) {
    return FOCUSED_RECOMMENDATION_LIMIT;
  }
  return DEFAULT_RECOMMENDATION_LIMIT;
}

function isNextBatchRequest(message: string) {
  return /\b(next(?:\s+(?:batch|set|page|results?|cars?))?|more(?:\s+(?:cars?|options?|results?))?|show\s+more|another\s+(?:batch|set|option|options)|weiter|mehr|nächste|naechste|noch\s+mehr)\b/i.test(message);
}

function vehicleHasShownKey(vehicle: Vehicle, shownKeys: Set<string>) {
  return vehicleExclusionKeys(vehicle).some((key) => shownKeys.has(key));
}

function vehicleExclusionKeys(vehicle: Vehicle) {
  return [
    vehicle.id,
    vehicle.dedupeKey ? `dedupe:${vehicle.dedupeKey}` : null,
    vehicle.inventoryFingerprint ? `fingerprint:${vehicle.inventoryFingerprint}` : null,
    vehicle.listingUrl ? `listing:${normalizeListingUrl(vehicle.listingUrl)}` : null
  ].filter((key): key is string => Boolean(key));
}

function dedupeVehiclesForMatching(vehicles: Vehicle[]) {
  const seen = new Set<string>();
  return vehicles.filter((vehicle) => {
    const key = vehiclePrimaryMatchKey(vehicle);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function vehiclePrimaryMatchKey(vehicle: Vehicle) {
  return (
    (vehicle.dedupeKey ? `dedupe:${vehicle.dedupeKey}` : null) ??
    (vehicle.listingUrl ? `listing:${normalizeListingUrl(vehicle.listingUrl)}` : null) ??
    (vehicle.inventoryFingerprint ? `fingerprint:${vehicle.inventoryFingerprint}` : null) ??
    `id:${vehicle.id}`
  );
}

function limitVehiclesPerModel(vehicles: Vehicle[], criteria: UserCriteria, limit: number) {
  const groups = new Map<string, Vehicle[]>();
  for (const vehicle of vehicles) {
    const key = vehicleModelKey(vehicle);
    const group = groups.get(key);
    if (group) {
      group.push(vehicle);
    } else {
      groups.set(key, [vehicle]);
    }
  }

  return [...groups.values()].flatMap((group) => {
    return group
      .sort((left, right) => scoreCandidateForModel(right, criteria) - scoreCandidateForModel(left, criteria))
      .slice(0, limit);
  });
}

function scoreCandidateForModel(vehicle: Vehicle, criteria: UserCriteria) {
  const priceScore = criteria.budgetMaxEUR
    ? clampScore(100 - Math.max(0, vehicle.priceEUR - criteria.budgetMaxEUR) / 500)
    : clampScore(100 - vehicle.priceEUR / 2500);
  const rangeScore = criteria.rangeFloorKm
    ? clampScore((vehicle.rangeKm / criteria.rangeFloorKm) * 70)
    : clampScore(vehicle.rangeKm / 6);
  const mileageScore =
    vehicle.mileageKm === null
      ? vehicle.condition === "new"
        ? 100
        : 62
      : clampScore(100 - vehicle.mileageKm / 2500);
  const batteryScore = vehicle.batterySoH === null ? 72 : vehicle.batterySoH;
  const freshnessScore = vehicle.sourceUpdatedAt ? 8 : 0;

  return priceScore * 0.34 + rangeScore * 0.26 + mileageScore * 0.18 + batteryScore * 0.14 + freshnessScore;
}

function vehicleModelKey(vehicle: Vehicle) {
  return `${vehicle.make} ${vehicle.model}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}

function normalizeListingUrl(url: string) {
  return url.trim().replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
}

function summarizeRejected(rejected: RejectedVehicle[], criteria: UserCriteria): RejectedSummary[] {
  const focusedRejected =
    criteria.modelPreferences.length && rejected.some((item) => {
      return vehicleMatchesModelPreferences(item.vehicle, criteria.modelPreferences);
    })
      ? rejected.filter((item) => vehicleMatchesModelPreferences(item.vehicle, criteria.modelPreferences))
      : rejected;
  const counts = new Map<string, number>();
  for (const item of focusedRejected) {
    for (const reason of item.reasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);
}
