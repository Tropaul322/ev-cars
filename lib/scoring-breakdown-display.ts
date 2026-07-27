import { optimizationDirectiveLabels, personalWishLabels } from "./criteria.ts";
import { getBaseScoringWeights } from "./scoring.ts";
import type { MatchResult, ScoringBreakdown, UserCriteria } from "./types.ts";

const FACTOR_LABELS: Record<keyof ScoringBreakdown, string> = {
  priceFit: "Price fit",
  rangeFit: "Range fit",
  efficiencyFit: "Efficiency",
  brandFit: "Brand fit",
  cargoPassengerFit: "Cargo / seats",
  reliabilityFit: "Reliability",
  featureFit: "Features",
};

const FACTOR_ORDER: Array<keyof ScoringBreakdown> = [
  "priceFit",
  "rangeFit",
  "efficiencyFit",
  "brandFit",
  "cargoPassengerFit",
  "reliabilityFit",
  "featureFit",
];

export type ScoringBreakdownRow = {
  key: keyof ScoringBreakdown;
  label: string;
  factorScore: number;
  weightPct: number;
  baseWeightPct: number;
  weightDeltaPct: number;
  contribution: number;
};

export function buildScoringBreakdownRows(match: MatchResult): ScoringBreakdownRow[] {
  const base = getBaseScoringWeights();
  const weights = match.scoringWeights ?? base;

  return FACTOR_ORDER.map((key) => {
    const factorScore = match.scoringBreakdown[key];
    const weight = weights[key];
    const baseWeight = base[key];
    return {
      key,
      label: FACTOR_LABELS[key],
      factorScore,
      weightPct: Math.round(weight * 100),
      baseWeightPct: Math.round(baseWeight * 100),
      weightDeltaPct: Math.round((weight - baseWeight) * 100),
      contribution: Math.round(factorScore * weight),
    };
  });
}

export function computeWeightedRuleScore(
  breakdown: ScoringBreakdown,
  weights: ScoringBreakdown = getBaseScoringWeights()
) {
  return Math.round(
    FACTOR_ORDER.reduce((sum, key) => sum + breakdown[key] * weights[key], 0)
  );
}

export function describeScoringWeightAdjustments(criteria: UserCriteria | null | undefined): string[] {
  if (!criteria) return [];

  const notes: string[] = [];

  if (criteria.optimizationDirective) {
    notes.push(`Optimization focus: ${optimizationDirectiveLabels[criteria.optimizationDirective]}.`);
  }
  if (criteria.personalWish) {
    notes.push(`Personal wish: ${personalWishLabels[criteria.personalWish]}.`);
  }
  if (criteria.preferredBrandOrigins.length) {
    notes.push(`Preferred brand origin (${criteria.preferredBrandOrigins.join(", ")}) increases brand weight.`);
  }
  if (criteria.mustHaveFeatures.length) {
    notes.push("Must-have features increase feature weight.");
  }
  if (criteria.tripNeeds.includes("road_trip") || criteria.chargingAccess === "public") {
    notes.push("Road-trip or public-charging context increases range weight.");
  }
  if (criteria.preferredCondition === "used" || criteria.qualitativeSignals.includes("good_battery_health")) {
    notes.push("Used / battery-health focus increases reliability weight.");
  }
  if (criteria.qualitativeSignals.includes("premium")) {
    notes.push("Premium preference increases brand weight.");
  }
  if (criteria.qualitativeSignals.includes("low_mileage")) {
    notes.push("Low-mileage preference increases reliability weight.");
  }
  if (criteria.reliabilityImportance === "high") {
    notes.push("High reliability importance increases reliability weight.");
  }
  if (criteria.brandFit === "high") {
    notes.push("Strong brand preference increases brand weight.");
  }

  return notes;
}

export function formatWeightDelta(deltaPct: number) {
  if (deltaPct === 0) return "default weight";
  const sign = deltaPct > 0 ? "+" : "";
  return `${sign}${deltaPct} pp vs default`;
}
