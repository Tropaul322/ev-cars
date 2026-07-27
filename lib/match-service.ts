import {
  generateCapabilityResponse,
  generateChatGreeting,
  generateClarificationResponse,
  generateConversationalResponse,
  generateNoMatchesMessage,
  generateNoMoreMatchesMessage,
  generateNudgeResponse,
  fallbackMatchIntroMessage
} from "./assistant-messages.ts";
import {
  getOptimizationPrompt,
  isMissingCriteriaKey,
  nextClarificationPrompt
} from "./clarification-catalog.ts";
import {
  declinedOptionalPreferencesPatch,
  looksLikeDeclineAnswer,
  resolveClarificationAnswer
} from "./clarification-resolver.ts";
import {
  DEFAULT_BUDGET_MAX_EUR,
  DEFAULT_BUDGET_MIN_EUR,
  criteriaSummary,
  detectLanguage,
  emptyCriteria,
  getCriteriaConfidence,
  getCriteriaReadiness,
  getMissingCriteria,
  looksLikeBrandWidenRequest,
  looksLikeNoBudgetLimit
} from "./criteria.ts";
import { applyChipPatch, mergeCriteriaDeterministic, normalizeCriteria } from "./criteria-normalizer.ts";
import {
  looksLikeAlternativesRequest,
  looksLikeNextBatchRequest,
  resolveConversationTurn,
  resolveConversationTurnPatternOnly
} from "./conversational-intent.ts";
import { fallbackExplanation, selectAndExplainMatches } from "./explanations.ts";
import { generateRecommendationExplanation } from "./recommendation-explanations.ts";
import { applyLlmRankings, rankRecommendationsWithLlm } from "./llm-scoring.ts";
import { chatMessagesToLlmHistory, type LlmConversationTurn } from "./llm-conversation.ts";
import {
  buildMatchDiagnostics,
  countPrimaryVehicleKeys,
  matchDiagnosticsEnabled,
  vehicleExclusionKeys,
  vehiclePrimaryMatchKey
} from "./match-diagnostics.ts";
import { matchDebug, matchDebugWarn } from "./match-debug.ts";
import { detectPromptInjection, promptInjectionResponse } from "./prompt-guard.ts";
import { attachSearchCriteriaDebug } from "./search-criteria-debug.ts";
import { buildRagContext } from "./rag.ts";
import { recoverShownVehicleKeysFromChat, listChatMessages } from "./repositories/chat-repository.ts";
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
import {
  lightHardMatchingEnabled,
  matchingPipeline,
  vehicleEmbeddingSearchEnabled
} from "./vehicle-search-settings.ts";
import { vehicleMatchesModelPreferences } from "./vehicle-matching.ts";

const MATCH_CANDIDATE_LIMIT = 36;
const MATCH_MODEL_CANDIDATE_LIMIT = 3;
const MATCH_MODEL_DIVERSITY_LIMIT = 2;
const MATCH_LISTING_DIVERSITY_LIMIT = 1;
const DEFAULT_RECOMMENDATION_LIMIT = 8;
const FOCUSED_RECOMMENDATION_LIMIT = 12;
const CACHED_RECOMMENDATION_LIMIT = 3;
const VISIBLE_RECOMMENDATION_LIMIT = 1;
const NEXT_BATCH_SEARCH_OFFSET_STEP = 12;
const DEFAULT_MATCH_PIPELINE_TIMEOUT_MS = 10_000;

type PipelineFallbackState = {
  fallbackStages: string[];
  timedOutStages: string[];
  fallbackSource?: string;
};

export type MatchServiceRequest = {
  message: string;
  sessionId?: string;
  testerRegistrationId?: string | null;
  previousCriteria?: UserCriteria;
  criteriaOverride?: UserCriteria;
  criteriaPatch?: CriteriaPatch;
  intent?: "show_matches" | "show_alternatives";
  skippedKeys?: MissingCriteria[];
  currentPromptKey?: ClarificationPromptKey;
  testerLocation?: string | null;
  conversationHistory?: LlmConversationTurn[];
  /** Optional session seed (tests / callers that already hold cache in memory). */
  cachedRecommendations?: MatchResult[];
  selectedVehicleIds?: string[];
};

/** Soft priority follow-ups after matches are disabled (PoC test-summary bug). */
export function shouldAskLowConfidencePriorityQuestion(
  confidence: number,
  criteria: UserCriteria,
  missingCriteria: MissingCriteria[]
) {
  void confidence;
  void criteria;
  void missingCriteria;
  return false;
}

export async function runMatchRequest(body: MatchServiceRequest): Promise<MatchResponse> {
  const sessionId = body.sessionId ?? crypto.randomUUID();
  const deadline = createPipelineDeadline();
  const pipelineFallbacks: PipelineFallbackState = {
    fallbackStages: [],
    timedOutStages: []
  };
  const conversationHistory =
    body.conversationHistory ??
    (body.sessionId && body.testerRegistrationId
      ? chatMessagesToLlmHistory(
          await listChatMessages(body.testerRegistrationId, body.sessionId),
          body.message
        )
      : []);
  const storedSession = body.sessionId ? await getMatchSession(sessionId, body.testerRegistrationId) : null;
  const sessionState = {
    selectedVehicleIds: body.selectedVehicleIds ?? storedSession?.selectedVehicleIds ?? [],
    cachedRecommendations: body.cachedRecommendations ?? storedSession?.cachedRecommendations ?? []
  };
  const previousCriteria = body.previousCriteria ?? storedSession?.criteria ?? null;
  const hasPriorContext = Boolean(previousCriteria);

  if (detectPromptInjection(body.message)) {
    const language = detectLanguage(body.message, previousCriteria?.language ?? "en");
    const guardCriteria = previousCriteria ?? emptyCriteria(body.message, language);
    const guardMissing = getMissingCriteria(guardCriteria);
    const assistantMessage = promptInjectionResponse(language);
    matchDebug("prompt-guard-blocked", { sessionId, message: body.message });
    await saveMatchSession({
      id: sessionId,
      testerRegistrationId: body.testerRegistrationId,
      criteria: guardCriteria,
      selectedVehicleIds: sessionState.selectedVehicleIds,
      cachedRecommendations: sessionState.cachedRecommendations
    });
    return attachSearchCriteriaDebug(
      {
        type: "chat",
        sessionId,
        assistantMessage,
        message: assistantMessage,
        criteria: guardCriteria,
        missingCriteria: guardMissing,
        recommendations: [],
        ragCitations: [],
        rejectedSummary: []
      },
      guardCriteria,
      guardMissing
    );
  }

  const resolvedTurn = await withPipelineFallback(
    "intent",
    deadline,
    pipelineFallbacks,
    () =>
      resolveConversationTurn({
        message: body.message,
        conversationHistory,
        currentPromptKey: body.currentPromptKey ?? null,
        knownCriteria: previousCriteria ? criteriaSummary(previousCriteria) : []
      }),
    () =>
      resolveConversationTurnPatternOnly({
        message: body.message,
        currentPromptKey: body.currentPromptKey ?? null
      })
  );
  const { trigger, turnKind } = resolvedTurn;
  if (trigger === "explain_recommendations") {
    const criteria = previousCriteria ?? emptyCriteria(body.message, detectLanguage(body.message, "en"));
    const missingCriteria = getMissingCriteria(criteria);
    const assistantMessage = await generateRecommendationExplanation({
      question: body.message,
      criteria,
      recommendations: sessionState.cachedRecommendations
    });
    return {
      type: "chat",
      sessionId,
      assistantMessage,
      message: assistantMessage,
      criteria,
      missingCriteria,
      recommendations: [],
      ragCitations: [],
      rejectedSummary: []
    };
  }
  const isNextBatch =
    trigger === "next_batch" || (looksLikeNextBatchRequest(body.message) && Boolean(previousCriteria));
  const brandWiden = looksLikeBrandWidenRequest(body.message);
  const isShowAlternatives =
    body.intent === "show_alternatives" ||
    trigger === "show_alternatives" ||
    (looksLikeAlternativesRequest(body.message) &&
      Boolean(previousCriteria) &&
      !brandWiden);
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
    criteria = {
      ...applyChipPatch(base, body.criteriaPatch),
      latestUserMessage: body.message.trim()
    };
    confidence = getCriteriaConfidence(criteria);
    criteriaChanged = true;
  } else if (isMetaQuestion || isSmallTalk) {
    criteria =
      previousCriteria ??
      emptyCriteria(body.message, detectLanguage(body.message, "en"));
    confidence = getCriteriaConfidence(criteria);
    criteriaChanged = false;
  } else {
    const normalized = await withPipelineFallback(
      "normalize_criteria",
      deadline,
      pipelineFallbacks,
      () =>
        normalizeCriteria({
          message: body.message,
          previousCriteria,
          criteriaOverride: body.criteriaOverride ?? null,
          conversationHistory
        }),
      () => {
        const fallbackCriteria = body.criteriaOverride
          ? body.criteriaOverride
          : mergeCriteriaDeterministic(body.message, previousCriteria);
        return {
          criteria: fallbackCriteria,
          criteriaPatch: {},
          confidence: getCriteriaConfidence(fallbackCriteria),
          missingCriteria: getMissingCriteria(fallbackCriteria),
          clarificationQuestion: null
        };
      }
    );
    criteria = normalized.criteria;
    confidence = normalized.confidence;
    criteriaChanged = previousCriteria
      ? !criteriaEquivalent(previousCriteria, criteria)
      : hasMeaningfulCriteria(criteria);

    const clarificationKey = resolveActiveClarificationKey(body.currentPromptKey, criteria, skippedKeys);
    if (
      clarificationKey &&
      (clarificationKey === "optimization" ||
        (isMissingCriteriaKey(clarificationKey) && getMissingCriteria(criteria).includes(clarificationKey)))
    ) {
      const resolution = resolveClarificationAnswer(body.message, clarificationKey, criteria.language);
      if (resolution?.kind === "skip") {
        // Optional groups (e.g. use_case) can be skipped; binding keys use decline patches instead.
        if (isMissingCriteriaKey(clarificationKey) && clarificationKey === "use_case") {
          skippedKeys = Array.from(new Set([...skippedKeys, clarificationKey]));
        }
        criteriaChanged = true;
      } else if (resolution?.kind === "patch") {
        let patch = resolution.patch;
        // If body style is already known, a decline must clear extras without reopening all bodies.
        if (
          clarificationKey === "vehicle_preferences" &&
          criteria.bodyTypes.length > 0 &&
          looksLikeDeclineAnswer(body.message)
        ) {
          patch = declinedOptionalPreferencesPatch(true);
        }
        criteria = {
          ...applyChipPatch(criteria, patch),
          latestUserMessage: body.message.trim()
        };
        confidence = getCriteriaConfidence(criteria);
        criteriaChanged = true;
      }
    }

    if (
      !criteriaChanged &&
      body.currentPromptKey &&
      body.currentPromptKey !== "ready" &&
      looksLikeDeclineAnswer(body.message)
    ) {
      const resolution = resolveClarificationAnswer(
        body.message,
        body.currentPromptKey,
        criteria.language
      );
      if (resolution?.kind === "skip") {
        if (
          isMissingCriteriaKey(body.currentPromptKey) &&
          body.currentPromptKey === "use_case"
        ) {
          skippedKeys = Array.from(new Set([...skippedKeys, body.currentPromptKey]));
        }
        criteriaChanged = true;
      } else if (resolution?.kind === "patch") {
        let patch = resolution.patch;
        if (
          body.currentPromptKey === "vehicle_preferences" &&
          criteria.bodyTypes.length > 0
        ) {
          patch = declinedOptionalPreferencesPatch(true);
        }
        criteria = {
          ...applyChipPatch(criteria, patch),
          latestUserMessage: body.message.trim()
        };
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
    optimizationDirective: criteria.optimizationDirective,
    missingCriteria,
    confidence
  });

  if (isShowAlternatives && !brandWiden && !criteriaChanged) {
    const cachedRecommendations = sessionState.cachedRecommendations;
    if (cachedRecommendations.length > VISIBLE_RECOMMENDATION_LIMIT) {
      const recommendations = cachedRecommendations.slice(VISIBLE_RECOMMENDATION_LIMIT, CACHED_RECOMMENDATION_LIMIT);
      {
        const selectedVehicleIds = new Set([
          ...sessionState.selectedVehicleIds,
          ...recommendations.flatMap((match) => vehicleExclusionKeys(match.vehicle))
        ]);
        await saveMatchSession({
          id: sessionId,
          testerRegistrationId: body.testerRegistrationId,
          criteria,
          selectedVehicleIds: [...selectedVehicleIds],
          cachedRecommendations
        });
      }
      const assistantMessage = alternativesAssistantMessage(criteria, recommendations.length);
      return attachSearchCriteriaDebug(
        {
          type: "matches",
          sessionId,
          assistantMessage,
          message: assistantMessage,
          criteria,
          missingCriteria,
          recommendations,
          alternativeRecommendations: [],
          alternativesAvailable: false,
          responseMode: "alternatives",
          ragCitations: uniqueRagCitations(recommendations),
          rejectedSummary: []
        },
        criteria,
        missingCriteria
      );
    }

    const assistantMessage =
      criteria.language === "de"
        ? "Ich habe noch keine vorbereiteten Alternativen in diesem Chat. Gib mir erst ein paar Suchkriterien, dann halte ich die nächsten Optionen bereit."
        : "I do not have prepared alternatives in this chat yet. Give me search criteria first, then I will keep the next options ready.";
    await saveMatchSession({
      id: sessionId,
      testerRegistrationId: body.testerRegistrationId,
      criteria,
      selectedVehicleIds: sessionState.selectedVehicleIds,
      cachedRecommendations
    });
    return attachSearchCriteriaDebug(
      {
        type: "chat",
        sessionId,
        assistantMessage,
        message: assistantMessage,
        criteria,
        missingCriteria,
        recommendations: [],
        ragCitations: [],
        rejectedSummary: []
      },
      criteria,
      missingCriteria
    );
  }

  const storedSelectedVehicleIds =
    sessionState.selectedVehicleIds.length
      ? sessionState.selectedVehicleIds
      : body.sessionId && body.testerRegistrationId
        ? await recoverShownVehicleKeysFromChat(body.testerRegistrationId, body.sessionId)
        : [];
  const cachedRecommendationVehicleIds =
    sessionState.cachedRecommendations.flatMap((match) => vehicleExclusionKeys(match.vehicle));
  const shownVehicleIds =
    isNextBatch && !body.criteriaOverride
      ? new Set([...storedSelectedVehicleIds, ...cachedRecommendationVehicleIds])
      : new Set<string>();
  let nextSelectedVehicleIds = new Set(
    body.criteriaOverride || (criteriaChanged && !isNextBatch) ? [] : storedSelectedVehicleIds
  );
  const searchOffset =
    isNextBatch && shownVehicleIds.size
      ? countPrimaryVehicleKeys([...shownVehicleIds]) * NEXT_BATCH_SEARCH_OFFSET_STEP
      : 0;

  const nextPrompt = nextClarificationPrompt(criteria, skippedKeys);
  // Chip-only first messages still clarify once; criteriaOverride is an intentional force path.
  // If the opening message already named an optimization (best value, family fit, …), search immediately.
  const firstTurnMustClarify = !hasPriorContext && !body.criteriaOverride;
  const forceFirstTurnOptimization =
    firstTurnMustClarify && nextPrompt.key === "ready" && !criteria.optimizationDirective;
  const promptForTurn = forceFirstTurnOptimization
    ? getOptimizationPrompt(criteria.language)
    : nextPrompt;

  const isChatTurn =
    !body.criteriaPatch &&
    !brandWiden &&
    (trigger === "small_talk" ||
      trigger === "meta" ||
      // Knowledge questions stay conversational unless the turn already named an
      // optimization directive (best value / max range / …) — those must shop.
      (trigger === "ev_question" && !criteria.optimizationDirective));

  const readyToSearch =
    promptForTurn.key === "ready" && readiness.readyToMatch && hasMeaningfulCriteria(criteria);

  const wantsMatch =
    !isChatTurn &&
    !forceFirstTurnOptimization &&
    readiness.groups.budget &&
    readiness.readyToMatch &&
    (readyToSearch ||
      body.intent === "show_matches" ||
      trigger === "show_matches" ||
      trigger === "next_batch" ||
      trigger === "brand_focus" ||
      isNextBatch ||
      (!hasPriorContext &&
        !firstTurnMustClarify &&
        readiness.readyToMatch) ||
      (!hasPriorContext &&
        firstTurnMustClarify &&
        promptForTurn.key === "ready" &&
        Boolean(criteria.optimizationDirective) &&
        readiness.readyToMatch) ||
      (hasPriorContext && criteriaChanged && readiness.readyToMatch));

  if (!wantsMatch) {
    let prompt: ClarificationPrompt | undefined;
    let assistantMessage: string;
    // Never speak ready-search copy without matching in the same turn.
    const safePrompt =
      promptForTurn.key === "ready"
        ? getOptimizationPrompt(criteria.language)
        : promptForTurn;
    const offerPrompt = !isChatTurn && safePrompt.key !== "ready";

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
        assistantMessage = await generateConversationalResponse({
          message: body.message,
          criteria,
          conversationHistory
        });
      }
    } else if (
      !criteriaChanged &&
      body.currentPromptKey === safePrompt.key &&
      safePrompt.key !== "ready"
    ) {
      prompt = safePrompt;
      assistantMessage = await generateNudgeResponse({
        message: body.message,
        criteria,
        catalogQuestion: prompt.question,
        promptKey: prompt.key,
        conversationHistory
      });
    } else {
      prompt = safePrompt;
      assistantMessage = await generateClarificationResponse({
        message: body.message,
        criteria,
        catalogQuestion: prompt.question,
        promptKey: prompt.key,
        chipLabels: prompt.options.filter((option) => !option.skip).map((option) => option.label),
        conversationHistory
      });
    }

    if (!offerPrompt) {
      prompt = undefined;
    }

    assistantMessage = appendDefaultBudgetNotice(assistantMessage, criteria, body.message);

    await saveMatchSession({
      id: sessionId,
      testerRegistrationId: body.testerRegistrationId,
      criteria,
      selectedVehicleIds: [...nextSelectedVehicleIds],
      cachedRecommendations: criteriaChanged ? [] : sessionState.cachedRecommendations
    });
    return attachSearchCriteriaDebug(
      {
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
      },
      criteria,
      missingCriteria
    );
  }

  const retrieved = await withPipelineFallback(
    "retrieve",
    deadline,
    pipelineFallbacks,
    async () => {
      const candidateVehicles = await searchVehicles(criteria, body.message, { offset: searchOffset });
      let scoringSource = candidateVehicles;
      let usedFallbackList = candidateVehicles.length === 0;
      if (!scoringSource.length) {
        scoringSource = await listVehicles();
        usedFallbackList = true;
      }
      // Next-batch with a tiny hybrid/structured hit list often exhausts after one reveal.
      // Expand to the full catalog so "show more" can keep browsing under the same criteria.
      if (isNextBatch && shownVehicleIds.size && scoringSource.length <= CACHED_RECOMMENDATION_LIMIT) {
        const catalog = await listVehicles();
        if (catalog.length > scoringSource.length) {
          scoringSource = catalog;
          usedFallbackList = true;
          if (!pipelineFallbacks.fallbackSource) pipelineFallbacks.fallbackSource = "next_batch_catalog_expand";
        }
      }
      return {
        candidateVehicles,
        scoringVehicles: dedupeVehiclesForMatching(scoringSource),
        structuredHits: candidateVehicles.length,
        embeddingHits: candidateVehicles.filter((vehicle) => (vehicle.embeddingSimilarity ?? 0) > 0).length,
        usedFallbackList
      };
    },
    () => ({
      candidateVehicles: [],
      scoringVehicles: [],
      structuredHits: 0,
      embeddingHits: 0,
      usedFallbackList: true
    })
  );
  // Pipeline timeout/error fallback returns an empty scoring pool; load the catalog list so matching
  // still has candidates (same path as an empty hybrid/structured search).
  if (!retrieved.scoringVehicles.length) {
    const listFallback = dedupeVehiclesForMatching(await listVehicles());
    if (listFallback.length) {
      retrieved.scoringVehicles = listFallback;
      retrieved.usedFallbackList = true;
      if (!pipelineFallbacks.fallbackSource) pipelineFallbacks.fallbackSource = "retrieve_empty";
    }
  }
  if (retrieved.usedFallbackList && !pipelineFallbacks.fallbackSource) {
    pipelineFallbacks.fallbackSource = "retrieve_empty";
  }

  const sanePool = filterVehiclesWithSanityChecks(retrieved.scoringVehicles);
  const candidateVehicles = retrieved.candidateVehicles;
  let scoringVehicles = sanePool.vehicles;
  const structuredHits = retrieved.structuredHits;
  const embeddingHits = retrieved.embeddingHits;
  const retrieveDebug = emitRetrieveMatchingDiagnostics({
    sessionId,
    embeddingHits,
    structuredHits
  });
  matchDebug("candidate-pool", {
    sessionId,
    searchedVehicles: candidateVehicles.length,
    scoringVehicles: scoringVehicles.length,
    embeddingHits,
    searchOffset,
    shownVehicleKeys: shownVehicleIds.size,
    usedFallbackList: retrieved.usedFallbackList,
    sanityRejectedVehicles: sanePool.rejectedCount,
    ...retrieveDebug
  });
  let nextBatchVehicles = isNextBatch
    ? scoringVehicles.filter((vehicle) => !vehicleHasShownKey(vehicle, shownVehicleIds))
    : scoringVehicles;
  if (isNextBatch && shownVehicleIds.size && nextBatchVehicles.length === 0) {
    const catalog = filterVehiclesWithSanityChecks(await listVehicles()).vehicles.filter(
      (vehicle) => !vehicleHasShownKey(vehicle, shownVehicleIds)
    );
    if (catalog.length) {
      scoringVehicles = filterVehiclesWithSanityChecks(await listVehicles()).vehicles;
      nextBatchVehicles = catalog;
      if (!pipelineFallbacks.fallbackSource) pipelineFallbacks.fallbackSource = "next_batch_catalog_expand";
    }
  }
  const matchingCandidates = limitVehiclesPerModel(nextBatchVehicles, criteria, MATCH_MODEL_CANDIDATE_LIMIT);
  matchDebug("matching-candidates", {
    sessionId,
    nextBatchVehicles: nextBatchVehicles.length,
    matchingCandidates: matchingCandidates.length,
    modelBuckets: new Set(matchingCandidates.map(vehicleModelKey)).size
  });
  // Knowledge RAG disconnected — vehicle keyword context only (no knowledge_documents/chunks).
  const ragContext = buildRagContext({
    message: body.message,
    criteria,
    vehicles: matchingCandidates,
    documents: []
  });
  const result = await withPipelineFallback(
    "filter_score",
    deadline,
    pipelineFallbacks,
    () => Promise.resolve(matchVehicles(matchingCandidates, criteria, MATCH_CANDIDATE_LIMIT, { ragContext })),
    () => matchVehicles(matchingCandidates, criteria, MATCH_CANDIDATE_LIMIT, { ragContext })
  );
  const llmScoring = await withPipelineFallback(
    "llm_score",
    deadline,
    pipelineFallbacks,
    () => rankRecommendationsWithLlm(result.recommendations, criteria, body.message, ragContext),
    () => ({ rankings: [], usedLlm: false })
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
    matchingPipeline: retrieveDebug.matchingPipeline,
    retrievePolicy: retrieveDebug.retrievePolicy,
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
    recommendations: diversifiedRecommendations,
    fallbackStages: pipelineFallbacks.fallbackStages,
    timedOutStages: pipelineFallbacks.timedOutStages,
    fallbackSource: pipelineFallbacks.fallbackSource,
    sanityRejectedVehicles: sanePool.rejectedCount,
    cachedAlternatives: Math.min(2, Math.max(0, diversifiedRecommendations.length - 1))
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
      selectedVehicleIds: [...nextSelectedVehicleIds],
      cachedRecommendations: []
    });
    const assistantMessage =
      isNextBatch && shownVehicleIds.size
        ? await generateNoMoreMatchesMessage(criteria, conversationHistory)
        : await generateNoMatchesMessage({ criteria, rejectedSummary, conversationHistory });
    return attachSearchCriteriaDebug(
      attachDiagnostics(
        {
          type: "no_matches",
          sessionId,
          assistantMessage,
          message: assistantMessage,
          criteria,
          missingCriteria,
          recommendations: [],
          ragCitations: ragContext.documents,
          rejectedSummary
        },
        diagnostics
      ),
      criteria,
      missingCriteria
    );
  }

  const explanationLimit = Math.min(resolveRecommendationLimit(criteria), CACHED_RECOMMENDATION_LIMIT);
  const finalSelection = await withPipelineFallback(
    "select_explain",
    deadline,
    pipelineFallbacks,
    () =>
      selectAndExplainMatches(diversifiedRecommendations, criteria, {
        maxRecommendations: explanationLimit,
        rejectedSummary,
        brandWiden
      }),
    () => fallbackSelection(diversifiedRecommendations, criteria, explanationLimit, brandWiden)
  );

  const cachedRecommendations = addPrimaryRecommendationJustification(
    finalSelection.recommendations.slice(0, CACHED_RECOMMENDATION_LIMIT),
    diversifiedRecommendations.length,
    criteria
  );
  const recommendations = cachedRecommendations.slice(0, VISIBLE_RECOMMENDATION_LIMIT);
  const alternativeRecommendations = cachedRecommendations.slice(
    VISIBLE_RECOMMENDATION_LIMIT,
    CACHED_RECOMMENDATION_LIMIT
  );
  const inventoryBrands = brandWiden
    ? [...new Set(cachedRecommendations.map((match) => match.vehicle.make).filter(Boolean))]
    : undefined;
  const assistantMessage = appendLowConfidenceQuestion(
    finalSelection.assistantMessage ||
      fallbackMatchIntroMessage(criteria, recommendations.length, null, inventoryBrands),
    null
  );
  const responseDiagnostics = buildMatchDiagnostics({
    matchingPipeline: retrieveDebug.matchingPipeline,
    retrievePolicy: retrieveDebug.retrievePolicy,
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
    recommendations: cachedRecommendations,
    fallbackStages: pipelineFallbacks.fallbackStages,
    timedOutStages: pipelineFallbacks.timedOutStages,
    fallbackSource: pipelineFallbacks.fallbackSource,
    sanityRejectedVehicles: sanePool.rejectedCount,
    cachedAlternatives: alternativeRecommendations.length
  });

  nextSelectedVehicleIds = new Set([
    ...(!isNextBatch || body.criteriaOverride ? [] : shownVehicleIds),
    ...recommendations.flatMap((match) => vehicleExclusionKeys(match.vehicle))
  ]);

  await saveMatchSession({
    id: sessionId,
    testerRegistrationId: body.testerRegistrationId,
    criteria,
    selectedVehicleIds: [...nextSelectedVehicleIds],
    cachedRecommendations
  });

  return attachSearchCriteriaDebug(
    attachDiagnostics(
      {
        type: "matches",
        sessionId,
        assistantMessage,
        message: assistantMessage,
        criteria,
        missingCriteria,
        recommendations,
        alternativeRecommendations,
        alternativesAvailable: alternativeRecommendations.length > 0,
        responseMode: "primary",
        ragCitations: ragContext.documents,
        rejectedSummary
      },
      responseDiagnostics
    ),
    criteria,
    missingCriteria
  );
}

function createPipelineDeadline() {
  return Date.now() + matchPipelineTimeoutMs();
}

function matchPipelineTimeoutMs() {
  const configured = Number(process.env.FLOWRYD_MATCH_PIPELINE_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MATCH_PIPELINE_TIMEOUT_MS;
}

export function retrieveMatchingDebugFields() {
  return {
    matchingPipeline: matchingPipeline(),
    retrievePolicy: lightHardMatchingEnabled() ? ("light_hard" as const) : ("full_hard" as const),
    embeddingSearchEnabled: vehicleEmbeddingSearchEnabled()
  };
}

export function emitRetrieveMatchingDiagnostics(extra: Record<string, unknown> = {}) {
  const fields = retrieveMatchingDebugFields();
  if (lightHardMatchingEnabled() && !vehicleEmbeddingSearchEnabled()) {
    matchDebugWarn("retrieve.light-hard-without-embeddings", { ...fields, ...extra });
  }
  return fields;
}

export async function withPipelineFallback<T>(
  stage: string,
  deadline: number,
  fallbackState: PipelineFallbackState,
  operation: () => Promise<T>,
  fallback: () => T
): Promise<T> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    fallbackState.timedOutStages.push(stage);
    fallbackState.fallbackStages.push(stage);
    return fallback();
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => {
          fallbackState.timedOutStages.push(stage);
          fallbackState.fallbackStages.push(stage);
          resolve(fallback());
        }, remainingMs);
      })
    ]);
  } catch (error) {
    fallbackState.fallbackStages.push(stage);
    matchDebug("pipeline-fallback", {
      stage,
      reason: error instanceof Error ? error.message : "unknown"
    });
    return fallback();
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function filterVehiclesWithSanityChecks(vehicles: Vehicle[]) {
  const saneVehicles = vehicles.filter(isSaneVehicleForScoring);
  return {
    vehicles: saneVehicles,
    rejectedCount: vehicles.length - saneVehicles.length
  };
}

function isSaneVehicleForScoring(vehicle: Vehicle) {
  const minPowerKw = vehicle.seats <= 2 ? 5 : 20;
  return (
    isFiniteNumberInRange(vehicle.priceEUR, 1_000, 250_000) &&
    isFiniteNumberInRange(vehicle.rangeKm, 80, 900) &&
    isFiniteNumberInRange(vehicle.efficiencyKwhPer100Km, 8, 40) &&
    isFiniteNumberInRange(vehicle.batteryKwh, 10, 220) &&
    isFiniteNumberInRange(vehicle.seats, 1, 9) &&
    isFiniteNumberInRange(vehicle.cargoLiters, 0, 3_000) &&
    isFiniteNumberInRange(vehicle.powerKw, minPowerKw, 1_000) &&
    // Missing SoH is common on marketplace payloads (undefined/null) — treat as unknown, not insane.
    (vehicle.batterySoH == null || isFiniteNumberInRange(vehicle.batterySoH, 50, 100))
  );
}

function isFiniteNumberInRange(value: number, min: number, max: number) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function fallbackSelection(
  matches: MatchResult[],
  criteria: UserCriteria,
  limit: number,
  brandWiden = false
) {
  const recommendations = matches.slice(0, limit).map((match) => ({
    ...match,
    explanation: match.explanation || fallbackExplanation(match, criteria)
  }));
  const inventoryBrands = brandWiden
    ? [...new Set(recommendations.map((match) => match.vehicle.make).filter(Boolean))]
    : undefined;

  return {
    assistantMessage: fallbackMatchIntroMessage(
      criteria,
      Math.min(recommendations.length, VISIBLE_RECOMMENDATION_LIMIT),
      null,
      inventoryBrands
    ),
    recommendations
  };
}

function addPrimaryRecommendationJustification(
  matches: MatchResult[],
  totalMatches: number,
  criteria: UserCriteria
) {
  if (!matches.length) return matches;
  const [primary, ...alternatives] = matches;
  if (!alternatives.length) return matches;

  const runnerUpNames = alternatives
    .slice(0, 2)
    .map((match) => `${match.vehicle.make} ${match.vehicle.model}`);
  const reason = strongestPrimaryAdvantage(primary, alternatives);
  const facts = concretePrimaryFacts(primary, criteria);
  const justification =
    criteria.language === "de"
      ? `Ich habe den ${primary.vehicle.make} ${primary.vehicle.model} vor ${runnerUpNames.join(" und ")} gewählt, weil ${reason.de}${facts.de ? ` (${facts.de})` : ""}. Insgesamt lag er vor ${Math.max(0, totalMatches - 1)} anderen passenden Treffern.`
      : `I chose the ${primary.vehicle.make} ${primary.vehicle.model} over ${runnerUpNames.join(" and ")} because ${reason.en}${facts.en ? ` (${facts.en})` : ""}. Overall, it beat ${Math.max(0, totalMatches - 1)} other matching result${totalMatches === 2 ? "" : "s"}.`;

  return [
    {
      ...primary,
      explanation: `${primary.explanation || fallbackExplanation(primary, criteria)}\n\n${justification}`
    },
    ...alternatives
  ];
}

function concretePrimaryFacts(primary: MatchResult, criteria: UserCriteria) {
  const partsEn: string[] = [];
  const partsDe: string[] = [];
  const vehicle = primary.vehicle;
  if (criteria.budgetMaxEUR) {
    partsEn.push(`EUR ${vehicle.priceEUR.toLocaleString("de-AT")} vs your budget`);
    partsDe.push(`EUR ${vehicle.priceEUR.toLocaleString("de-AT")} im Budget`);
  }
  if (criteria.rangeFloorKm || criteria.tripNeeds.includes("road_trip")) {
    partsEn.push(`${vehicle.rangeKm} km range`);
    partsDe.push(`${vehicle.rangeKm} km Reichweite`);
  }
  if (criteria.passengers || criteria.tripNeeds.includes("family")) {
    partsEn.push(`${vehicle.seats} seats / ${vehicle.cargoLiters} L cargo`);
    partsDe.push(`${vehicle.seats} Sitze / ${vehicle.cargoLiters} L Kofferraum`);
  }
  if (criteria.bodyTypes.length) {
    partsEn.push(`${vehicle.bodyType} body`);
    partsDe.push(`${vehicle.bodyType}-Karosserie`);
  }
  return {
    en: partsEn.slice(0, 2).join(", "),
    de: partsDe.slice(0, 2).join(", ")
  };
}

function strongestPrimaryAdvantage(primary: MatchResult, alternatives: MatchResult[]) {
  const averages = alternatives.reduce(
    (totals, match) => ({
      priceFit: totals.priceFit + match.scoringBreakdown.priceFit,
      rangeFit: totals.rangeFit + match.scoringBreakdown.rangeFit,
      efficiencyFit: totals.efficiencyFit + match.scoringBreakdown.efficiencyFit,
      brandFit: totals.brandFit + match.scoringBreakdown.brandFit,
      cargoPassengerFit: totals.cargoPassengerFit + match.scoringBreakdown.cargoPassengerFit,
      reliabilityFit: totals.reliabilityFit + match.scoringBreakdown.reliabilityFit,
      featureFit: totals.featureFit + match.scoringBreakdown.featureFit
    }),
    {
      priceFit: 0,
      rangeFit: 0,
      efficiencyFit: 0,
      brandFit: 0,
      cargoPassengerFit: 0,
      reliabilityFit: 0,
      featureFit: 0
    }
  );
  const count = Math.max(1, alternatives.length);
  const deltas = Object.entries(primary.scoringBreakdown).map(([key, value]) => ({
    key,
    delta: value - averages[key as keyof typeof averages] / count
  }));
  const strongest = deltas.sort((left, right) => right.delta - left.delta)[0]?.key ?? "score";
  const labels: Record<string, { en: string; de: string }> = {
    priceFit: { en: "its price fit was stronger", de: "der Preis besser passte" },
    rangeFit: { en: "its range fit was stronger", de: "die Reichweite besser passte" },
    efficiencyFit: { en: "its efficiency was stronger", de: "die Effizienz besser passte" },
    brandFit: { en: "it matched your brand intent better", de: "er besser zu deiner Markenrichtung passte" },
    cargoPassengerFit: { en: "it fit the space and passenger needs better", de: "Platz und Sitze besser passten" },
    reliabilityFit: { en: "its reliability profile was stronger", de: "das Zuverlaessigkeitsprofil staerker war" },
    featureFit: { en: "it covered the requested equipment better", de: "die Ausstattung besser passte" },
    score: { en: "it had the strongest overall score", de: "er insgesamt am besten bewertet wurde" }
  };
  return labels[strongest] ?? labels.score;
}

function appendLowConfidenceQuestion(message: string, lowConfidenceQuestion?: string | null) {
  if (!lowConfidenceQuestion) return message;
  return message.includes(lowConfidenceQuestion) ? message : `${message}\n\n${lowConfidenceQuestion}`;
}

function alternativesAssistantMessage(criteria: UserCriteria, count: number) {
  if (criteria.language === "de") {
    return count === 1
      ? "Hier ist die vorbereitete Alternative aus derselben Bewertung."
      : `Hier sind die ${count} vorbereiteten Alternativen aus derselben Bewertung.`;
  }
  return count === 1
    ? "Here is the prepared alternative from the same scoring pass."
    : `Here are the ${count} prepared alternatives from the same scoring pass.`;
}

function appendDefaultBudgetNotice(message: string, criteria: UserCriteria, userMessage: string) {
  if (!looksLikeNoBudgetLimit(userMessage)) return message;
  if (criteria.budgetMinEUR !== DEFAULT_BUDGET_MIN_EUR || criteria.budgetMaxEUR !== DEFAULT_BUDGET_MAX_EUR) {
    return message;
  }
  const notice =
    criteria.language === "de"
      ? `Ich nutze dafür als Arbeitsbudget ${DEFAULT_BUDGET_MIN_EUR.toLocaleString("de-AT")}-${DEFAULT_BUDGET_MAX_EUR.toLocaleString("de-AT")} EUR.`
      : `I will use ${DEFAULT_BUDGET_MIN_EUR.toLocaleString("de-AT")}-${DEFAULT_BUDGET_MAX_EUR.toLocaleString("de-AT")} EUR as the working budget.`;
  return message.includes(notice) ? message : `${message}\n\n${notice}`;
}

function uniqueRagCitations(matches: MatchResult[]) {
  const seen = new Set<string>();
  return matches
    .flatMap((match) => match.ragEvidence)
    .filter((citation) => {
      const key = `${citation.sourceType}:${citation.sourceId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function resolveRecommendationLimit(criteria: UserCriteria) {
  if (criteria.modelPreferences.length || criteria.brandPreferences.length) {
    return FOCUSED_RECOMMENDATION_LIMIT;
  }
  return DEFAULT_RECOMMENDATION_LIMIT;
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
  delete comparable.latestUserMessage;
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

function resolveActiveClarificationKey(
  currentPromptKey: ClarificationPromptKey | undefined,
  criteria: UserCriteria,
  skippedKeys: MissingCriteria[]
): ClarificationPromptKey | null {
  if (currentPromptKey === "optimization") return "optimization";
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
