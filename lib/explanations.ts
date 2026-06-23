import { generateMatchIntroMessage } from "./assistant-messages.ts";
import { languageLabel, languageReplyInstruction } from "./criteria.ts";
import { createOpenAiChatCompletion, openAiConfigured, openAiModel } from "./openai-provider.ts";
import type { MatchResult, RejectedSummary, UserCriteria } from "./types.ts";

type LlmExplanation = {
  vehicleId: string;
  explanation: string;
};

type LlmSelection = {
  assistantMessage?: string;
  selectedVehicleIds?: string[];
  explanations: LlmExplanation[];
};

export type FinalRecommendationSelection = {
  assistantMessage: string;
  recommendations: MatchResult[];
};

const explanationSystemPrompt =
  "You are FlowRyd, an Austrian EV matching agent. The candidate vehicles are already ranked by match score. " +
  "Write explanations only for the provided vehicleIds, never invent cars, and never override hard filters. " +
  "Follow requiredResponseLanguage and responseLanguageInstruction for every user-facing string. " +
  "Use only provided vehicle facts and retrievedEvidence excerpts, but do not include evidence IDs, citation markers, or context annotations like [E1] or [E2] in assistantMessage or vehicle explanations. " +
  "Do not mention sources that are not provided. " +
  "Write each vehicle explanation like a helpful car salesperson texting a customer: natural, warm, specific, and easy to read. Use 2 to 3 short paragraphs separated by blank lines, no bullets, no headings, and no score-first phrasing. " +
  "Start with the practical fit and include concrete facts such as range, price or lease, body style, seats, cargo, drivetrain, charging/public-charging fit, tech, family or commute suitability, and availability only when those facts are provided. " +
  "Mention limitations or tradeoffs plainly, but keep the overall tone conversational rather than analytical. " +
  "Return JSON: {\"assistantMessage\":\"...\",\"explanations\":[{\"vehicleId\":\"...\",\"explanation\":\"...\"}]}. " +
  "assistantMessage must briefly introduce the ranked listings and, when rejectedSummary is provided, mention the main reasons other vehicles were ruled out. Every provided vehicleId must have a matching explanation entry.";

function llmEnabled() {
  return process.env.FLOWRYD_DISABLE_LLM !== "1" && openAiConfigured();
}

export async function attachExplanations(
  matches: MatchResult[],
  criteria: UserCriteria
): Promise<MatchResult[]> {
  const generated = await generateWithLlm(matches, criteria);
  const byVehicle = await fillMissingExplanations(
    matches,
    criteria,
    new Map(generated.explanations.map((item) => [item.vehicleId, item.explanation]))
  );

  return matches.map((match) => ({
    ...match,
    explanation: byVehicle.get(match.vehicle.id) ?? fallbackExplanation(match, criteria)
  }));
}

export async function selectAndExplainMatches(
  matches: MatchResult[],
  criteria: UserCriteria,
  options: {
    maxRecommendations?: number;
    lowConfidenceQuestion?: string | null;
    rejectedSummary?: RejectedSummary[];
  } = {}
): Promise<FinalRecommendationSelection> {
  const maxRecommendations = options.maxRecommendations ?? 8;
  const selected = matches.slice(0, maxRecommendations);
  const generated = await generateWithLlm(selected.slice(0, 8), criteria, options.rejectedSummary ?? []);
  const byVehicle = await fillMissingExplanations(
    selected,
    criteria,
    new Map(generated.explanations.map((item) => [item.vehicleId, item.explanation])),
    options.rejectedSummary ?? []
  );
  const recommendations = selected.map((match) => ({
    ...match,
    explanation: byVehicle.get(match.vehicle.id) ?? fallbackExplanation(match, criteria)
  }));

  const assistantMessage =
    generated.assistantMessage ??
    (await generateMatchIntroMessage({
      criteria,
      recommendationCount: recommendations.length,
      lowConfidenceQuestion: options.lowConfidenceQuestion,
      rejectedSummary: options.rejectedSummary
    }));

  return {
    assistantMessage,
    recommendations
  };
}

function fallbackExplanation(match: MatchResult, criteria: UserCriteria) {
  const language = criteria.language;
  const vehicleName = `${match.vehicle.make} ${match.vehicle.model}`;
  const range = `${match.vehicle.rangeKm.toLocaleString("de-AT")} km`;
  const price = `${match.vehicle.priceEUR.toLocaleString("de-AT")} EUR`;
  const lease = match.vehicle.monthlyLeaseEUR
    ? language === "de"
      ? `oder Leasing ab ${match.vehicle.monthlyLeaseEUR.toLocaleString("de-AT")} EUR pro Monat`
      : `or lease pricing from ${match.vehicle.monthlyLeaseEUR.toLocaleString("de-AT")} EUR per month`
    : null;
  const featureText = summarizeFeatures(match.vehicle.features, language);
  const bodyType = language === "de" ? translateBodyType(match.vehicle.bodyType) : match.vehicle.bodyType;
  const availability =
    match.vehicle.location && match.vehicle.available
      ? language === "de"
        ? `Das Fahrzeug ist aktuell in ${match.vehicle.location} gelistet.`
        : `It is currently listed in ${match.vehicle.location}.`
      : match.vehicle.available
        ? language === "de"
          ? "Das Fahrzeug ist aktuell verfuegbar."
          : "It is currently available."
        : "";
  const tradeoff = match.ruledOutReasons[0];

  if (language === "de") {
    return [
      `${vehicleName} passt gut zu deinen Angaben: ${range} Reichweite, ${bodyType} mit ${match.vehicle.seats} Sitzen und ${match.vehicle.cargoLiters.toLocaleString("de-AT")} Litern Kofferraum. Der Preis liegt bei ${price}${lease ? ` ${lease}` : ""}, also innerhalb der harten Grenzen, die du genannt hast.`,
      `Es ist ein ${match.vehicle.drivetrain}-E-Auto mit ${match.vehicle.efficiencyKwhPer100Km} kWh/100 km Verbrauch. ${featureText} Damit wirkt es passend fuer Alltag, Pendeln und laengere Fahrten, ohne dass du jede Woche perfekt planen musst.`,
      `${availability}${tradeoff ? ` Der wichtigste Tradeoff: ${tradeoff}.` : ""}`.trim()
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    `${vehicleName} fits your brief well: it gives you ${range} of range, a ${bodyType} body with ${match.vehicle.seats} seats, and ${match.vehicle.cargoLiters.toLocaleString("de-AT")} liters of cargo space. The price is ${price}${lease ? ` ${lease}` : ""}, so it stays inside the hard limits you gave me.`,
    `It is a ${match.vehicle.drivetrain} EV rated at ${match.vehicle.efficiencyKwhPer100Km} kWh/100 km. ${featureText} That makes it a practical fit for daily driving, family use, and longer trips without needing to over-plan every charge.`,
    `${availability}${tradeoff ? ` The main tradeoff is: ${tradeoff}.` : ""}`.trim()
  ]
    .filter(Boolean)
    .join("\n\n");
}

function summarizeFeatures(features: MatchResult["vehicle"]["features"], language: UserCriteria["language"]) {
  const labels: Record<MatchResult["vehicle"]["features"][number], { de: string; en: string }> = {
    apple_carplay: { de: "Apple CarPlay", en: "Apple CarPlay" },
    android_auto: { de: "Android Auto", en: "Android Auto" },
    blind_spot_detection: { de: "Totwinkelassistent", en: "blind spot detection" },
    adaptive_cruise_control: { de: "adaptiver Tempomat", en: "adaptive cruise control" },
    lane_keeping_assist: { de: "Spurhalteassistent", en: "lane keeping assist" },
    wireless_charging: { de: "kabelloses Laden", en: "wireless charging" },
    reliable_connectivity: { de: "zuverlaessige Konnektivitaet", en: "reliable connectivity" },
    voice_assistant: { de: "Sprachassistent", en: "voice assistant" },
    cabin_storage: { de: "gute Ablagen", en: "good cabin storage" },
    heated_seats: { de: "Sitzheizung", en: "heated seats" },
    large_trunk: { de: "grosser Kofferraum", en: "large trunk" },
    premium_audio: { de: "Premium-Audio", en: "premium audio" },
    heat_pump: { de: "Waermepumpe", en: "heat pump" },
    awd: { de: "Allradantrieb", en: "all-wheel drive" }
  };
  const highlighted = features
    .filter((feature) =>
      [
        "awd",
        "heat_pump",
        "adaptive_cruise_control",
        "lane_keeping_assist",
        "blind_spot_detection",
        "apple_carplay",
        "heated_seats",
        "large_trunk",
        "wireless_charging"
      ].includes(feature)
    )
    .slice(0, 4)
    .map((feature) => labels[feature][language]);

  if (!highlighted.length) {
    return language === "de"
      ? "Die Ausstattung ist solide fuer den Alltag."
      : "The equipment is solid for everyday use.";
  }

  return language === "de"
    ? `Zur Ausstattung gehoeren ${formatNaturalList(highlighted, "de")}.`
    : `Equipment includes ${formatNaturalList(highlighted, "en")}.`;
}

function formatNaturalList(values: string[], language: UserCriteria["language"]) {
  if (values.length <= 1) return values[0] ?? "";
  const connector = language === "de" ? " und " : " and ";
  return `${values.slice(0, -1).join(", ")}${connector}${values.at(-1)}`;
}

function translateBodyType(bodyType: MatchResult["vehicle"]["bodyType"]) {
  const labels: Record<MatchResult["vehicle"]["bodyType"], string> = {
    compact: "Kompaktwagen",
    hatchback: "Schraegheck",
    sedan: "Limousine",
    suv: "SUV",
    crossover: "Crossover",
    wagon: "Kombi",
    van: "Van",
    other: "Sonstige",
    minibus: "Minibus"
  };
  return labels[bodyType];
}

async function generateWithLlm(
  matches: MatchResult[],
  criteria: UserCriteria,
  rejectedSummary: RejectedSummary[] = []
): Promise<LlmSelection> {
  if (!llmEnabled()) return { explanations: [] };

  const first = await generateWithLlmOnce(matches, criteria, rejectedSummary);
  if (hasUsableLlmSelection(first)) return first;

  const retry = await generateWithLlmOnce(matches, criteria, rejectedSummary);
  return hasUsableLlmSelection(retry) ? retry : first.explanations.length ? first : retry;
}

function hasUsableLlmSelection(selection: LlmSelection) {
  return selection.explanations.length > 0 || Boolean(selection.assistantMessage);
}

async function fillMissingExplanations(
  matches: MatchResult[],
  criteria: UserCriteria,
  byVehicle: Map<string, string>,
  rejectedSummary: RejectedSummary[] = []
) {
  const missing = matches.filter((match) => !byVehicle.has(match.vehicle.id));
  if (!missing.length || !llmEnabled()) return byVehicle;

  const retry = await generateWithLlm(missing.slice(0, 5), criteria, rejectedSummary);
  for (const item of retry.explanations) {
    byVehicle.set(item.vehicleId, item.explanation);
  }

  return byVehicle;
}

async function generateWithLlmOnce(
  matches: MatchResult[],
  criteria: UserCriteria,
  rejectedSummary: RejectedSummary[] = []
): Promise<LlmSelection> {
  return generateWithOpenAi(matches, criteria, rejectedSummary);
}

async function generateWithOpenAi(
  matches: MatchResult[],
  criteria: UserCriteria,
  rejectedSummary: RejectedSummary[] = []
): Promise<LlmSelection> {
  if (!openAiConfigured()) return { explanations: [] };

  try {
    const response = await createOpenAiChatCompletion(
      "match-explanation",
      {
        model: openAiModel(),
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: explanationSystemPrompt
          },
          {
            role: "user",
            content: JSON.stringify(buildExplanationInput(matches, criteria, rejectedSummary))
          }
        ]
      },
      { timeout: 4000 }
    );
    const content = response.choices[0]?.message?.content;
    if (!content) return { explanations: [] };
    return parseLlmSelectionJson(content);
  } catch {
    return { explanations: [] };
  }
}

export function buildExplanationInput(
  matches: MatchResult[],
  criteria: UserCriteria,
  rejectedSummary: RejectedSummary[] = []
) {
  return {
    language: criteria.language,
    requiredResponseLanguage: languageLabel(criteria.language),
    responseLanguageInstruction: languageReplyInstruction(criteria.language),
    criteria,
    rejectedSummary,
    matches: matches.slice(0, 5).map((match) => ({
      vehicleId: match.vehicle.id,
      vehicle: {
        make: match.vehicle.make,
        model: match.vehicle.model,
        trim: match.vehicle.trim,
        year: match.vehicle.year,
        condition: match.vehicle.condition,
        bodyType: match.vehicle.bodyType,
        priceEUR: match.vehicle.priceEUR,
        monthlyLeaseEUR: match.vehicle.monthlyLeaseEUR,
        rangeKm: match.vehicle.rangeKm,
        efficiencyKwhPer100Km: match.vehicle.efficiencyKwhPer100Km,
        batteryKwh: match.vehicle.batteryKwh,
        batterySoH: match.vehicle.batterySoH,
        drivetrain: match.vehicle.drivetrain,
        seats: match.vehicle.seats,
        cargoLiters: match.vehicle.cargoLiters,
        features: match.vehicle.features,
        warranty: match.vehicle.warranty,
        location: match.vehicle.location,
        available: match.vehicle.available,
        notes: match.vehicle.notes
      },
      score: match.score,
      ragScore: match.ragScore,
      scoringBreakdown: match.scoringBreakdown,
      tradeoffs: match.ruledOutReasons,
      retrievedEvidence: match.ragEvidence.map((evidence, evidenceIndex) => ({
        evidenceId: `E${evidenceIndex + 1}`,
        sourceType: evidence.sourceType,
        sourceId: evidence.sourceId,
        title: evidence.title,
        sourceUrl: evidence.sourceUrl,
        topic: evidence.topic,
        excerpt: evidence.excerpt,
        score: evidence.score
      }))
    }))
  };
}

export function parseLlmExplanationJson(content: string): LlmExplanation[] {
  return parseLlmSelectionJson(content).explanations;
}

export function parseLlmSelectionJson(content: string): LlmSelection {
  const parsed = JSON.parse(stripJsonFence(content)) as {
    assistantMessage?: unknown;
    selectedVehicleIds?: unknown;
    explanations?: unknown;
  };
  const selection: LlmSelection = {
    explanations: []
  };
  if (typeof parsed.assistantMessage === "string") selection.assistantMessage = parsed.assistantMessage;
  if (Array.isArray(parsed.selectedVehicleIds)) {
    selection.selectedVehicleIds = parsed.selectedVehicleIds.filter(
      (value): value is string => typeof value === "string"
    );
  }
  if (!Array.isArray(parsed.explanations)) return selection;

  selection.explanations = parsed.explanations.filter(isLlmExplanation);
  return selection;
}

function stripJsonFence(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1] ?? trimmed;
}

function isLlmExplanation(value: unknown): value is LlmExplanation {
  if (!value || typeof value !== "object") return false;
  const explanation = value as Partial<LlmExplanation>;
  return typeof explanation.vehicleId === "string" && typeof explanation.explanation === "string";
}

