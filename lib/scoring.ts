import { normalizeVehicleFeatures } from "./feature-normalization.ts";
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
  RagContext,
  RejectedVehicle,
  ScoringBreakdown,
  UserCriteria,
  Vehicle
} from "./types.ts";
import { getRagEvidenceForVehicle } from "./rag.ts";
import { buildRecommendationReasonLedger } from "./recommendation-reasons.ts";
import { blendSemanticSignals, scoreVehicleTopicAffinity } from "./semantic-scoring.ts";
import { calculateTco, estimateMonthlyVehiclePayment } from "./tco.ts";
import {
  vehicleMatchesBrandOriginPreferences,
  vehicleMatchesBrandPreferences,
  vehicleMatchesBrandPreference,
  vehicleMatchesModelPreferences,
  vehiclePrimaryBrand
} from "./vehicle-matching.ts";

export type MatchEngineResult = {
  recommendations: MatchResult[];
  rejected: RejectedVehicle[];
};

type Weights = Record<keyof ScoringBreakdown, number>;

const baseWeights: Weights = {
  priceFit: 0.24,
  rangeFit: 0.18,
  efficiencyFit: 0.12,
  brandFit: 0.1,
  cargoPassengerFit: 0.12,
  reliabilityFit: 0.12,
  featureFit: 0.12
};

/** Reviewable hard vs soft attribute policy for matching. */
export const hardFilterPolicy = {
  hard: [
    "market",
    "availability",
    "budget",
    "monthlyBudget",
    "explicitCondition",
    "explicitRangeFloor",
    "mileageMaximum",
    "requiredBatteryHealth",
    "explicitBodyType",
    "explicitBrandOrigin",
    "explicitBrand",
    "model",
    "explicitPassengers",
    "avoidedBrands",
    "mustHaveFeatures"
  ],
  soft: [
    "familyInferredPassengers",
    "familyInferredCargo",
    "preferredBodyType",
    "preferredCondition",
    "preferredBrand",
    "preferredBrandOrigin",
    "qualitativeRange",
    "optimizationDirective",
    "reliabilityPreference"
  ]
} as const;

export function matchVehicles(
  vehicles: Vehicle[],
  criteria: UserCriteria,
  limit = 6,
  options: { ragContext?: RagContext } = {}
): MatchEngineResult {
  const rejected: RejectedVehicle[] = [];
  const passed: MatchResult[] = [];
  const weights = deriveWeights(criteria, vehicles);

  for (const vehicle of vehicles) {
    const reasons = getHardFilterReasons(vehicle, criteria);
    if (reasons.length) {
      rejected.push({ vehicle, reasons });
      continue;
    }

    const tco = calculateTco(vehicle, criteria);
    const scoringBreakdown = scoreVehicle(vehicle, criteria);
    const baseScore = Math.round(
      Object.entries(scoringBreakdown).reduce((sum, [key, value]) => {
        return sum + value * weights[key as keyof ScoringBreakdown];
      }, 0)
    );
    const ragScore = getRagScore(vehicle, options.ragContext);
    const ruleScore = applySemanticScoreBlend(baseScore, vehicle, criteria, options.ragContext);

    const match = {
      vehicle,
      score: ruleScore,
      ruleScore,
      scoreSource: "rules",
      ragScore,
      ragEvidence: getRagEvidenceForVehicle(vehicle, options.ragContext),
      hardFilterStatus: "passed",
      scoringBreakdown,
      explanation: "",
      ruledOutReasons: summarizeTradeoffs(vehicle, criteria, scoringBreakdown),
      tco
    } satisfies Omit<MatchResult, "reasonLedger">;
    passed.push({
      ...match,
      reasonLedger: buildRecommendationReasonLedger(match, criteria)
    });
  }

  return {
    recommendations: passed
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.vehicle.retrievalScore ?? 0) - (a.vehicle.retrievalScore ?? 0) ||
          (b.vehicle.embeddingSimilarity ?? 0) - (a.vehicle.embeddingSimilarity ?? 0) ||
          b.ragScore - a.ragScore
      )
      .slice(0, limit),
    rejected
  };
}

export function getHardFilterReasons(vehicle: Vehicle, criteria: UserCriteria) {
  const reasons: string[] = [];
  if (vehicle.market !== "AT") reasons.push("outside Austrian market");
  if (!vehicle.available) reasons.push("not currently available");
  if (criteria.budgetMinEUR && vehicle.priceEUR < criteria.budgetMinEUR) {
    reasons.push(`below purchase budget floor of EUR ${criteria.budgetMinEUR.toLocaleString("de-AT")}`);
  }
  if (criteria.budgetMaxEUR && vehicle.priceEUR > criteria.budgetMaxEUR) {
    reasons.push(`above purchase budget of EUR ${criteria.budgetMaxEUR.toLocaleString("de-AT")}`);
  }
  if (criteria.monthlyBudgetEUR && estimateMonthlyVehiclePayment(vehicle) > criteria.monthlyBudgetEUR) {
    reasons.push(`above monthly budget of EUR ${criteria.monthlyBudgetEUR.toLocaleString("de-AT")}`);
  }
  if (hasHardConditionConstraint(criteria) && criteria.preferredCondition !== "any" && vehicle.condition !== criteria.preferredCondition) {
    reasons.push(`condition is ${vehicle.condition}, not ${criteria.preferredCondition}`);
  }
  if (hasHardRangeConstraint(criteria) && criteria.rangeFloorKm && vehicle.rangeKm < criteria.rangeFloorKm) {
    reasons.push(`range below requested ${criteria.rangeFloorKm} km`);
  }
  if (criteria.mileageMaxKm && vehicle.condition === "used" && vehicle.mileageKm === null) {
    reasons.push("mileage is not disclosed");
  }
  if (criteria.mileageMaxKm && vehicle.mileageKm !== null && vehicle.mileageKm > criteria.mileageMaxKm) {
    reasons.push(`mileage above requested ${criteria.mileageMaxKm.toLocaleString("de-AT")} km`);
  }
  if (
    criteria.batteryHealthRequired &&
    criteria.batterySoHMin &&
    vehicle.condition === "used" &&
    vehicle.batterySoH === null
  ) {
    reasons.push("battery state-of-health is not disclosed");
  }
  if (
    criteria.batteryHealthRequired &&
    criteria.batterySoHMin &&
    vehicle.batterySoH !== null &&
    vehicle.batterySoH < criteria.batterySoHMin
  ) {
    reasons.push(`battery state-of-health below requested ${criteria.batterySoHMin}%`);
  }
  if (
    hasHardBodyTypeConstraint(criteria) &&
    criteria.bodyTypes.length &&
    !criteria.bodyTypes.includes(vehicle.bodyType)
  ) {
    reasons.push(`body type is ${vehicle.bodyType}`);
  }
  if (
    hasHardBrandOriginConstraint(criteria) &&
    !vehicleMatchesBrandOriginPreferences(vehicle, criteria.preferredBrandOrigins)
  ) {
    reasons.push(`brand origin is ${vehicle.brandOrigin}, not ${criteria.preferredBrandOrigins.join(" or ")}`);
  }
  if (hasHardBrandConstraint(criteria) && !vehicleMatchesBrandPreferences(vehicle, criteria.brandPreferences)) {
    reasons.push(`brand is ${vehiclePrimaryBrand(vehicle)}, not ${criteria.brandPreferences.join(" or ")}`);
  }
  if (!vehicleMatchesModelPreferences(vehicle, criteria.modelPreferences)) {
    reasons.push(`model is ${vehicle.make} ${vehicle.model}, not ${criteria.modelPreferences.join(" or ")}`);
  }
  if (hasHardPassengerConstraint(criteria) && criteria.passengers && vehicle.seats < criteria.passengers) {
    reasons.push(`only ${vehicle.seats} seats`);
  }
  if (criteria.mustHaveFeatures.length) {
    const normalizedFeatures = normalizeVehicleFeatures(vehicle.features, vehicle);
    const missingFeatures = criteria.mustHaveFeatures.filter((feature) => !normalizedFeatures.includes(feature));
    if (missingFeatures.length) {
      reasons.push(`missing required feature${missingFeatures.length === 1 ? "" : "s"}: ${missingFeatures.join(", ")}`);
    }
  }
  if (criteria.avoidedBrands.some((brand) => sameBrand(brand, vehicle.make))) {
    reasons.push(`brand ${vehicle.make} was excluded`);
  }
  return reasons;
}

export function scoreVehicle(vehicle: Vehicle, criteria: UserCriteria): ScoringBreakdown {
  return {
    priceFit: scorePrice(vehicle, criteria),
    rangeFit: scoreRange(vehicle, criteria),
    efficiencyFit: scoreEfficiency(vehicle),
    brandFit: scoreBrand(vehicle, criteria),
    cargoPassengerFit: scoreCargoPassengers(vehicle, criteria),
    reliabilityFit: scoreReliability(vehicle, criteria),
    featureFit: scoreFeatures(vehicle, criteria)
  };
}

export function deriveWeights(criteria: UserCriteria, vehicles: Vehicle[]): Weights {
  const weights = { ...baseWeights };
  if (vehicles.some((vehicle) => (vehicle.embeddingSimilarity ?? 0) > 0)) {
    weights.featureFit += 0.04;
    weights.brandFit += 0.03;
    weights.priceFit -= 0.04;
    weights.rangeFit -= 0.03;
  }
  if (criteria.tripNeeds.includes("road_trip") || criteria.chargingAccess === "public") {
    weights.rangeFit += 0.06;
  }
  if (criteria.mustHaveFeatures.length) weights.featureFit += 0.05;
  if (criteria.preferredCondition === "used" || criteria.qualitativeSignals.includes("good_battery_health")) {
    weights.reliabilityFit += 0.07;
  }
  if (criteria.qualitativeSignals.includes("premium")) {
    weights.brandFit += 0.05;
  }
  if (criteria.qualitativeSignals.includes("low_mileage")) {
    weights.reliabilityFit += 0.05;
  }
  if (criteria.reliabilityImportance === "high") weights.reliabilityFit += 0.05;
  if (criteria.brandFit === "high") weights.brandFit += 0.05;

  if (criteria.optimizationDirective === "best_value") {
    weights.priceFit += 0.14;
    weights.efficiencyFit += 0.04;
    weights.reliabilityFit += 0.03;
  }
  if (criteria.optimizationDirective === "maximum_range") {
    weights.rangeFit += 0.18;
    weights.efficiencyFit += 0.03;
    weights.priceFit -= 0.03;
  }
  if (criteria.optimizationDirective === "most_reliable") {
    weights.reliabilityFit += 0.18;
    weights.efficiencyFit += 0.04;
  }
  if (criteria.optimizationDirective === "fastest_charging") {
    weights.featureFit += 0.1;
    weights.rangeFit += 0.08;
  }
  if (criteria.optimizationDirective === "lowest_running_cost") {
    weights.efficiencyFit += 0.14;
    weights.priceFit += 0.08;
  }
  if (criteria.optimizationDirective === "best_family_fit") {
    weights.cargoPassengerFit += 0.16;
    weights.rangeFit += 0.05;
    weights.reliabilityFit += 0.04;
  }
  if (criteria.optimizationDirective === "performance") {
    weights.featureFit += 0.08;
    weights.brandFit += 0.05;
    weights.rangeFit += 0.04;
  }

  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  for (const key of Object.keys(weights) as Array<keyof Weights>) {
    weights[key] = weights[key] / total;
  }
  return weights;
}

export function scorePrice(vehicle: Vehicle, criteria: UserCriteria) {
  const price = vehicle.priceEUR;
  const min = criteria.budgetMinEUR;
  const max = criteria.budgetMaxEUR;

  if (min !== null && max !== null) {
    if (price >= min && price <= max) {
      const span = max - min;
      if (span <= 0) return 100;
      const mid = (min + max) / 2;
      const distanceFromMid = Math.abs(price - mid) / (span / 2);
      return clamp(100 - distanceFromMid * 6, 94, 100);
    }
    if (price < min) {
      const underBy = min - price;
      const span = Math.max(max - min, min * 0.1);
      return clamp(92 - (underBy / span) * 50, 35, 92);
    }
    return 0;
  }

  if (max !== null) {
    if (price > max) return 0;
    const ratio = price / max;
    if (ratio <= 0.9) return 100;
    return clamp(100 - ((ratio - 0.9) / 0.1) * 12, 88, 100);
  }

  if (min !== null) {
    if (price < min) {
      const underBy = min - price;
      return clamp(92 - (underBy / min) * 40, 40, 92);
    }
    return 100;
  }

  return 76;
}

function scoreRange(vehicle: Vehicle, criteria: UserCriteria) {
  const target =
    criteria.rangeFloorKm ??
    (criteria.tripNeeds.includes("road_trip")
      ? 500
      : criteria.chargingAccess === "public"
        ? 420
        : criteria.tripNeeds.includes("city")
          ? 300
          : 380);
  return clamp((vehicle.rangeKm / target) * 100, 45, 100);
}

function scoreEfficiency(vehicle: Vehicle) {
  if (vehicle.efficiencyKwhPer100Km <= 14) return 100;
  if (vehicle.efficiencyKwhPer100Km <= 17) return 90;
  if (vehicle.efficiencyKwhPer100Km <= 20) return 74;
  return 58;
}

function scoreFeatures(vehicle: Vehicle, criteria: UserCriteria) {
  const desired = criteria.mustHaveFeatures.length
    ? criteria.mustHaveFeatures
    : (["apple_carplay", "adaptive_cruise_control", "lane_keeping_assist", "heated_seats"] as const);
  const normalizedFeatures = normalizeVehicleFeatures(vehicle.features, vehicle);
  const hits = desired.filter((feature) => normalizedFeatures.includes(feature)).length;
  return Math.round((hits / desired.length) * 100);
}

function scoreBrand(vehicle: Vehicle, criteria: UserCriteria) {
  if (criteria.avoidedBrands.some((brand) => sameBrand(brand, vehicle.make))) return 0;
  if (!criteria.brandPreferences.length) {
    if (criteria.qualitativeSignals.includes("premium") && premiumMakes.has(normalizeBrand(vehicle.make))) return 88;
    return 76;
  }
  const brandScore = criteria.brandPreferences.some((brand) => vehicleMatchesBrandPreference(vehicle, brand)) ? 100 : 52;
  if (criteria.modelPreferences.length && vehicleMatchesModelPreferences(vehicle, criteria.modelPreferences)) {
    return Math.max(brandScore, 96);
  }
  return brandScore;
}

function scoreCargoPassengers(vehicle: Vehicle, criteria: UserCriteria) {
  let score = 78;
  if (criteria.passengers) score += vehicle.seats >= criteria.passengers ? 12 : -40;
  if (criteria.cargoNeeds === "high") score += vehicle.cargoLiters >= 500 ? 18 : vehicle.cargoLiters >= 440 ? 8 : -24;
  if (criteria.cargoNeeds === "medium") score += vehicle.cargoLiters >= 380 ? 12 : -12;
  if (criteria.tripNeeds.includes("family")) {
    score += vehicle.seats >= 5 && vehicle.cargoLiters >= 440 ? 14 : -18;
  }
  if (criteria.bodyTypes.length && !hasHardBodyTypeConstraint(criteria)) {
    score += criteria.bodyTypes.includes(vehicle.bodyType) ? 14 : -22;
  }
  return clamp(score, 20, 100);
}

function scoreReliability(vehicle: Vehicle, criteria: UserCriteria) {
  let score = vehicle.condition === "new" ? 88 : 72;
  if (
    criteria.preferredCondition !== "any" &&
    !hasHardConditionConstraint(criteria)
  ) {
    score += vehicle.condition === criteria.preferredCondition ? 12 : -16;
  }
  const warranty = vehicle.warranty.toLowerCase();
  if (warranty.includes("battery warranty") || warranty.includes("factory warranty") || warranty.includes("garantie")) {
    score += 10;
  }
  if (vehicle.reviewTags.some((tag) => tag.includes("warranty") || tag.includes("safety"))) score += 6;
  if (vehicle.efficiencyKwhPer100Km <= 17) score += 4;
  if (criteria.mileageTargetKm && vehicle.mileageKm !== null) {
    const ratio = vehicle.mileageKm / criteria.mileageTargetKm;
    if (ratio <= 0.7) score += 12;
    else if (ratio <= 1.4) score += 5;
    else score -= 18;
  }
  if (criteria.qualitativeSignals.includes("reliable") && vehicle.batterySoH && vehicle.batterySoH >= 90) score += 8;
  if (vehicle.condition === "used" && vehicle.batterySoH === null) score -= 10;
  if (criteria.qualitativeSignals.includes("good_battery_health")) {
    if (vehicle.condition === "new") score += 8;
    else if (vehicle.batterySoH !== null && vehicle.batterySoH >= 92) score += 10;
    else if (vehicle.batterySoH !== null && vehicle.batterySoH >= 88) score += 4;
    else score -= 8;
  }
  if (criteria.qualitativeSignals.includes("low_mileage")) {
    if (vehicle.condition === "new") score += 8;
    else if (vehicle.mileageKm !== null && vehicle.mileageKm <= 15000) score += 10;
    else if (vehicle.mileageKm !== null && vehicle.mileageKm <= 35000) score += 4;
    else if (vehicle.mileageKm !== null) score -= 8;
  }
  return clamp(score, 25, 100);
}

function summarizeTradeoffs(vehicle: Vehicle, criteria: UserCriteria, breakdown: ScoringBreakdown) {
  const tradeoffs: string[] = [];
  if (vehicle.condition === "used" && vehicle.batterySoH === null) {
    tradeoffs.push("battery state-of-health is not disclosed");
  }
  if (criteria.mileageTargetKm && vehicle.mileageKm !== null && vehicle.mileageKm > criteria.mileageTargetKm * 1.6) {
    tradeoffs.push("mileage is higher than the low-km preference");
  }
  if (criteria.cargoNeeds === "high" && vehicle.cargoLiters < 450) {
    tradeoffs.push("cargo space may be tight");
  }
  if (criteria.tripNeeds.includes("road_trip") && vehicle.rangeKm < 480) {
    tradeoffs.push("range is acceptable but not a road-trip strength");
  }
  if (breakdown.featureFit < 80) tradeoffs.push("some requested comfort or safety features are missing");
  if (breakdown.priceFit < 88) tradeoffs.push("price is close to the stated ceiling");
  return tradeoffs;
}

function sameBrand(input: string, make: string) {
  const normalizedInput = normalizeBrand(input);
  const normalizedMake = normalizeBrand(make);
  return normalizedInput === normalizedMake || normalizedInput.includes(normalizedMake);
}

function normalizeBrand(value: string) {
  return value.toLowerCase().replace("mercedes-benz", "mercedes").replace("volkswagen", "vw");
}

const premiumMakes = new Set(["audi", "bmw", "mercedes", "polestar", "volvo", "porsche", "nio"]);

function applySemanticScoreBlend(
  baseScore: number,
  vehicle: Vehicle,
  criteria: UserCriteria,
  ragContext?: RagContext
) {
  const keywordScore = ragContext?.vehicleScores[vehicle.id] ?? 0;
  const topicScore = ragContext ? scoreVehicleTopicAffinity(vehicle, criteria, ragContext.topicAffinity) : 0;
  const hasKeywordOrTopic = keywordScore > 0 || topicScore > 0;
  if (!hasKeywordOrTopic) return clamp(baseScore, 0, 100);

  const semanticBlend = blendSemanticSignals({ keywordScore, topicScore });
  const semanticWeight = 0.22;
  return clamp(baseScore * (1 - semanticWeight) + semanticBlend * 100 * semanticWeight, 0, 100);
}

function getRagScore(vehicle: Vehicle, ragContext?: RagContext) {
  const keywordScore = ragContext?.vehicleScores[vehicle.id] ?? 0;
  return clamp(Math.round(keywordScore * 7), 0, 7);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
