import {
  hasHardBodyTypeConstraint,
  hasHardBrandConstraint,
  hasHardBrandOriginConstraint,
  hasHardConditionConstraint,
  hasHardPassengerConstraint,
  hasHardRangeConstraint
} from "./criteria.ts";
import type {
  MatchResult,
  RecommendationReason,
  RecommendationReasonLedger,
  UserCriteria
} from "./types.ts";

export function buildRecommendationReasonLedger(
  match: Omit<MatchResult, "reasonLedger">,
  criteria: UserCriteria
): RecommendationReasonLedger {
  const reasons: RecommendationReason[] = [];
  if (criteria.budgetMaxEUR !== null) {
    reasons.push({ field: "priceEUR", label: "price", value: match.vehicle.priceEUR });
  }
  if (criteria.rangeFloorKm !== null || criteria.tripNeeds.length) {
    reasons.push({ field: "rangeKm", label: "range", value: match.vehicle.rangeKm });
  }
  if (criteria.passengers !== null || criteria.cargoNeeds !== null || criteria.tripNeeds.includes("family")) {
    reasons.push({ field: "seats", label: "seats", value: match.vehicle.seats });
    reasons.push({ field: "cargoLiters", label: "cargo", value: match.vehicle.cargoLiters });
  }
  return {
    positiveReasons: reasons,
    tradeoffs: match.ruledOutReasons.slice(0, 2),
    passedHardFilters: passedHardFilterKeys(criteria),
    factorContributions: match.scoringBreakdown,
    evidenceIds: match.ragEvidence.map((evidence) => evidence.sourceId)
  };
}

export function passedHardFilterKeys(criteria: UserCriteria): string[] {
  const passed = ["market", "availability"];
  if (criteria.budgetMinEUR !== null || criteria.budgetMaxEUR !== null) passed.push("budget");
  if (criteria.monthlyBudgetEUR !== null) passed.push("monthlyBudget");
  if (hasHardConditionConstraint(criteria)) passed.push("explicitCondition");
  if (hasHardRangeConstraint(criteria)) passed.push("explicitRangeFloor");
  if (criteria.mileageMaxKm !== null) passed.push("mileageMaximum");
  if (criteria.batteryHealthRequired && criteria.batterySoHMin !== null) passed.push("requiredBatteryHealth");
  if (hasHardBodyTypeConstraint(criteria)) passed.push("explicitBodyType");
  if (hasHardBrandOriginConstraint(criteria)) passed.push("explicitBrandOrigin");
  if (hasHardBrandConstraint(criteria)) passed.push("explicitBrand");
  if (criteria.modelPreferences.length) passed.push("model");
  if (hasHardPassengerConstraint(criteria)) passed.push("explicitPassengers");
  if (criteria.avoidedBrands.length) passed.push("avoidedBrands");
  if (criteria.mustHaveFeatures.length) passed.push("mustHaveFeatures");
  return passed;
}
