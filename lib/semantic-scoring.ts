import type { KnowledgeTopic, RagContext, UserCriteria, Vehicle } from "./types.ts";

const premiumMakes = new Set(["audi", "bmw", "mercedes", "polestar", "volvo", "porsche", "nio"]);

export function computeTopicAffinity(
  documents: Array<{ topic?: KnowledgeTopic; score: number; similarity?: number }>
) {
  const weights: Partial<Record<KnowledgeTopic, number>> = {};
  for (const document of documents) {
    if (!document.topic) continue;
    const signal = Math.max(document.score, document.similarity ?? 0);
    if (signal <= 0) continue;
    weights[document.topic] = (weights[document.topic] ?? 0) + signal;
  }

  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return weights;

  for (const topic of Object.keys(weights) as KnowledgeTopic[]) {
    weights[topic] = Math.round(((weights[topic] ?? 0) / total) * 100) / 100;
  }
  return weights;
}

export function scoreVehicleTopicAffinity(
  vehicle: Vehicle,
  criteria: UserCriteria,
  topicAffinity: RagContext["topicAffinity"]
) {
  if (!topicAffinity || !Object.keys(topicAffinity).length) return 0;

  let score = 0;
  const tagText = vehicle.reviewTags.join(" ").toLowerCase();
  const notes = vehicle.notes.toLowerCase();

  if ((topicAffinity.review ?? 0) > 0) {
    if (criteria.tripNeeds.includes("winter")) {
      let winterFit = 0.2;
      if (vehicle.rangeKm >= 450) winterFit += 0.25;
      if (vehicle.rangeKm >= 500) winterFit += 0.2;
      if (vehicle.features.includes("awd")) winterFit += 0.25;
      if (vehicle.features.includes("heat_pump")) winterFit += 0.15;
      if (vehicle.efficiencyKwhPer100Km <= 17) winterFit += 0.1;
      score += (topicAffinity.review ?? 0) * Math.min(1, winterFit);
    } else {
      const premium =
        premiumMakes.has(normalizeBrand(vehicle.make)) ||
        tagText.includes("premium") ||
        notes.includes("premium") ||
        criteria.qualitativeSignals.includes("premium");
      score += (topicAffinity.review ?? 0) * (premium ? 1 : 0.35);
    }
  }

  if ((topicAffinity.charging_network ?? 0) > 0) {
    let fit = 0.2;
    if (criteria.chargingAccess === "public") fit += 0.2;
    if (criteria.qualitativeSignals.includes("public_charging_fit")) fit += 0.15;
    if (vehicle.rangeKm >= 420) fit += 0.35;
    if (vehicle.rangeKm >= 500) fit += 0.15;
    if (vehicle.features.includes("heat_pump")) fit += 0.05;
    score += (topicAffinity.charging_network ?? 0) * Math.min(1, fit);
  }

  if ((topicAffinity.technical_spec ?? 0) > 0) {
    let technicalFit = 0.25;
    if (vehicle.efficiencyKwhPer100Km <= 17) technicalFit += 0.25;
    if (vehicle.rangeKm >= 450) technicalFit += 0.25;
    if (vehicle.batteryKwh >= 75 && criteria.qualitativeSignals.includes("fast_charging")) technicalFit += 0.2;
    if (criteria.rangeFloorKm !== null || criteria.qualitativeSignals.includes("technology")) technicalFit += 0.15;
    score += (topicAffinity.technical_spec ?? 0) * Math.min(1, technicalFit);
  }

  if ((topicAffinity.austrian_incentive ?? 0) > 0) {
    score += (topicAffinity.austrian_incentive ?? 0) * 0.5;
  }

  if ((topicAffinity.general ?? 0) > 0) {
    score += (topicAffinity.general ?? 0) * 0.25;
  }

  return Math.min(1, score);
}

export function blendSemanticSignals(input: {
  keywordScore: number;
  topicScore: number;
  embeddingScore?: number;
}) {
  if (input.embeddingScore !== undefined && input.embeddingScore > 0) {
    const ragBlend = input.keywordScore * 0.55 + input.topicScore * 0.45;
    return input.embeddingScore * 0.6 + ragBlend * 0.4;
  }
  return input.keywordScore * 0.65 + input.topicScore * 0.35;
}

export type SemanticSignalShares = {
  embedding: number;
  keyword: number;
  topic: number;
};

/** Raw blend shares used for point attribution (same weights as blendSemanticSignals). */
export function semanticSignalShares(input: {
  keywordScore: number;
  topicScore: number;
  embeddingScore?: number;
}): SemanticSignalShares {
  if (input.embeddingScore !== undefined && input.embeddingScore > 0) {
    return {
      embedding: input.embeddingScore * 0.6,
      keyword: input.keywordScore * 0.55 * 0.4,
      topic: input.topicScore * 0.45 * 0.4
    };
  }
  return {
    embedding: 0,
    keyword: input.keywordScore * 0.65,
    topic: input.topicScore * 0.35
  };
}

function normalizeBrand(value: string) {
  return value.toLowerCase().replace("mercedes-benz", "mercedes").replace("volkswagen", "vw");
}
