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
import type { MatchResponse, RejectedSummary, RejectedVehicle, UserCriteria } from "./types.ts";
import { vehicleMatchesModelPreferences } from "./vehicle-matching.ts";

export type MatchServiceRequest = {
  message: string;
  sessionId?: string;
  previousCriteria?: UserCriteria;
  criteriaOverride?: UserCriteria;
};

export async function runMatchRequest(body: MatchServiceRequest): Promise<MatchResponse> {
  const sessionId = body.sessionId ?? crypto.randomUUID();
  const storedSession = body.previousCriteria ? null : await getMatchSession(sessionId);
  const previousCriteria = body.previousCriteria ?? storedSession?.criteria ?? null;
  const normalized = await normalizeCriteria({
    message: body.message,
    previousCriteria,
    criteriaOverride: body.criteriaOverride ?? null
  });
  const criteria = normalized.criteria;
  const agentPlan = await planAgentTurn({
    message: body.message,
    criteria,
    previousCriteria,
    confidence: normalized.confidence
  });

  await saveMatchSession({
    id: sessionId,
    criteria,
    selectedVehicleIds: storedSession?.selectedVehicleIds ?? []
  });

  if (agentPlan.action === "chat") {
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
  const scoringVehicles = candidateVehicles.length ? candidateVehicles : await listVehicles();
  const ragContext = await retrieveRagContext(body.message, criteria, scoringVehicles);
  const result = matchVehicles(scoringVehicles, criteria, 8, { ragContext });
  const rejectedSummary = summarizeRejected(result.rejected, criteria);

  if (!result.recommendations.length) {
    const assistantMessage = noMatchesMessage(criteria, rejectedSummary);
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

function lowConfidenceQuestion(criteria: UserCriteria) {
  return criteria.language === "de"
    ? "Soll ich eher niedrigen Kilometerstand, längere Reichweite oder Premium-Komfort priorisieren?"
    : "Should I prioritize lower mileage, longer range, or premium comfort?";
}
