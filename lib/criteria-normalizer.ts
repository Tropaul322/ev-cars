import { generateClarificationMessage } from "./assistant-messages.ts";
import {
  detectLanguage,
  extractCriteria,
  getCriteriaConfidence,
  getMissingCriteria,
  hasReplaceIntent,
  normalizeCriteriaShape
} from "./criteria.ts";
import { buildLlmMessages, type LlmConversationTurn } from "./llm-conversation.ts";
import { createOpenAiChatCompletion, openAiChatTimeout, openAiConfigured, openAiModel } from "./openai-provider.ts";
import type {
  BrandOrigin,
  BodyType,
  ChargingAccess,
  CriteriaPatch,
  Feature,
  Importance,
  QualitativeSignal,
  TripNeed,
  UserCriteria,
  VehicleCondition
} from "./types.ts";

export type { CriteriaPatch } from "./types.ts";

const allowedBodyTypes = [
  "compact",
  "hatchback",
  "sedan",
  "suv",
  "crossover",
  "wagon",
  "van",
  "other",
  "minibus"
] satisfies BodyType[];

const allowedBrandOrigins = ["china", "europe", "korea", "us", "other"] satisfies BrandOrigin[];

export type CriteriaNormalization = {
  criteria: UserCriteria;
  criteriaPatch: CriteriaPatch;
  confidence: number;
  missingCriteria: ReturnType<typeof getMissingCriteria>;
  clarificationQuestion: string | null;
};

type NormalizeCriteriaInput = {
  message: string;
  previousCriteria?: UserCriteria | null;
  criteriaOverride?: UserCriteria | null;
  conversationHistory?: LlmConversationTurn[];
};

const normalizerPrompt = `You extract and UPDATE EV shopping criteria from German or English chat.

Input: prior conversation turns (when provided), the user's latest message, and optional previousCriteria from earlier turns.
Output: ONLY valid JSON in this shape:
{
  "criteriaPatch": { ...fields changed in this turn... },
  "confidence": 0.0-1.0
}

Core rules:
1. Change ONLY what the latest message implies. Do not recommend vehicles.
2. The latest explicit user instruction always wins over previousCriteria.
3. Use null on a scalar field only when the user explicitly clears it.
4. Set criteriaPatch.language to the current message language (de or en).
5. Fix obvious brand/model typos to canonical names (Testla/Tesls -> Tesla).

Modification modes:
- ADD (default): append to list fields or update scalars without dropping unrelated prior values.
  "also Kia" with previous brandPreferences ["Tesla"] -> ["Tesla", "Kia"]
- REPLACE: when the user says only/just/nur/ausschließlich/leave only, return the FULL new list for that field.
  "leave only Ford cars" with previous brandPreferences ["Tesla"] -> brandPreferences ["Ford"]
  "nur SUV" with previous bodyTypes ["sedan"] -> bodyTypes ["suv"]
  When replacing brandPreferences without naming a model, clear modelPreferences too.
- REMOVE: when the user says remove/clear/forget/ignore/egal/entferne/lösche/vergiss for a field, use criteriaPatch.remove.
  Allowed remove keys: budget, range, mileage, battery, condition, body, use_case, charging, features, brand, origin, model
  "forget the budget" -> { "remove": ["budget"] }

List fields where replace vs merge matters:
brandPreferences, modelPreferences, bodyTypes, tripNeeds, mustHaveFeatures, qualitativeSignals, preferredBrandOrigins, avoidedBrands

Scalar fields:
budgetMinEUR, budgetMaxEUR, monthlyBudgetEUR, dailyKm, rangeFloorKm, mileageMaxKm, mileageTargetKm, batterySoHMin, batteryHealthRequired, chargingAccess, preferredCondition, passengers, cargoNeeds, location, brandFit, reliabilityImportance

Confidence guide: 0.9+ for specific constraints, 0.5-0.7 when budget/use case/charging is still missing.`;

export async function normalizeCriteria({
  message,
  previousCriteria,
  criteriaOverride,
  conversationHistory = []
}: NormalizeCriteriaInput): Promise<CriteriaNormalization> {
  if (criteriaOverride) {
    return await buildNormalization(message, normalizeCriteriaShape(criteriaOverride), {}, conversationHistory);
  }

  const fallbackCriteria = extractCriteria(message, previousCriteria ?? undefined);
  const fallbackPatch = diffCriteria(previousCriteria, fallbackCriteria);

  const llmPatch = await generateCriteriaPatch(message, previousCriteria ?? null, conversationHistory);
  if (!llmPatch) {
    return await buildNormalization(message, fallbackCriteria, fallbackPatch, conversationHistory);
  }

  const criteria = applyCriteriaPatch(previousCriteria ?? fallbackCriteria, llmPatch, message, Boolean(previousCriteria));
  return await buildNormalization(message, criteria, llmPatch, conversationHistory);
}

export function applyCriteriaPatch(
  previousCriteria: UserCriteria,
  patch: CriteriaPatch,
  message: string,
  hasPreviousCriteria = true
): UserCriteria {
  const base = normalizeCriteriaShape(previousCriteria);
  const messageLanguage = detectLanguage(message, base.language);
  const fallback = extractCriteria(message, base);
  const rawPrompt = hasPreviousCriteria
    ? [base.rawPrompt, message.trim()].filter(Boolean).join("\n")
    : message.trim();
  const criteria = normalizeCriteriaShape({
    ...fallback,
    ...cleanPatch(patch),
    language: messageLanguage,
    rawPrompt
  });
  const deterministic = extractCriteria(message, base);
  const replaceIntent = hasReplaceIntent(message);
  if (deterministic.modelPreferences.length && !replaceIntent) {
    criteria.modelPreferences = mergeUnique(criteria.modelPreferences, deterministic.modelPreferences);
  }
  if (deterministic.brandPreferences.length && !replaceIntent) {
    criteria.brandPreferences = mergeUnique(criteria.brandPreferences, deterministic.brandPreferences);
  }

  for (const removal of patch.remove ?? []) {
    applyRemoval(criteria, removal);
  }

  return criteria;
}

const patchListFields = [
  "brandPreferences",
  "modelPreferences",
  "bodyTypes",
  "tripNeeds",
  "mustHaveFeatures",
  "qualitativeSignals",
  "preferredBrandOrigins",
  "avoidedBrands"
] as const;

/**
 * Applies a structured patch from a tapped clarification chip. Unlike
 * applyCriteriaPatch, this never re-parses the message text, so chip labels
 * (e.g. "€40,000–60,000") cannot accidentally extract stray criteria. List
 * fields merge, scalar fields replace, and explicit removals are honored.
 */
export function applyChipPatch(base: UserCriteria, patch: CriteriaPatch): UserCriteria {
  const start = normalizeCriteriaShape(base);
  const clean = cleanPatch(patch);
  const next = normalizeCriteriaShape({ ...start });

  for (const [key, value] of Object.entries(clean) as Array<[keyof CriteriaPatch, unknown]>) {
    if (key === "remove" || key === "language") continue;
    if ((patchListFields as readonly string[]).includes(key as string) && Array.isArray(value)) {
      const existing = (start as Record<string, unknown>)[key as string] as unknown[] | undefined;
      (next as Record<string, unknown>)[key as string] = mergeUnique(existing ?? [], value);
    } else {
      (next as Record<string, unknown>)[key as string] = value;
    }
  }

  if (clean.language) next.language = clean.language;
  for (const removal of clean.remove ?? []) {
    applyRemoval(next, removal);
  }

  return normalizeCriteriaShape(next);
}

function applyRemoval(criteria: UserCriteria, removal: string) {
  if (removal === "budget") {
    criteria.budgetMinEUR = null;
    criteria.budgetMaxEUR = null;
    criteria.monthlyBudgetEUR = null;
  }
  if (removal === "range") criteria.rangeFloorKm = null;
  if (removal === "mileage") {
    criteria.mileageMaxKm = null;
    criteria.mileageTargetKm = null;
  }
  if (removal === "battery") {
    criteria.batterySoHMin = null;
    criteria.batteryHealthRequired = false;
  }
  if (removal === "condition") criteria.preferredCondition = "any";
  if (removal === "body") criteria.bodyTypes = [];
  if (removal === "use_case") criteria.tripNeeds = [];
  if (removal === "charging") criteria.chargingAccess = "unknown";
  if (removal === "features") criteria.mustHaveFeatures = [];
  if (removal === "brand") {
    criteria.brandPreferences = [];
    criteria.avoidedBrands = [];
  }
  if (removal === "origin") criteria.preferredBrandOrigins = [];
  if (removal === "model") criteria.modelPreferences = [];
}

function mergeUnique<T>(left: T[], right: T[]) {
  return Array.from(new Set([...left, ...right]));
}

async function buildNormalization(
  message: string,
  criteria: UserCriteria,
  criteriaPatch: CriteriaPatch,
  conversationHistory: LlmConversationTurn[] = []
): Promise<CriteriaNormalization> {
  const missingCriteria = getMissingCriteria(criteria);
  const clarificationQuestion = missingCriteria.length
    ? await generateClarificationMessage({ message, criteria, missingCriteria, conversationHistory })
    : null;
  return {
    criteria,
    criteriaPatch,
    confidence: getCriteriaConfidence(criteria),
    missingCriteria,
    clarificationQuestion
  };
}

async function generateCriteriaPatch(
  message: string,
  previousCriteria: UserCriteria | null,
  conversationHistory: LlmConversationTurn[] = []
): Promise<CriteriaPatch | null> {
  if (process.env.FLOWRYD_DISABLE_LLM === "1") return null;
  if (openAiConfigured()) return generateOpenAiCriteriaPatch(message, previousCriteria, conversationHistory);
  return null;
}

async function generateOpenAiCriteriaPatch(
  message: string,
  previousCriteria: UserCriteria | null,
  conversationHistory: LlmConversationTurn[] = []
): Promise<CriteriaPatch | null> {
  if (!openAiConfigured()) return null;

  try {
    const response = await createOpenAiChatCompletion(
      "criteria-normalizer",
      {
        model: openAiModel(),
        temperature: 0,
        response_format: { type: "json_object" },
        messages: buildLlmMessages(
          normalizerPrompt,
          conversationHistory,
          JSON.stringify(buildNormalizerInput(message, previousCriteria))
        )
      },
      { timeout: openAiChatTimeout("criteria-normalizer") }
    );
    return parseCriteriaPatch(response.choices[0]?.message?.content ?? "");
  } catch {
    return null;
  }
}

function buildNormalizerInput(message: string, previousCriteria: UserCriteria | null) {
  const detectedLanguage = detectLanguage(message, previousCriteria?.language ?? "en");
  return {
    message,
    detectedLanguage,
    responseLanguageInstruction: `Set criteriaPatch.language to "${detectedLanguage}" when the user's current message is clearly ${detectedLanguage === "de" ? "German" : "English"}.`,
    previousCriteria,
    modificationExamples: [
      {
        previous: { brandPreferences: ["Tesla"] },
        message: "Leave only Ford cars",
        criteriaPatch: { brandPreferences: ["Ford"], modelPreferences: [] }
      },
      {
        previous: { budgetMaxEUR: 35000, tripNeeds: ["city"] },
        message: "make it under 18k and only SUVs",
        criteriaPatch: { budgetMaxEUR: 18000, bodyTypes: ["suv"] }
      },
      {
        previous: { budgetMaxEUR: 35000 },
        message: "forget the budget, I just want a Tesla Model Y",
        criteriaPatch: { remove: ["budget"], brandPreferences: ["Tesla"], modelPreferences: ["Model Y"] }
      }
    ],
    allowedValues: {
      bodyTypes: allowedBodyTypes,
      chargingAccess: ["home", "work", "public", "none", "unknown"],
      condition: ["new", "used", "any"],
      preferredBrandOrigins: allowedBrandOrigins,
      modelPreferences: [
        "EV6",
        "EV3",
        "Model 3",
        "Model Y",
        "ID.3",
        "ID.4",
        "Ioniq 5",
        "Q4 e-tron",
        "Polestar 2",
        "Enyaq",
        "EX30",
        "Atto 3",
        "MG4"
      ],
      tripNeeds: ["city", "commute", "road_trip", "family", "winter"],
      qualitativeSignals: [
        "premium",
        "low_mileage",
        "good_battery_health",
        "reliable",
        "road_trip_comfort",
        "fast_charging",
        "good_value",
        "safety",
        "technology",
        "public_charging_fit"
      ]
    }
  };
}

export function parseCriteriaPatch(content: string): CriteriaPatch | null {
  if (!content.trim()) return null;
  const parsed = JSON.parse(stripJsonFence(content)) as { criteriaPatch?: unknown; confidence?: unknown };
  if (!parsed.criteriaPatch || typeof parsed.criteriaPatch !== "object") return null;
  return sanitizeCriteriaPatch(parsed.criteriaPatch as CriteriaPatch);
}

export function sanitizeCriteriaPatch(patch: CriteriaPatch): CriteriaPatch {
  return cleanPatch(patch);
}

function cleanPatch(patch: CriteriaPatch): CriteriaPatch {
  const clean: CriteriaPatch = {};
  if (isLanguage(patch.language)) clean.language = patch.language;
  if (numberOrNull(patch.budgetMinEUR)) clean.budgetMinEUR = patch.budgetMinEUR;
  if (numberOrNull(patch.budgetMaxEUR)) clean.budgetMaxEUR = patch.budgetMaxEUR;
  if (numberOrNull(patch.monthlyBudgetEUR)) clean.monthlyBudgetEUR = patch.monthlyBudgetEUR;
  if (numberOrNull(patch.dailyKm)) clean.dailyKm = patch.dailyKm;
  if (numberOrNull(patch.rangeFloorKm)) clean.rangeFloorKm = patch.rangeFloorKm;
  if (numberOrNull(patch.mileageMaxKm)) clean.mileageMaxKm = patch.mileageMaxKm;
  if (numberOrNull(patch.mileageTargetKm)) clean.mileageTargetKm = patch.mileageTargetKm;
  if (numberOrNull(patch.batterySoHMin)) clean.batterySoHMin = patch.batterySoHMin;
  if (typeof patch.batteryHealthRequired === "boolean") {
    clean.batteryHealthRequired = patch.batteryHealthRequired;
  }
  if (isChargingAccess(patch.chargingAccess)) clean.chargingAccess = patch.chargingAccess;
  if (typeof patch.passengers === "number" || patch.passengers === null) clean.passengers = patch.passengers;
  if (patch.cargoNeeds === "low" || patch.cargoNeeds === "medium" || patch.cargoNeeds === "high" || patch.cargoNeeds === null) {
    clean.cargoNeeds = patch.cargoNeeds;
  }
  if (isCondition(patch.preferredCondition)) clean.preferredCondition = patch.preferredCondition;
  if (Array.isArray(patch.bodyTypes)) clean.bodyTypes = patch.bodyTypes.filter(isBodyType);
  if (Array.isArray(patch.tripNeeds)) clean.tripNeeds = patch.tripNeeds.filter(isTripNeed);
  if (Array.isArray(patch.brandPreferences)) {
    clean.brandPreferences = patch.brandPreferences.filter((value): value is string => typeof value === "string");
  }
  if (Array.isArray(patch.preferredBrandOrigins)) {
    clean.preferredBrandOrigins = patch.preferredBrandOrigins.filter(isBrandOrigin);
  }
  if (Array.isArray(patch.modelPreferences)) {
    clean.modelPreferences = patch.modelPreferences.filter((value): value is string => typeof value === "string");
  }
  if (Array.isArray(patch.avoidedBrands)) {
    clean.avoidedBrands = patch.avoidedBrands.filter((value): value is string => typeof value === "string");
  }
  if (isImportance(patch.brandFit)) clean.brandFit = patch.brandFit;
  if (isImportance(patch.reliabilityImportance)) clean.reliabilityImportance = patch.reliabilityImportance;
  if (Array.isArray(patch.mustHaveFeatures)) clean.mustHaveFeatures = patch.mustHaveFeatures.filter(isFeature);
  if (Array.isArray(patch.qualitativeSignals)) {
    clean.qualitativeSignals = patch.qualitativeSignals.filter(isQualitativeSignal);
  }
  if (typeof patch.location === "string" || patch.location === null) clean.location = patch.location;
  if (Array.isArray(patch.remove)) {
    clean.remove = patch.remove.filter((value): value is string => typeof value === "string");
  }
  return clean;
}

function diffCriteria(previous: UserCriteria | null | undefined, next: UserCriteria): CriteriaPatch {
  if (!previous) return cleanPatch(next);
  const patch: CriteriaPatch = {};
  for (const key of Object.keys(next) as Array<keyof UserCriteria>) {
    if (key === "rawPrompt") continue;
    if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
      (patch as Record<string, unknown>)[key] = next[key];
    }
  }
  return patch;
}

function stripJsonFence(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1] ?? trimmed;
}

function numberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isLanguage(value: unknown): value is UserCriteria["language"] {
  return value === "de" || value === "en";
}

function isImportance(value: unknown): value is Importance {
  return value === "low" || value === "medium" || value === "high";
}

function isChargingAccess(value: unknown): value is ChargingAccess {
  return value === "home" || value === "work" || value === "public" || value === "none" || value === "unknown";
}

function isCondition(value: unknown): value is VehicleCondition | "any" {
  return value === "new" || value === "used" || value === "any";
}

function isBodyType(value: unknown): value is BodyType {
  return typeof value === "string" && (allowedBodyTypes as string[]).includes(value);
}

function isBrandOrigin(value: unknown): value is BrandOrigin {
  return typeof value === "string" && (allowedBrandOrigins as string[]).includes(value);
}

function isTripNeed(value: unknown): value is TripNeed {
  return value === "city" || value === "commute" || value === "road_trip" || value === "family" || value === "winter";
}

function isFeature(value: unknown): value is Feature {
  return (
    value === "apple_carplay" ||
    value === "android_auto" ||
    value === "blind_spot_detection" ||
    value === "adaptive_cruise_control" ||
    value === "lane_keeping_assist" ||
    value === "wireless_charging" ||
    value === "reliable_connectivity" ||
    value === "voice_assistant" ||
    value === "cabin_storage" ||
    value === "heated_seats" ||
    value === "large_trunk" ||
    value === "premium_audio" ||
    value === "heat_pump" ||
    value === "awd"
  );
}

function isQualitativeSignal(value: unknown): value is QualitativeSignal {
  return (
    value === "premium" ||
    value === "low_mileage" ||
    value === "good_battery_health" ||
    value === "reliable" ||
    value === "road_trip_comfort" ||
    value === "fast_charging" ||
    value === "good_value" ||
    value === "safety" ||
    value === "technology" ||
    value === "public_charging_fit"
  );
}
