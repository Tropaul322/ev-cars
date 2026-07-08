import {
  generateCapabilityResponse,
  generateChatGreeting,
  generateClarificationResponse,
  generateConversationalResponse,
  generateLowConfidenceQuestion,
  generateNoMatchesMessage,
  generateNoMoreMatchesMessage,
  generateNudgeResponse
} from "./assistant-messages.ts";
import {
  isMissingCriteriaKey,
  nextClarificationPrompt
} from "./clarification-catalog.ts";
import { resolveClarificationAnswer } from "./clarification-resolver.ts";
import {
  criteriaSummary,
  detectLanguage,
  emptyCriteria,
  getCriteriaConfidence,
  getCriteriaReadiness,
  getMissingCriteria
} from "./criteria.ts";
import { applyChipPatch, normalizeCriteria } from "./criteria-normalizer.ts";
import { classifyConversationTurn, looksLikeNextBatchRequest, resolveConversationTurn } from "./conversational-intent.ts";
import { selectAndExplainMatches } from "./explanations.ts";
import { applyLlmRankings, rankRecommendationsWithLlm } from "./llm-scoring.ts";
import { chatMessagesToLlmHistory, type LlmConversationTurn } from "./llm-conversation.ts";
import {
  buildMatchDiagnostics,
  countPrimaryVehicleKeys,
  matchDiagnosticsEnabled,
  vehicleExclusionKeys,
  vehiclePrimaryMatchKey
} from "./match-diagnostics.ts";
import { matchDebug } from "./match-debug.ts";
import { buildRagContext, retrieveRagContext } from "./rag.ts";
import { recoverShownVehicleKeysFromChat, listChatMessages } from "./repositories/chat-repository.ts";
import { listKnowledgeDocuments } from "./repositories/knowledge-repository.ts";
import {
  getMatchSession,
  saveMatchSession
} from "./repositories/match-session-repository.ts";
import { listVehicles, searchVehicles } from "./repositories/vehicle-repository.ts";
import { matchVehicles } from "./scoring.ts";
import type { MatchDiagnostics } from "./match-diagnostics.ts";
import type {
  ClarificationPrompt,
  ClarificationPromptKey,
  CriteriaPatch,
  MatchResult,
  MissingCriteria,
  RejectedSummary,
  RejectedVehicle,
  UserCriteria,
  Vehicle
} from "./types.ts";
import type { MatchResponse } from "./types.ts";
import { vehicleEmbeddingSearchEnabled } from "./vehicle-search-settings.ts";
import { vehicleMatchesModelPreferences } from "./vehicle-matching.ts";

const MATCH_CANDIDATE_LIMIT = 36;
const MATCH_MODEL_CANDIDATE_LIMIT = 3;
const MATCH_MODEL_DIVERSITY_LIMIT = 2;
const MATCH_LISTING_DIVERSITY_LIMIT = 1;
const DEFAULT_RECOMMENDATION_LIMIT = 8;
const FOCUSED_RECOMMENDATION_LIMIT = 12;
const NEXT_BATCH_SEARCH_OFFSET_STEP = 12;

export type MatchServiceRequest = {
  message: string;
  sessionId?: string;
  testerRegistrationId?: string | null;
  previousCriteria?: UserCriteria;
  criteriaOverride?: UserCriteria;
  criteriaPatch?: CriteriaPatch;
  intent?: "show_matches";
  skippedKeys?: MissingCriteria[];
  currentPromptKey?: ClarificationPromptKey;
  testerLocation?: string | null;
  conversationHistory?: LlmConversationTurn[];
};

export async function runMatchRequest(body: MatchServiceRequest): Promise<MatchResponse> {
  const sessionId = body.sessionId ?? crypto.randomUUID();
  const conversationHistory =
    body.conversationHistory ??
    (body.sessionId && body.testerRegistrationId
      ? chatMessagesToLlmHistory(
          await listChatMessages(body.testerRegistrationId, body.sessionId),
          body.message
        )
      : []);
  const storedSession = body.sessionId ? await getMatchSession(sessionId, body.testerRegistrationId) : null;
  const previousCriteria = body.previousCriteria ?? storedSession?.criteria ?? null;
  const hasPriorContext = Boolean(previousCriteria);
  const resolvedTurn = await resolveConversationTurn({
    message: body.message,
    conversationHistory,
    currentPromptKey: body.currentPromptKey ?? null,
    knownCriteria: previousCriteria ? criteriaSummary(previousCriteria) : []
  });
  const { trigger, turnKind } = resolvedTurn;
  const isNextBatch =
    trigger === "next_batch" || (looksLikeNextBatchRequest(body.message) && Boolean(previousCriteria));
  let skippedKeys = (body.skippedKeys ?? []).filter(isMissingCriteriaKey);

  let criteria: UserCriteria;
  let confidence: number;
  let criteriaChanged: boolean;
  const isMetaQuestion = turnKind === "meta";
  const isSmallTalk = turnKind === "small_talk";

  matchDebug("turn-classification", {
    sessionId,
    message: body.message,
    turnKind,
    trigger,
    patternHint: resolvedTurn.patternHint,
    patternTriggers: resolvedTurn.patternTriggers,
    source: resolvedTurn.source
  });

  if (body.criteriaPatch) {
    const base = previousCriteria ?? emptyCriteria(body.message, detectLanguage(body.message, "en"));
    criteria = applyChipPatch(base, body.criteriaPatch);
    confidence = getCriteriaConfidence(criteria);
    criteriaChanged = true;
  } else if (isMetaQuestion || isSmallTalk) {
    criteria =
      previousCriteria ??
      emptyCriteria(body.message, detectLanguage(body.message, "en"));
    confidence = getCriteriaConfidence(criteria);
    criteriaChanged = false;
  } else {
    const normalized = await normalizeCriteria({
      message: body.message,
      previousCriteria,
      criteriaOverride: body.criteriaOverride ?? null,
      conversationHistory
    });
    criteria = normalized.criteria;
    confidence = normalized.confidence;
    criteriaChanged = previousCriteria
      ? !criteriaEquivalent(previousCriteria, criteria)
      : hasMeaningfulCriteria(criteria);

    const clarificationKey = resolveActiveClarificationKey(body.currentPromptKey, criteria, skippedKeys);
    if (clarificationKey && getMissingCriteria(criteria).includes(clarificationKey)) {
      const resolution = resolveClarificationAnswer(body.message, clarificationKey, criteria.language);
      if (resolution?.kind === "skip") {
        skippedKeys = Array.from(new Set([...skippedKeys, clarificationKey]));
        criteriaChanged = true;
      } else if (resolution?.kind === "patch") {
        criteria = applyChipPatch(criteria, resolution.patch);
        confidence = getCriteriaConfidence(criteria);
        criteriaChanged = true;
      }
    }
  }

  if (resolvedTurn.criteriaPatch && Object.keys(resolvedTurn.criteriaPatch).length > 0) {
    criteria = applyChipPatch(criteria, resolvedTurn.criteriaPatch);
    confidence = getCriteriaConfidence(criteria);
    criteriaChanged = true;
  }

  if (!criteria.location && body.testerLocation) {
    criteria = { ...criteria, location: body.testerLocation };
  }

  const readiness = getCriteriaReadiness(criteria);
  const missingCriteria = getMissingCriteria(criteria);

  matchDebug("criteria", {
    sessionId,
    message: body.message,
    budgetMaxEUR: criteria.budgetMaxEUR,
    rangeFloorKm: criteria.rangeFloorKm,
    bodyTypes: criteria.bodyTypes,
    brandPreferences: criteria.brandPreferences,
    modelPreferences: criteria.modelPreferences,
    preferredBrandOrigins: criteria.preferredBrandOrigins,
    missingCriteria,
    confidence
  });

  const storedSelectedVehicleIds =
    storedSession?.selectedVehicleIds?.length
      ? storedSession.selectedVehicleIds
      : body.sessionId && body.testerRegistrationId
        ? await recoverShownVehicleKeysFromChat(body.testerRegistrationId, body.sessionId)
        : [];
  const shownVehicleIds =
    isNextBatch && !body.criteriaOverride ? new Set(storedSelectedVehicleIds) : new Set<string>();
  let nextSelectedVehicleIds = new Set(
    body.criteriaOverride || (criteriaChanged && !isNextBatch) ? [] : storedSelectedVehicleIds
  );
  const searchOffset =
    isNextBatch && shownVehicleIds.size
      ? countPrimaryVehicleKeys(storedSelectedVehicleIds) * NEXT_BATCH_SEARCH_OFFSET_STEP
      : 0;

  const nextPrompt = nextClarificationPrompt(criteria, skippedKeys);

  const isChatTurn =
    !body.criteriaPatch &&
    (trigger === "small_talk" ||
      trigger === "meta" ||
      (trigger === "ev_question" && !criteriaChanged));

  const wantsMatch =
    !isChatTurn &&
    (body.intent === "show_matches" ||
      trigger === "show_matches" ||
      trigger === "next_batch" ||
      trigger === "brand_focus" ||
      isNextBatch ||
      (!hasPriorContext &&
        (hasInventoryLookup(criteria) ||
          readiness.readyToMatch ||
          (nextPrompt.key === "ready" && hasMeaningfulCriteria(criteria)))) ||
      (hasPriorContext &&
        criteriaChanged &&
        (readiness.readyToMatch || hasInventoryLookup(criteria))));

  if (!wantsMatch) {
    let prompt: ClarificationPrompt | undefined;
    let assistantMessage: string;
    const offerPrompt = !isChatTurn && nextPrompt.key !== "ready";

    if (isChatTurn) {
      if (trigger === "meta") {
        assistantMessage = await generateCapabilityResponse({
          message: body.message,
          criteria,
          conversationHistory
        });
      } else if (trigger === "small_talk") {
        assistantMessage = await generateChatGreeting({
          message: body.message,
          criteria,
          conversationHistory
        });
      } else {
        const ragContext = await retrieveRagContext(body.message, criteria, []);
        assistantMessage = await generateConversationalResponse({
          message: body.message,
          criteria,
          ragEvidence: ragContext.documents.slice(0, 3).map((doc) => doc.excerpt),
          conversationHistory
        });
      }
    } else if (
      !criteriaChanged &&
      body.currentPromptKey === nextPrompt.key &&
      nextPrompt.key !== "ready"
    ) {
      prompt = nextPrompt;
      assistantMessage = await generateNudgeResponse({
        message: body.message,
        criteria,
        catalogQuestion: prompt.question,
        conversationHistory
      });
    } else {
      prompt = nextPrompt;
      assistantMessage = await generateClarificationResponse({
        message: body.message,
        criteria,
        catalogQuestion: prompt.question,
        conversationHistory
      });
    }

    if (!offerPrompt) {
      prompt = undefined;
    }

    await saveMatchSession({
      id: sessionId,
      testerRegistrationId: body.testerRegistrationId,
      criteria,
      selectedVehicleIds: [...nextSelectedVehicleIds]
    });
    return {
      type: prompt ? "clarification" : "chat",
      sessionId,
      assistantMessage,
      message: assistantMessage,
      criteria,
      missingCriteria,
      recommendations: [],
      ragCitations: [],
      rejectedSummary: [],
      ...(prompt ? { prompt } : {})
    };
  }

  const candidateVehicles = await searchVehicles(criteria, body.message, { offset: searchOffset });
  const scoringVehicles = dedupeVehiclesForMatching(
    candidateVehicles.length ? candidateVehicles : await listVehicles()
  );
  const structuredHits = candidateVehicles.length;
  const embeddingHits = candidateVehicles.filter((vehicle) => (vehicle.embeddingSimilarity ?? 0) > 0).length;
  matchDebug("candidate-pool", {
    sessionId,
    searchedVehicles: candidateVehicles.length,
    scoringVehicles: scoringVehicles.length,
    embeddingHits,
    searchOffset,
    shownVehicleKeys: shownVehicleIds.size,
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
  // Keyword RAG only on the match hot path — search already paid for an embedding.
  const knowledgeDocuments = await listKnowledgeDocuments();
  const ragContext = buildRagContext({
    message: body.message,
    criteria,
    vehicles: matchingCandidates,
    documents: knowledgeDocuments
  });
  const recommendationLimit = resolveRecommendationLimit(criteria);
  const result = matchVehicles(matchingCandidates, criteria, MATCH_CANDIDATE_LIMIT, { ragContext });
  const llmScoring = await rankRecommendationsWithLlm(
    result.recommendations,
    criteria,
    body.message,
    ragContext
  );
  const rankedRecommendations = llmScoring.usedLlm
    ? applyLlmRankings(result.recommendations, llmScoring.rankings)
    : result.recommendations;
  matchDebug("llm-scoring", {
    sessionId,
    usedLlm: llmScoring.usedLlm,
    rankedVehicles: llmScoring.rankings.length,
    topRecommendations: rankedRecommendations.slice(0, 5).map((match) => ({
      id: match.vehicle.id,
      make: match.vehicle.make,
      model: match.vehicle.model,
      score: match.score,
      scoreSource: match.scoreSource ?? "rules",
      ruleScore: match.ruleScore
    }))
  });
  const diversifiedRecommendations = diversifyRecommendations(
    rankedRecommendations,
    MATCH_CANDIDATE_LIMIT,
    MATCH_MODEL_DIVERSITY_LIMIT,
    MATCH_LISTING_DIVERSITY_LIMIT
  );
  const diagnostics = buildMatchDiagnostics({
    embeddingQueryStatus:
      embeddingHits > 0 ? "ok" : vehicleEmbeddingSearchEnabled() ? "unavailable" : "disabled",
    embeddingHits,
    structuredHits,
    candidatePoolSize: candidateVehicles.length,
    scoringPoolSize: matchingCandidates.length,
    excludedShownKeys: [...shownVehicleIds],
    isNextBatch,
    criteriaChanged,
    searchOffset,
    recommendations: diversifiedRecommendations
  });
  matchDebug("selection", {
    sessionId,
    diagnostics
  });
  const rejectedSummary = summarizeRejected(result.rejected, criteria);
  matchDebug("scored", {
    sessionId,
    passed: result.recommendations.length,
    rejected: result.rejected.length,
    rejectedSummary,
    topRecommendations: diversifiedRecommendations.slice(0, 8).map((match) => ({
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

  if (!diversifiedRecommendations.length) {
    await saveMatchSession({
      id: sessionId,
      testerRegistrationId: body.testerRegistrationId,
      criteria,
      selectedVehicleIds: [...nextSelectedVehicleIds]
    });
    const assistantMessage =
      isNextBatch && shownVehicleIds.size
        ? await generateNoMoreMatchesMessage(criteria, conversationHistory)
        : await generateNoMatchesMessage({ criteria, rejectedSummary, conversationHistory });
    return {
      type: "no_matches",
      sessionId,
      assistantMessage,
      message: assistantMessage,
      criteria,
      missingCriteria,
      recommendations: [],
      ragCitations: ragContext.documents,
      rejectedSummary
    };
  }

  const needsLowConfidenceQuestion = confidence < 0.72 && missingCriteria.includes("use_case");
  const [lowConfidenceQuestion, finalSelection] = await Promise.all([
    needsLowConfidenceQuestion
      ? generateLowConfidenceQuestion(criteria, conversationHistory)
      : Promise.resolve(null),
    selectAndExplainMatches(diversifiedRecommendations, criteria, {
      maxRecommendations: recommendationLimit,
      rejectedSummary
    })
  ]);

  const recommendations = finalSelection.recommendations;
  const assistantMessage =
    lowConfidenceQuestion && !finalSelection.assistantMessage.includes(lowConfidenceQuestion)
      ? `${finalSelection.assistantMessage}\n\n${lowConfidenceQuestion}`
      : finalSelection.assistantMessage;

  nextSelectedVehicleIds = new Set([
    ...(!isNextBatch || body.criteriaOverride ? [] : shownVehicleIds),
    ...recommendations.flatMap((match) => vehicleExclusionKeys(match.vehicle))
  ]);

  await saveMatchSession({
    id: sessionId,
    testerRegistrationId: body.testerRegistrationId,
    criteria,
    selectedVehicleIds: [...nextSelectedVehicleIds]
  });

  return attachDiagnostics(
    {
      type: "matches",
      sessionId,
      assistantMessage,
      message: assistantMessage,
      criteria,
      missingCriteria,
      recommendations,
      ragCitations: ragContext.documents,
      rejectedSummary
    },
    diagnostics
  );
}

function resolveRecommendationLimit(criteria: UserCriteria) {
  if (criteria.modelPreferences.length || criteria.brandPreferences.length) {
    return FOCUSED_RECOMMENDATION_LIMIT;
  }
  return DEFAULT_RECOMMENDATION_LIMIT;
}

function isNextBatchRequest(message: string) {
  return looksLikeNextBatchRequest(message);
}

function vehicleHasShownKey(vehicle: Vehicle, shownKeys: Set<string>) {
  return vehicleExclusionKeys(vehicle).some((key) => shownKeys.has(key));
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
  const embeddingScore =
    vehicle.embeddingSimilarity !== undefined ? clampScore(vehicle.embeddingSimilarity * 100) : 0;
  const embeddingWeight = vehicle.embeddingSimilarity !== undefined ? 0.18 : 0;

  return (
    priceScore * (0.34 - embeddingWeight * 0.45) +
    rangeScore * (0.26 - embeddingWeight * 0.35) +
    mileageScore * 0.18 +
    batteryScore * 0.14 +
    freshnessScore +
    embeddingScore * embeddingWeight
  );
}

function diversifyRecommendations(
  matches: MatchResult[],
  limit: number,
  maxPerModel: number,
  maxPerListing: number
) {
  const selected: MatchResult[] = [];
  const modelCounts = new Map<string, number>();
  const listingCounts = new Map<string, number>();
  const selectedIds = new Set<string>();

  for (const match of matches) {
    if (selected.length >= limit) break;
    const modelKey = vehicleModelKey(match.vehicle);
    const listingKey = vehiclePrimaryMatchKey(match.vehicle);
    const modelCount = modelCounts.get(modelKey) ?? 0;
    const listingCount = listingCounts.get(listingKey) ?? 0;
    if (modelCount >= maxPerModel) continue;
    if (listingCount >= maxPerListing) continue;
    selected.push(match);
    selectedIds.add(match.vehicle.id);
    modelCounts.set(modelKey, modelCount + 1);
    listingCounts.set(listingKey, listingCount + 1);
  }

  if (selected.length < limit) {
    for (const match of matches) {
      if (selected.length >= limit) break;
      if (selectedIds.has(match.vehicle.id)) continue;
      const listingKey = vehiclePrimaryMatchKey(match.vehicle);
      if ((listingCounts.get(listingKey) ?? 0) >= maxPerListing) continue;
      selected.push(match);
      selectedIds.add(match.vehicle.id);
      listingCounts.set(listingKey, (listingCounts.get(listingKey) ?? 0) + 1);
    }
  }

  return selected;
}

function vehicleModelKey(vehicle: Vehicle) {
  return `${vehicle.make} ${vehicle.model}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}

function attachDiagnostics<T extends MatchResponse>(response: T, diagnostics: MatchDiagnostics): T {
  if (!matchDiagnosticsEnabled()) return response;
  return { ...response, matchDiagnostics: diagnostics };
}

function criteriaFingerprint(criteria: UserCriteria) {
  const comparable: Record<string, unknown> = { ...criteria };
  delete comparable.rawPrompt;
  delete comparable.language;
  return JSON.stringify(comparable);
}

function criteriaEquivalent(left: UserCriteria, right: UserCriteria) {
  return criteriaFingerprint(left) === criteriaFingerprint(right);
}

function hasMeaningfulCriteria(criteria: UserCriteria) {
  return criteriaSummary(criteria).length > 0 || hasInventoryLookup(criteria);
}

function hasInventoryLookup(criteria: UserCriteria) {
  return Boolean(
    criteria.brandPreferences.length ||
      criteria.preferredBrandOrigins.length ||
      criteria.modelPreferences.length
  );
}

function isExplicitShowMatches(message: string) {
  return classifyConversationTurn(message) === "show_matches";
}

function resolveActiveClarificationKey(
  currentPromptKey: ClarificationPromptKey | undefined,
  criteria: UserCriteria,
  skippedKeys: MissingCriteria[]
): MissingCriteria | null {
  if (
    currentPromptKey &&
    isMissingCriteriaKey(currentPromptKey) &&
    getMissingCriteria(criteria).includes(currentPromptKey)
  ) {
    return currentPromptKey;
  }
  const nextKey = nextClarificationPrompt(criteria, skippedKeys).key;
  return isMissingCriteriaKey(nextKey) && getMissingCriteria(criteria).includes(nextKey) ? nextKey : null;
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
