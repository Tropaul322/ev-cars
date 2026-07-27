import { criteriaChips } from "./criteria.ts";
import { summarizeVehicleSearchFilters } from "./repositories/vehicle-repository.ts";
import type { MatchResponse, MissingCriteria, UserCriteria } from "./types.ts";

export type SearchCriteriaDebug = {
  found: Array<{ key: string; label: string }>;
  usedInSearch: Record<string, unknown>;
  missing: MissingCriteria[];
};

export function searchCriteriaDebugEnabled() {
  return process.env.FLOWRYD_SHOW_SEARCH_CRITERIA === "1";
}

export function buildSearchCriteriaDebug(
  criteria: UserCriteria,
  missingCriteria: MissingCriteria[]
): SearchCriteriaDebug {
  return {
    found: criteriaChips(criteria).map((chip) => ({ key: chip.key, label: chip.label })),
    usedInSearch: compactSearchFilters(summarizeVehicleSearchFilters(criteria)),
    missing: missingCriteria
  };
}

export function attachSearchCriteriaDebug<T extends MatchResponse>(
  response: T,
  criteria: UserCriteria,
  missingCriteria: MissingCriteria[]
): T {
  if (!searchCriteriaDebugEnabled()) return response;
  return { ...response, searchCriteriaDebug: buildSearchCriteriaDebug(criteria, missingCriteria) };
}

function compactSearchFilters(filters: ReturnType<typeof summarizeVehicleSearchFilters>) {
  const compact: Record<string, unknown> = {
    matchingPipeline: filters.matchingPipeline,
    retrievePolicy: filters.retrievePolicy,
    market: filters.market,
    available: filters.available
  };

  if (filters.budgetMinEUR) compact.budgetMinEUR = filters.budgetMinEUR;
  if (filters.budgetMaxEUR) compact.budgetMaxEUR = filters.budgetMaxEUR;
  if (filters.monthlyBudgetEUR) compact.monthlyBudgetEUR = filters.monthlyBudgetEUR;
  if (filters.preferredCondition !== "any") compact.preferredCondition = filters.preferredCondition;
  if (filters.rangeFloorKm) compact.rangeFloorKm = filters.rangeFloorKm;
  if (filters.mileageMaxKm) compact.mileageMaxKm = filters.mileageMaxKm;
  if (filters.batterySoHMin) compact.batterySoHMin = filters.batterySoHMin;
  if (filters.bodyTypes.length) compact.bodyTypes = filters.bodyTypes;
  if (filters.preferredBrandOrigins.length) compact.preferredBrandOrigins = filters.preferredBrandOrigins;
  if (filters.passengers) compact.passengers = filters.passengers;
  if (filters.brandPreferences.length) compact.brandPreferences = filters.brandPreferences;
  if (filters.modelPreferences.length) compact.modelPreferences = filters.modelPreferences;
  if (filters.avoidedBrands.length) compact.avoidedBrands = filters.avoidedBrands;
  if (filters.location) compact.location = filters.location;
  if (filters.mustHaveFeatures.length) compact.mustHaveFeatures = filters.mustHaveFeatures;

  return compact;
}
