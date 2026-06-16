import { computeTopicAffinity } from "./semantic-scoring.ts";
import { createQueryEmbedding } from "./embeddings.ts";
import type { KnowledgeDocument } from "./repositories/knowledge-repository.ts";
import {
  inferTopic,
  listKnowledgeChunks,
  listKnowledgeDocuments,
  matchKnowledgeChunksByEmbedding
} from "./repositories/knowledge-repository.ts";
import type { Feature, RagContext, RagEvidence, UserCriteria, Vehicle } from "./types.ts";
import { vehicleTitle, buildVehicleEmbeddingText } from "./vehicle-embedding-text.ts";
import {
  vehicleMatchesBrandOriginPreferences,
  vehicleMatchesBrandPreference,
  vehicleMatchesModelPreferences
} from "./vehicle-matching.ts";

type BuildRagContextInput = {
  message: string;
  criteria: UserCriteria;
  vehicles: Vehicle[];
  documents: KnowledgeDocument[];
  documentLimit?: number;
  vehicleLimit?: number;
};

const stopWords = new Set([
  "a",
  "about",
  "and",
  "around",
  "auto",
  "brauch",
  "brauche",
  "bis",
  "car",
  "cars",
  "der",
  "die",
  "das",
  "eauto",
  "electric",
  "elektro",
  "ev",
  "fuer",
  "fur",
  "good",
  "health",
  "habe",
  "ich",
  "im",
  "in",
  "mit",
  "need",
  "needs",
  "oder",
  "of",
  "ohne",
  "the",
  "und",
  "under",
  "unter",
  "with",
  "wohne",
  "zu"
]);

const tokenAliases: Record<string, string[]> = {
  acc: ["adaptive", "cruise", "control"],
  allrad: ["awd", "winter"],
  apartment: ["public", "charging"],
  autobahn: ["road", "trip", "range"],
  assistenzsysteme: ["adaptive", "cruise", "lane", "assist"],
  carplay: ["apple", "carplay"],
  familie: ["family", "cargo", "trunk"],
  familien: ["family", "cargo", "trunk"],
  kofferraum: ["trunk", "cargo"],
  langstrecke: ["road", "trip", "range"],
  ladeinfrastruktur: ["charging"],
  reichweite: ["range"],
  sitzheizung: ["heated", "seats"],
  wallbox: ["home", "charging"],
  warmepumpe: ["heat", "pump"],
  winter: ["awd", "snow"],
  wohnung: ["public", "charging", "apartment"]
};

const featureLabels: Record<Feature, string> = {
  adaptive_cruise_control: "adaptive cruise control acc tempomat",
  android_auto: "android auto",
  apple_carplay: "apple carplay",
  awd: "awd allrad winter",
  blind_spot_detection: "blind spot detection totwinkel",
  cabin_storage: "cabin storage",
  heat_pump: "heat pump warmepumpe",
  heated_seats: "heated seats sitzheizung",
  lane_keeping_assist: "lane keeping assist spurhalteassistent",
  large_trunk: "large trunk cargo kofferraum",
  premium_audio: "premium audio sound",
  reliable_connectivity: "reliable connectivity ota bluetooth wifi",
  voice_assistant: "voice assistant sprachsteuerung",
  wireless_charging: "wireless charging"
};

export async function retrieveRagContext(
  message: string,
  criteria: UserCriteria,
  vehicles: Vehicle[]
): Promise<RagContext> {
  const query = buildQuery(message, criteria);
  const queryEmbedding = await createQueryEmbedding(query);
  const [documents, chunks, embeddedChunks] = await Promise.all([
    listKnowledgeDocuments(),
    listKnowledgeChunks(),
    queryEmbedding ? matchKnowledgeChunksByEmbedding(queryEmbedding, 8) : Promise.resolve([])
  ]);
  const chunkDocuments = mergeKnowledgeDocuments([...embeddedChunks, ...chunks]);
  const mergedDocuments = chunkDocuments.length ? chunkDocuments : mergeKnowledgeDocuments(documents);

  return buildRagContext({
    message,
    criteria,
    vehicles,
    documents: mergedDocuments
  });
}

export function buildRagContext({
  message,
  criteria,
  vehicles,
  documents,
  documentLimit = 6,
  vehicleLimit = 30
}: BuildRagContextInput): RagContext {
  const query = buildQuery(message, criteria);
  const queryTokens = tokenizeSearchText(query);
  const documentEvidence = rankDocuments(documents, query, queryTokens, criteria, documentLimit);
  const topicAffinity = computeTopicAffinity(
    documentEvidence.map((document) => ({
      topic: document.topic,
      score: document.score,
      similarity: documents.find((item) => item.id === document.sourceId)?.similarity
    }))
  );
  const vehicleRanks = rankVehicles(vehicles, criteria, query, queryTokens).slice(0, vehicleLimit);
  const maxVehicleScore = vehicleRanks[0]?.rawScore ?? 1;
  const vehicleEvidence: Record<string, RagEvidence[]> = {};
  const vehicleScores: Record<string, number> = {};

  for (const rank of vehicleRanks) {
    const keywordScore = normalizeScore(rank.rawScore, maxVehicleScore);
    vehicleScores[rank.vehicle.id] = keywordScore;
    vehicleEvidence[rank.vehicle.id] = [
      {
        sourceType: "vehicle_payload",
        sourceId: rank.vehicle.id,
        title: vehicleTitle(rank.vehicle),
        excerpt: vehicleExcerpt(rank.vehicle),
        score: keywordScore
      }
    ];
  }

  return {
    query,
    documents: documentEvidence,
    vehicleEvidence,
    vehicleScores,
    topicAffinity
  };
}

export function getRagEvidenceForVehicle(
  vehicle: Vehicle,
  ragContext: RagContext | undefined,
  documentLimit = 3
) {
  if (!ragContext) return [];
  return [
    ...(ragContext.vehicleEvidence[vehicle.id] ?? []),
    ...selectDiverseDocuments(ragContext.documents, documentLimit)
  ];
}

function selectDiverseDocuments(documents: RagEvidence[], limit: number) {
  const selected: RagEvidence[] = [];
  const seenTopics = new Set<string>();

  for (const document of documents) {
    const topic = document.topic ?? "unknown";
    if (seenTopics.has(topic)) continue;
    selected.push(document);
    seenTopics.add(topic);
    if (selected.length >= limit) return selected;
  }

  for (const document of documents) {
    if (selected.some((item) => item.sourceId === document.sourceId)) continue;
    selected.push(document);
    if (selected.length >= limit) break;
  }

  return selected;
}

function rankDocuments(
  documents: KnowledgeDocument[],
  query: string,
  queryTokens: string[],
  criteria: UserCriteria,
  limit: number
): RagEvidence[] {
  const ranked = documents
    .map((document) => ({
      document,
      cleanContent: cleanKnowledgeContent(document.content),
      rawScore:
        scoreText(queryTokens, `${document.source} ${document.heading} ${cleanKnowledgeContent(document.content)}`) +
        (document.similarity ?? 0) * 4 +
        scoreDocumentTopicFit(document.topic ?? inferTopic(document.source, document.heading, document.content), query, criteria)
    }))
    .filter((rank) => rank.rawScore > 0 && rank.cleanContent.length >= 40)
    .sort((left, right) => right.rawScore - left.rawScore);

  const maxScore = ranked[0]?.rawScore ?? 1;
  const evidence: RagEvidence[] = [];
  const seen = new Set<string>();

  for (const { document, cleanContent, rawScore } of ranked) {
    const signature = normalizeSearchText(`${document.heading} ${cleanContent.slice(0, 360)}`);
    if (seen.has(signature)) continue;
    seen.add(signature);
    evidence.push({
      sourceType: isKnowledgeChunkDocument(document) ? "knowledge_chunk" : "knowledge_document",
      sourceId: document.id,
      title: `${document.heading} (${document.source})`,
      sourceUrl: document.sourceUrl,
      excerpt: truncate(cleanContent, 420),
      score: normalizeScore(rawScore, maxScore),
      topic: document.topic ?? inferTopic(document.source, document.heading, document.content)
    });
    if (evidence.length >= limit) break;
  }

  return evidence;
}

function mergeKnowledgeDocuments(documents: KnowledgeDocument[]) {
  const byId = new Map<string, KnowledgeDocument>();
  for (const document of documents) {
    if (!byId.has(document.id)) byId.set(document.id, document);
  }
  return [...byId.values()];
}

function rankVehicles(
  vehicles: Vehicle[],
  criteria: UserCriteria,
  query: string,
  queryTokens: string[]
) {
  const normalizedQuery = normalizeSearchText(query);

  return vehicles
    .map((vehicle) => ({
      vehicle,
      rawScore:
        scoreText(queryTokens, vehicleSearchText(vehicle)) +
        scoreCriteriaSignals(vehicle, criteria) +
        scoreVehiclePhrases(vehicle, normalizedQuery)
    }))
    .filter((rank) => rank.rawScore > 0)
    .sort((left, right) => right.rawScore - left.rawScore);
}

function scoreCriteriaSignals(vehicle: Vehicle, criteria: UserCriteria) {
  let score = 0;
  if (criteria.bodyTypes.includes(vehicle.bodyType)) score += 2;
  if (criteria.preferredCondition !== "any" && criteria.preferredCondition === vehicle.condition) {
    score += 1.5;
  }
  if (criteria.brandPreferences.some((brand) => sameBrand(brand, vehicle.make))) score += 3;
  if (criteria.brandPreferences.some((brand) => vehicleMatchesBrandPreference(vehicle, brand))) score += 3;
  if (vehicleMatchesBrandOriginPreferences(vehicle, criteria.preferredBrandOrigins)) {
    score += criteria.preferredBrandOrigins.length ? 2.5 : 0;
  }
  if (criteria.modelPreferences.length && vehicleMatchesModelPreferences(vehicle, criteria.modelPreferences)) {
    score += 4;
  }
  if (criteria.location && vehicle.location?.toLowerCase().includes(criteria.location.toLowerCase())) {
    score += 1.5;
  }
  if (criteria.budgetMaxEUR && vehicle.priceEUR <= criteria.budgetMaxEUR) score += 1;
  if (criteria.monthlyBudgetEUR && vehicle.monthlyLeaseEUR && vehicle.monthlyLeaseEUR <= criteria.monthlyBudgetEUR) {
    score += 1;
  }
  if (criteria.rangeFloorKm && vehicle.rangeKm >= criteria.rangeFloorKm) score += 1.5;
  if (criteria.chargingAccess === "public" && vehicle.rangeKm >= 420) score += 1;
  if (criteria.chargingAccess === "home" && vehicle.efficiencyKwhPer100Km <= 17) score += 0.6;
  if (criteria.cargoNeeds === "high" && vehicle.cargoLiters >= 500) score += 1.4;
  if (criteria.passengers && vehicle.seats >= criteria.passengers) score += 0.8;

  for (const feature of criteria.mustHaveFeatures) {
    if (vehicle.features.includes(feature)) score += 1.2;
  }

  for (const tripNeed of criteria.tripNeeds) {
    const tagText = vehicle.reviewTags.join(" ").toLowerCase();
    if (tagText.includes(tripNeed.replace("_", " "))) score += 1;
    if (tripNeed === "road_trip" && vehicle.rangeKm >= 500) score += 1;
    if (tripNeed === "family" && vehicle.seats >= 5 && vehicle.cargoLiters >= 440) score += 1;
    if (tripNeed === "city" && ["compact", "hatchback", "sedan"].includes(vehicle.bodyType)) score += 0.8;
    if (tripNeed === "winter" && vehicle.features.includes("awd")) score += 1;
  }

  return score;
}

function scoreVehiclePhrases(vehicle: Vehicle, normalizedQuery: string) {
  let score = 0;
  const make = normalizeSearchText(vehicle.make);
  const model = normalizeSearchText(vehicle.model);
  const title = normalizeSearchText(vehicle.title ?? "");

  if (make && normalizedQuery.includes(make)) score += 2;
  if (model && normalizedQuery.includes(model)) score += 2.4;
  if (make && model && normalizedQuery.includes(`${make} ${model}`)) score += 2;
  if (title && normalizedQuery.includes(title)) score += 1.5;
  return score;
}

function scoreText(queryTokens: string[], candidate: string) {
  const normalizedCandidate = normalizeSearchText(candidate);
  const candidateTokens = new Set(normalizedCandidate.split(" ").filter(Boolean));
  let score = 0;

  for (const token of new Set(queryTokens)) {
    if (candidateTokens.has(token)) {
      score += token.length >= 5 ? 1.15 : 0.75;
    } else if (token.length >= 5 && normalizedCandidate.includes(token)) {
      score += 0.35;
    }
  }

  return score;
}

function scoreDocumentTopicFit(topic: ReturnType<typeof inferTopic>, query: string, criteria: UserCriteria) {
  const normalizedQuery = normalizeSearchText(query);
  let score = 0;

  if (
    topic === "charging_network" &&
    (criteria.chargingAccess === "public" ||
      criteria.chargingAccess === "none" ||
      criteria.qualitativeSignals.includes("public_charging_fit") ||
      /\b(no wallbox|without wallbox|public charging|charging network|ladestellen|ladeinfrastruktur|oeffentlich|offentlich|ohne wallbox)\b/i.test(normalizedQuery))
  ) {
    score += 5.5;
  }

  if (
    topic === "austrian_incentive" &&
    /\b(foerder|forder|bonus|incentive|subsidy|zuschuss|eride|umweltfoerderung|umweltforderung)\b/i.test(normalizedQuery)
  ) {
    score += 2.2;
  }

  if (
    topic === "review" &&
    (criteria.tripNeeds.includes("winter") || /\b(winter|snow|schnee|alpen|ski|autobahn)\b/i.test(normalizedQuery))
  ) {
    score += 1.6;
  }

  if (
    topic === "technical_spec" &&
    (criteria.qualitativeSignals.includes("fast_charging") ||
      /\b(fast charging|schnellladung|dc|ccs|800v|800 volt|reichweite|range)\b/i.test(normalizedQuery))
  ) {
    score += 1.1;
  }

  return score;
}

function buildQuery(message: string, criteria: UserCriteria) {
  return [
    message,
    criteria.rawPrompt,
    criteria.bodyTypes.join(" "),
    criteria.tripNeeds.join(" "),
    criteria.mustHaveFeatures.map((feature) => featureLabels[feature]).join(" "),
    criteria.qualitativeSignals.join(" "),
    criteria.brandPreferences.join(" "),
    criteria.modelPreferences.join(" "),
    criteria.chargingAccess,
    criteria.location,
    criteria.cargoNeeds,
    criteria.preferredCondition,
    criteria.rangeFloorKm ? `${criteria.rangeFloorKm} km range reichweite` : null,
    criteria.mileageMaxKm ? `${criteria.mileageMaxKm} km mileage kilometerstand` : null,
    criteria.mileageTargetKm ? `low mileage wenig kilometer ${criteria.mileageTargetKm} km` : null,
    criteria.batterySoHMin ? `battery health soh batteriegesundheit ${criteria.batterySoHMin}` : null,
    criteria.budgetMaxEUR ? `${criteria.budgetMaxEUR} eur budget` : null,
    criteria.monthlyBudgetEUR ? `${criteria.monthlyBudgetEUR} eur monthly leasing` : null
  ]
    .filter(Boolean)
    .join(" ");
}

function vehicleSearchText(vehicle: Vehicle) {
  return [vehicle.id, vehicle.source, vehicle.provenance, buildVehicleEmbeddingText(vehicle)].filter(Boolean).join(" ");
}

function vehicleExcerpt(vehicle: Vehicle) {
  const facts = [
    `${vehicleTitle(vehicle)}: ${vehicle.year} ${vehicle.condition} ${vehicle.bodyType}`,
    `EUR ${vehicle.priceEUR.toLocaleString("de-AT")}`,
    `${vehicle.rangeKm} km range`,
    `${vehicle.efficiencyKwhPer100Km} kWh/100 km`,
    `${vehicle.cargoLiters} l cargo`,
    vehicle.location ? `location ${vehicle.location}` : null,
    `features ${vehicle.features
      .slice(0, 6)
      .map((feature) => featureLabels[feature]?.split(" ").slice(0, 3).join(" ") ?? feature.replace(/_/g, " "))
      .join(", ")}`,
    vehicle.notes
  ].filter(Boolean);

  return truncate(facts.join(". "), 420);
}

function tokenizeSearchText(value: string) {
  const tokens = normalizeSearchText(value).split(" ").filter(Boolean);
  const expanded = new Set<string>();

  for (const token of tokens) {
    if (token.length <= 1 || stopWords.has(token)) continue;
    expanded.add(token);
    for (const alias of tokenAliases[token] ?? []) {
      if (!stopWords.has(alias)) expanded.add(alias);
    }
  }

  return [...expanded];
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameBrand(input: string, make: string) {
  const normalizedInput = normalizeBrand(input);
  const normalizedMake = normalizeBrand(make);
  return normalizedInput === normalizedMake || normalizedInput.includes(normalizedMake);
}

function normalizeBrand(value: string) {
  return normalizeSearchText(value).replace("mercedes benz", "mercedes").replace("volkswagen", "vw");
}

function normalizeScore(rawScore: number, maxScore: number) {
  if (maxScore <= 0) return 0;
  return Math.round((rawScore / maxScore) * 100) / 100;
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  const trimmed = value.slice(0, maxLength - 3);
  const lastSpace = trimmed.lastIndexOf(" ");
  return `${trimmed.slice(0, lastSpace > 80 ? lastSpace : trimmed.length)}...`;
}

function cleanKnowledgeContent(value: string) {
  const cleaned = value
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[^\s[]+\]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*]\([^)]*$/g, " ")
    .replace(/Zurück zur vorherigen EbeneNavigation schließen/gi, " ")
    .replace(/Navigation schließen/gi, " ")
    .split(/\n+/)
    .map((line) => line.replace(/^#+\s*/, "").replace(/\s+/g, " ").trim())
    .filter((line) => {
      if (!line) return false;
      if (/^(navigation|suche|mitgliedschaft|skip to main content|an official website|play video|playpause|previousnext)$/i.test(line)) {
        return false;
      }
      if (/(übersicht strommarkt|marktteilnehmer|auffangversorgung|grosshandels|großhandels|referenzwert|eigentumsverhältnisse)/i.test(line)) {
        return false;
      }
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned;
}

function isKnowledgeChunkDocument(document: KnowledgeDocument) {
  return "documentId" in document || document.id.startsWith("chunk:") || document.id.includes(":chunk:");
}
