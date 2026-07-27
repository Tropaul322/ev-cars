import type { MatchResult, Vehicle } from "./types.ts";
import type { MatchingPipeline } from "./vehicle-search-settings.ts";

export type MatchDiagnostics = {
  matchingPipeline: MatchingPipeline;
  retrievePolicy: "light_hard" | "full_hard";
  embeddingQueryStatus: "ok" | "disabled" | "unavailable";
  embeddingProvider?: "openai" | "gemini";
  embeddingHits: number;
  structuredHits: number;
  candidatePoolSize: number;
  scoringPoolSize: number;
  excludedShownKeys: number;
  excludedShownVehicles: number;
  isNextBatch: boolean;
  criteriaChanged: boolean;
  searchOffset: number;
  fallbackStages: string[];
  timedOutStages: string[];
  fallbackSource?: string;
  sanityRejectedVehicles: number;
  cachedAlternatives: number;
  selectionNotes: string[];
};

export function buildMatchDiagnostics(input: {
  matchingPipeline: MatchDiagnostics["matchingPipeline"];
  retrievePolicy: MatchDiagnostics["retrievePolicy"];
  embeddingQueryStatus: MatchDiagnostics["embeddingQueryStatus"];
  embeddingProvider?: MatchDiagnostics["embeddingProvider"];
  embeddingHits: number;
  structuredHits: number;
  candidatePoolSize: number;
  scoringPoolSize: number;
  excludedShownKeys: string[];
  isNextBatch: boolean;
  criteriaChanged: boolean;
  searchOffset: number;
  recommendations: MatchResult[];
  fallbackStages?: string[];
  timedOutStages?: string[];
  fallbackSource?: string;
  sanityRejectedVehicles?: number;
  cachedAlternatives?: number;
}): MatchDiagnostics {
  const selectionNotes = explainSelection(input);

  return {
    matchingPipeline: input.matchingPipeline,
    retrievePolicy: input.retrievePolicy,
    embeddingQueryStatus: input.embeddingQueryStatus,
    embeddingProvider: input.embeddingProvider,
    embeddingHits: input.embeddingHits,
    structuredHits: input.structuredHits,
    candidatePoolSize: input.candidatePoolSize,
    scoringPoolSize: input.scoringPoolSize,
    excludedShownKeys: input.excludedShownKeys.length,
    excludedShownVehicles: countPrimaryVehicleKeys(input.excludedShownKeys),
    isNextBatch: input.isNextBatch,
    criteriaChanged: input.criteriaChanged,
    searchOffset: input.searchOffset,
    fallbackStages: input.fallbackStages ?? [],
    timedOutStages: input.timedOutStages ?? [],
    fallbackSource: input.fallbackSource,
    sanityRejectedVehicles: input.sanityRejectedVehicles ?? 0,
    cachedAlternatives: input.cachedAlternatives ?? 0,
    selectionNotes
  };
}

export function countPrimaryVehicleKeys(keys: string[]) {
  return keys.filter(
    (key) => !key.startsWith("listing:") && !key.startsWith("dedupe:") && !key.startsWith("fingerprint:")
  ).length;
}

export function vehicleExclusionKeys(vehicle: Vehicle) {
  return [
    vehicle.id,
    vehicle.dedupeKey ? `dedupe:${vehicle.dedupeKey}` : null,
    vehicle.inventoryFingerprint ? `fingerprint:${vehicle.inventoryFingerprint}` : null,
    vehicle.listingUrl ? `listing:${normalizeListingUrl(vehicle.listingUrl)}` : null
  ].filter((key): key is string => Boolean(key));
}

export function vehiclePrimaryMatchKey(vehicle: Vehicle) {
  return (
    (vehicle.dedupeKey ? `dedupe:${vehicle.dedupeKey}` : null) ??
    (vehicle.listingUrl ? `listing:${normalizeListingUrl(vehicle.listingUrl)}` : null) ??
    (vehicle.inventoryFingerprint ? `fingerprint:${vehicle.inventoryFingerprint}` : null) ??
    `id:${vehicle.id}`
  );
}

function explainSelection(input: {
  embeddingQueryStatus: MatchDiagnostics["embeddingQueryStatus"];
  embeddingHits: number;
  structuredHits: number;
  candidatePoolSize: number;
  scoringPoolSize: number;
  excludedShownKeys: string[];
  isNextBatch: boolean;
  criteriaChanged: boolean;
  searchOffset: number;
  recommendations: MatchResult[];
  fallbackStages?: string[];
  timedOutStages?: string[];
  fallbackSource?: string;
  sanityRejectedVehicles?: number;
  cachedAlternatives?: number;
}) {
  const notes: string[] = [];

  if (input.embeddingQueryStatus === "disabled") {
    notes.push("Embedding search is disabled; rankings use structured SQL filters and price/range scoring.");
  } else if (input.embeddingQueryStatus === "unavailable") {
    notes.push(
      "Query embedding could not be created (OpenAI/Gemini unavailable). Semantic search was skipped, so similar wording may return the same price/range winners."
    );
  } else if (input.embeddingHits === 0) {
    notes.push("Query embedding succeeded but returned no inventory neighbors above the similarity floor.");
  } else {
    notes.push(`Semantic search contributed ${input.embeddingHits} candidate vehicles.`);
  }

  if (input.structuredHits > 0) {
    notes.push(
      `Structured search contributed ${input.structuredHits} vehicles ordered by price then range${input.searchOffset ? ` (offset ${input.searchOffset})` : ""}.`
    );
  }

  if (input.isNextBatch) {
  notes.push(
      input.excludedShownKeys.length
        ? `Next-batch mode excluded ${countPrimaryVehicleKeys(input.excludedShownKeys)} previously shown vehicles.`
        : "Next-batch mode requested but no previously shown vehicles were found in session state."
    );
  } else if (input.criteriaChanged) {
    notes.push("Criteria changed, so prior shown-vehicle exclusions were cleared.");
  }

  notes.push(
    `Scoring pool: ${input.scoringPoolSize} vehicles after dedupe/model caps from ${input.candidatePoolSize} search hits.`
  );

  const duplicateModels = countDuplicateModels(input.recommendations);
  if (duplicateModels.length) {
    notes.push(`Listing diversity capped repeats for: ${duplicateModels.join(", ")}.`);
  }

  if (input.fallbackStages?.length) {
    notes.push(`Fallback used for: ${input.fallbackStages.join(", ")}.`);
  }

  if (input.timedOutStages?.length) {
    notes.push(`Timed out stages: ${input.timedOutStages.join(", ")}.`);
  }

  if ((input.sanityRejectedVehicles ?? 0) > 0) {
    notes.push(`${input.sanityRejectedVehicles} candidate vehicles failed numeric sanity checks.`);
  }

  if ((input.cachedAlternatives ?? 0) > 0) {
    notes.push(`${input.cachedAlternatives} cached alternatives are ready for instant reveal.`);
  }

  return notes;
}

function countDuplicateModels(recommendations: MatchResult[]) {
  const counts = new Map<string, number>();
  for (const match of recommendations) {
    const key = `${match.vehicle.make} ${match.vehicle.model}`.trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([model]) => model);
}

function normalizeListingUrl(url: string) {
  return url.trim().replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
}

export function matchDiagnosticsEnabled() {
  return process.env.FLOWRYD_MATCH_DEBUG === "1";
}
