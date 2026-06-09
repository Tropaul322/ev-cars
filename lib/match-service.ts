import { planAgentTurn } from "./chat-agent.ts";
import { normalizeCriteria } from "./criteria-normalizer.ts";
import { selectAndExplainMatches } from "./explanations.ts";
import { retrieveRagContext } from "./rag.ts";
import {
  getMatchSession,
  saveMatchSession
} from "./repositories/match-session-repository.ts";
import { listVehicles, searchVehicles } from "./repositories/vehicle-repository.ts";
import { matchVehicles } from "./scoring.ts";
import type { MatchResponse, RejectedSummary, RejectedVehicle, UserCriteria, Vehicle } from "./types.ts";
import { vehicleMatchesModelPreferences } from "./vehicle-matching.ts";

export type MatchServiceRequest = {
  message: string;
  sessionId?: string;
  previousCriteria?: UserCriteria;
  criteriaOverride?: UserCriteria;
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
  const criteria = normalized.criteria;
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
    const assistantMessage =
      agentPlan.assistantMessage ??
      "Hey, how can I help you today? Tell me your EV budget, use case, charging or range needs, and one preference.";
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
      agentPlan.assistantMessage ??
      normalized.clarificationQuestion ??
      "What budget should I respect: maximum purchase price or monthly lease target?";
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
  const nextBatchVehicles = isNextBatch
    ? scoringVehicles.filter((vehicle) => !vehicleHasShownKey(vehicle, shownVehicleIds))
    : scoringVehicles;
  const ragContext = await retrieveRagContext(body.message, criteria, nextBatchVehicles);
  const result = matchVehicles(nextBatchVehicles, criteria, 8, { ragContext });
  const rejectedSummary = summarizeRejected(result.rejected, criteria);

  if (!result.recommendations.length) {
    await saveMatchSession({
      id: sessionId,
      criteria,
      selectedVehicleIds: [...nextSelectedVehicleIds]
    });
    const assistantMessage = isNextBatch && shownVehicleIds.size
      ? noMoreMatchesMessage(criteria)
      : noMatchesMessage(criteria, rejectedSummary);
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
    maxRecommendations: 3,
    rejectedSummary,
    lowConfidenceQuestion:
      normalized.confidence < 0.72 && agentPlan.missingCriteria.includes("use_case")
        ? lowConfidenceQuestion(criteria)
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

function noMatchesMessage(criteria: UserCriteria, rejectedSummary: RejectedSummary[]) {
  const mainReason = rejectedSummary[0]?.reason;
  if (criteria.language === "de") {
    return mainReason
      ? `Ich finde mit diesen harten Grenzen kein passendes E-Auto. Der stärkste Blocker ist: ${mainReason}.`
      : "Ich finde mit diesen harten Grenzen kein passendes E-Auto. Lockere bitte Budget, Reichweite, Kilometerstand oder Karosserieform.";
  }
  return mainReason
    ? `I could not find a matching EV inside those hard limits. The biggest blocker is: ${mainReason}.`
    : "I could not find a matching EV inside those hard limits. Try relaxing budget, range, mileage, or body type.";
}

function noMoreMatchesMessage(criteria: UserCriteria) {
  return criteria.language === "de"
    ? "Ich habe dir alle passenden Autos aus dieser Suche bereits gezeigt. Wenn du mehr Auswahl willst, lockere bitte Budget, Reichweite, Karosserieform oder andere harte Kriterien."
    : "I have already shown all matching cars for this search. To get more options, try relaxing budget, range, body type, or another hard filter.";
}

function lowConfidenceQuestion(criteria: UserCriteria) {
  return criteria.language === "de"
    ? "Soll ich eher niedrigen Kilometerstand, längere Reichweite oder Premium-Komfort priorisieren?"
    : "Should I prioritize lower mileage, longer range, or premium comfort?";
}
