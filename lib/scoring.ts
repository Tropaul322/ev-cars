import type {
  MatchResult,
  RagContext,
  RejectedVehicle,
  ScoringBreakdown,
  UserCriteria,
  Vehicle
} from "./types.ts";
import { getRagEvidenceForVehicle } from "./rag.ts";
import { blendSemanticSignals, scoreVehicleTopicAffinity } from "./semantic-scoring.ts";
import { calculateTco } from "./tco.ts";
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
  priceFit: 0.16,
  rangeFit: 0.12,
  efficiencyFit: 0.08,
  tcoFit: 0.1,
  brandFit: 0.07,
  cargoPassengerFit: 0.08,
  reliabilityFit: 0.08,
  featureFit: 0.1,
  personaFit: 0.12,
  batteryHealthFit: 0.07,
  semanticFit: 0.04
};

export function matchVehicles(
  vehicles: Vehicle[],
  criteria: UserCriteria,
  limit = 6,
  options: { ragContext?: RagContext } = {}
): MatchEngineResult {
  const rejected: RejectedVehicle[] = [];
  const passed: MatchResult[] = [];

  for (const vehicle of vehicles) {
    const reasons = getHardFilterReasons(vehicle, criteria);
    if (reasons.length) {
      rejected.push({ vehicle, reasons });
      continue;
    }

    const tco = calculateTco(vehicle, criteria);
    const scoringBreakdown = scoreVehicle(vehicle, criteria, tco.estimatedMonthlyTotal, options.ragContext);
    const weights = deriveWeights(criteria);
    const baseScore = Math.round(
      Object.entries(scoringBreakdown).reduce((sum, [key, value]) => {
        return sum + value * weights[key as keyof ScoringBreakdown];
      }, 0)
    );
    const ragScore = getRagScore(vehicle, options.ragContext);
    const score = clamp(baseScore, 0, 100);

    passed.push({
      vehicle,
      score,
      ragScore,
      ragEvidence: getRagEvidenceForVehicle(vehicle, options.ragContext),
      hardFilterStatus: "passed",
      scoringBreakdown,
      explanation: "",
      ruledOutReasons: summarizeTradeoffs(vehicle, criteria, scoringBreakdown),
      tco
    });
  }

  return {
    recommendations: passed
      .sort((a, b) => b.score - a.score || b.ragScore - a.ragScore)
      .slice(0, limit),
    rejected
  };
}

export function getHardFilterReasons(vehicle: Vehicle, criteria: UserCriteria) {
  const reasons: string[] = [];
  if (vehicle.market !== "AT") reasons.push("outside Austrian market");
  if (!vehicle.available) reasons.push("not currently available");
  if (criteria.budgetMaxEUR && vehicle.priceEUR > criteria.budgetMaxEUR) {
    reasons.push(`above purchase budget of EUR ${criteria.budgetMaxEUR.toLocaleString("de-AT")}`);
  }
  if (
    criteria.monthlyBudgetEUR &&
    vehicle.monthlyLeaseEUR &&
    vehicle.monthlyLeaseEUR > criteria.monthlyBudgetEUR
  ) {
    reasons.push(`above monthly budget of EUR ${criteria.monthlyBudgetEUR.toLocaleString("de-AT")}`);
  }
  if (criteria.preferredCondition !== "any" && vehicle.condition !== criteria.preferredCondition) {
    reasons.push(`condition is ${vehicle.condition}, not ${criteria.preferredCondition}`);
  }
  if (criteria.rangeFloorKm && vehicle.rangeKm < criteria.rangeFloorKm) {
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
  if (criteria.bodyTypes.length && !criteria.bodyTypes.includes(vehicle.bodyType)) {
    reasons.push(`body type is ${vehicle.bodyType}`);
  }
  if (!vehicleMatchesBrandOriginPreferences(vehicle, criteria.preferredBrandOrigins)) {
    reasons.push(`brand origin is ${vehicle.brandOrigin}, not ${criteria.preferredBrandOrigins.join(" or ")}`);
  }
  if (!vehicleMatchesBrandPreferences(vehicle, criteria.brandPreferences)) {
    reasons.push(`brand is ${vehiclePrimaryBrand(vehicle)}, not ${criteria.brandPreferences.join(" or ")}`);
  }
  if (!vehicleMatchesModelPreferences(vehicle, criteria.modelPreferences)) {
    reasons.push(`model is ${vehicle.make} ${vehicle.model}, not ${criteria.modelPreferences.join(" or ")}`);
  }
  if (criteria.passengers && vehicle.seats < criteria.passengers) {
    reasons.push(`only ${vehicle.seats} seats`);
  }
  if (criteria.avoidedBrands.some((brand) => sameBrand(brand, vehicle.make))) {
    reasons.push(`brand ${vehicle.make} was excluded`);
  }
  return reasons;
}

export function scoreVehicle(
  vehicle: Vehicle,
  criteria: UserCriteria,
  estimatedMonthlyTotal = calculateTco(vehicle, criteria).estimatedMonthlyTotal,
  ragContext?: RagContext
): ScoringBreakdown {
  return {
    priceFit: scorePrice(vehicle, criteria),
    rangeFit: scoreRange(vehicle, criteria),
    efficiencyFit: scoreEfficiency(vehicle),
    tcoFit: scoreTco(estimatedMonthlyTotal, criteria),
    brandFit: scoreBrand(vehicle, criteria),
    cargoPassengerFit: scoreCargoPassengers(vehicle, criteria),
    reliabilityFit: scoreReliability(vehicle, criteria),
    featureFit: scoreFeatures(vehicle, criteria),
    personaFit: scorePersona(vehicle, criteria),
    batteryHealthFit: scoreBatteryHealth(vehicle, criteria),
    semanticFit: scoreSemantic(vehicle, criteria, ragContext)
  };
}

function deriveWeights(criteria: UserCriteria): Weights {
  const weights = { ...baseWeights };
  if (criteria.monthlyBudgetEUR) weights.tcoFit += 0.04;
  if (criteria.tripNeeds.includes("road_trip") || criteria.chargingAccess === "public") {
    weights.rangeFit += 0.05;
    weights.semanticFit += 0.02;
  }
  if (criteria.mustHaveFeatures.length) weights.featureFit += 0.04;
  if (criteria.preferredCondition === "used" || criteria.qualitativeSignals.includes("good_battery_health")) {
    weights.batteryHealthFit += 0.06;
    weights.reliabilityFit += 0.03;
  }
  if (criteria.qualitativeSignals.includes("premium")) {
    weights.personaFit += 0.04;
    weights.semanticFit += 0.03;
  }
  if (criteria.qualitativeSignals.includes("low_mileage")) {
    weights.reliabilityFit += 0.04;
    weights.batteryHealthFit += 0.02;
  }
  if (criteria.reliabilityImportance === "high") weights.reliabilityFit += 0.04;
  if (criteria.brandFit === "high") weights.brandFit += 0.04;

  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  for (const key of Object.keys(weights) as Array<keyof Weights>) {
    weights[key] = weights[key] / total;
  }
  return weights;
}

function scorePrice(vehicle: Vehicle, criteria: UserCriteria) {
  if (!criteria.budgetMaxEUR) return 76;
  const ratio = vehicle.priceEUR / criteria.budgetMaxEUR;
  if (ratio <= 0.72) return 100;
  if (ratio <= 1) return clamp(100 - (ratio - 0.72) * 95, 68, 100);
  return 0;
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

function scoreTco(estimatedMonthlyTotal: number, criteria: UserCriteria) {
  if (!criteria.monthlyBudgetEUR) return 78;
  const ratio = estimatedMonthlyTotal / criteria.monthlyBudgetEUR;
  if (ratio <= 0.88) return 100;
  if (ratio <= 1.1) return clamp(100 - (ratio - 0.88) * 170, 58, 100);
  return 35;
}

function scoreFeatures(vehicle: Vehicle, criteria: UserCriteria) {
  const desired = criteria.mustHaveFeatures.length
    ? criteria.mustHaveFeatures
    : (["apple_carplay", "adaptive_cruise_control", "lane_keeping_assist", "heated_seats"] as const);
  const hits = desired.filter((feature) => vehicle.features.includes(feature)).length;
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
  return clamp(score, 20, 100);
}

function scoreReliability(vehicle: Vehicle, criteria: UserCriteria) {
  let score = vehicle.condition === "new" ? 88 : 72;
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
  return clamp(score, 25, 100);
}

function scorePersona(vehicle: Vehicle, criteria: UserCriteria) {
  let score = 70;
  if (criteria.tripNeeds.includes("city") && ["compact", "hatchback", "sedan"].includes(vehicle.bodyType)) {
    score += 12;
  }
  if (criteria.tripNeeds.includes("family") && vehicle.seats >= 5 && vehicle.cargoLiters >= 440) {
    score += 16;
  }
  if (criteria.tripNeeds.includes("road_trip") && vehicle.rangeKm >= 500) score += 12;
  if (criteria.tripNeeds.includes("winter") && vehicle.features.includes("awd")) score += 12;
  if (criteria.chargingAccess === "public" && vehicle.rangeKm >= 420) score += 8;
  if (criteria.cargoNeeds === "high" && vehicle.cargoLiters >= 500) score += 10;
  if (criteria.brandPreferences.some((brand) => sameBrand(brand, vehicle.make))) score += 10;
  if (criteria.modelPreferences.length && vehicleMatchesModelPreferences(vehicle, criteria.modelPreferences)) {
    score += 14;
  }
  if (vehicle.reviewTags.some((tag) => criteria.tripNeeds.includes(tagToTripNeed(tag)))) score += 5;
  for (const signal of criteria.qualitativeSignals) {
    score += scoreQualitativeSignal(vehicle, signal);
  }
  return clamp(score, 35, 100);
}

function scoreBatteryHealth(vehicle: Vehicle, criteria: UserCriteria) {
  if (vehicle.condition === "new") return 100;
  if (vehicle.batterySoH === null) return criteria.batterySoHMin ? 38 : 60;
  if (criteria.batterySoHMin) {
    const ratio = vehicle.batterySoH / criteria.batterySoHMin;
    if (ratio >= 1.05) return 100;
    if (ratio >= 1) return 92;
    return clamp(72 - (criteria.batterySoHMin - vehicle.batterySoH) * 8, 25, 72);
  }
  if (vehicle.batterySoH >= 95) return 98;
  if (vehicle.batterySoH >= 90) return 88;
  if (vehicle.batterySoH >= 85) return 72;
  return 45;
}

function scoreSemantic(vehicle: Vehicle, criteria: UserCriteria, ragContext?: RagContext) {
  const keywordScore = ragContext?.vehicleScores[vehicle.id] ?? 0;
  const topicScore = scoreVehicleTopicAffinity(vehicle, criteria, ragContext?.topicAffinity ?? {});
  const blended = blendSemanticSignals({ keywordScore, topicScore });
  return clamp(65 + blended * 35, 45, 100);
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
  if (breakdown.personaFit < 72) tradeoffs.push("persona fit is weaker than the technical fit");
  if (breakdown.priceFit < 75) tradeoffs.push("price is close to the stated ceiling");
  return tradeoffs;
}

function scoreQualitativeSignal(vehicle: Vehicle, signal: UserCriteria["qualitativeSignals"][number]) {
  const tagText = vehicle.reviewTags.join(" ").toLowerCase();
  const notes = vehicle.notes.toLowerCase();
  if (signal === "premium") {
    return premiumMakes.has(normalizeBrand(vehicle.make)) || tagText.includes("premium") || notes.includes("premium")
      ? 14
      : -3;
  }
  if (signal === "low_mileage") {
    if (vehicle.condition === "new") return 14;
    if (vehicle.mileageKm === null) return -8;
    if (vehicle.mileageKm <= 15000) return 14;
    if (vehicle.mileageKm <= 35000) return 8;
    if (vehicle.mileageKm <= 60000) return 1;
    return -14;
  }
  if (signal === "good_battery_health") {
    if (vehicle.condition === "new") return 12;
    if (vehicle.batterySoH === null) return -10;
    return vehicle.batterySoH >= 92 ? 12 : vehicle.batterySoH >= 88 ? 5 : -10;
  }
  if (signal === "reliable") return vehicle.warranty.toLowerCase().includes("warranty") ? 8 : 2;
  if (signal === "road_trip_comfort") return vehicle.rangeKm >= 500 ? 10 : -4;
  if (signal === "fast_charging") return tagText.includes("fast charging") || vehicle.batteryKwh >= 75 ? 8 : 0;
  if (signal === "good_value") return vehicle.priceEUR <= 35000 || tagText.includes("value") ? 8 : 0;
  if (signal === "safety") return vehicle.features.includes("blind_spot_detection") ? 8 : 2;
  if (signal === "technology") return vehicle.features.includes("wireless_charging") || tagText.includes("technology") ? 8 : 2;
  if (signal === "public_charging_fit") return vehicle.rangeKm >= 420 ? 8 : -6;
  return 0;
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

function tagToTripNeed(tag: string): UserCriteria["tripNeeds"][number] {
  if (tag.includes("city")) return "city";
  if (tag.includes("family")) return "family";
  if (tag.includes("road")) return "road_trip";
  if (tag.includes("winter")) return "winter";
  return "commute";
}

function getRagScore(vehicle: Vehicle, ragContext?: RagContext) {
  const keywordScore = ragContext?.vehicleScores[vehicle.id] ?? 0;
  return clamp(Math.round(keywordScore * 7), 0, 7);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
