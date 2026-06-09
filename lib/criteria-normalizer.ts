import {
  clarificationQuestion,
  extractCriteria,
  getCriteriaConfidence,
  getMissingCriteria,
  normalizeCriteriaShape
} from "./criteria.ts";
import type {
  BrandOrigin,
  BodyType,
  ChargingAccess,
  Feature,
  Importance,
  QualitativeSignal,
  TripNeed,
  UserCriteria,
  VehicleCondition
} from "./types.ts";

export type CriteriaPatch = Partial<
  Omit<UserCriteria, "language" | "rawPrompt"> & {
    language: UserCriteria["language"];
    remove: string[];
  }
>;

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
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

const normalizerPrompt =
  "You extract EV shopping criteria from German or English chat. Return only JSON with optional criteriaPatch and confidence. Do not choose vehicles. Use null only when the user explicitly clears a criterion. Latest explicit user instruction wins.";

export async function normalizeCriteria({
  message,
  previousCriteria,
  criteriaOverride
}: NormalizeCriteriaInput): Promise<CriteriaNormalization> {
  if (criteriaOverride) {
    return buildNormalization(normalizeCriteriaShape(criteriaOverride), {});
  }

  const fallbackCriteria = extractCriteria(message, previousCriteria ?? undefined);
  const fallbackPatch = diffCriteria(previousCriteria, fallbackCriteria);

  const llmPatch = await generateCriteriaPatch(message, previousCriteria ?? null);
  if (!llmPatch) {
    return buildNormalization(fallbackCriteria, fallbackPatch);
  }

  const criteria = applyCriteriaPatch(previousCriteria ?? fallbackCriteria, llmPatch, message, Boolean(previousCriteria));
  return buildNormalization(criteria, llmPatch);
}

export function applyCriteriaPatch(
  previousCriteria: UserCriteria,
  patch: CriteriaPatch,
  message: string,
  hasPreviousCriteria = true
): UserCriteria {
  const base = normalizeCriteriaShape(previousCriteria);
  const fallback = extractCriteria(message, base);
  const rawPrompt = hasPreviousCriteria
    ? [base.rawPrompt, message.trim()].filter(Boolean).join("\n")
    : message.trim();
  const criteria = normalizeCriteriaShape({
    ...fallback,
    ...cleanPatch(patch),
    rawPrompt
  });

  for (const removal of patch.remove ?? []) {
    if (removal === "budget") {
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

  return criteria;
}

function buildNormalization(criteria: UserCriteria, criteriaPatch: CriteriaPatch): CriteriaNormalization {
  const missingCriteria = getMissingCriteria(criteria);
  return {
    criteria,
    criteriaPatch,
    confidence: getCriteriaConfidence(criteria),
    missingCriteria,
    clarificationQuestion: missingCriteria.includes("budget") ? clarificationQuestion(criteria) : null
  };
}

async function generateCriteriaPatch(
  message: string,
  previousCriteria: UserCriteria | null
): Promise<CriteriaPatch | null> {
  if (process.env.FLOWRYD_DISABLE_LLM === "1") return null;
  if (process.env.GEMINI_API_KEY) return generateGeminiCriteriaPatch(message, previousCriteria);
  if (process.env.OPENAI_API_KEY) return generateOpenAiCriteriaPatch(message, previousCriteria);
  return null;
}

async function generateOpenAiCriteriaPatch(
  message: string,
  previousCriteria: UserCriteria | null
): Promise<CriteriaPatch | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: normalizerPrompt },
          { role: "user", content: JSON.stringify(buildNormalizerInput(message, previousCriteria)) }
        ]
      }),
      signal: AbortSignal.timeout(1600)
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return parseCriteriaPatch(data.choices?.[0]?.message?.content ?? "");
  } catch {
    return null;
  }
}

async function generateGeminiCriteriaPatch(
  message: string,
  previousCriteria: UserCriteria | null
): Promise<CriteriaPatch | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";
  const model = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
  const modelPath = model.startsWith("models/") ? model : `models/${model}`;

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/${modelPath}:generateContent?${new URLSearchParams({ key: apiKey })}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: normalizerPrompt }] },
          contents: [
            {
              role: "user",
              parts: [{ text: JSON.stringify(buildNormalizerInput(message, previousCriteria)) }]
            }
          ],
          generationConfig: {
            temperature: 0,
            response_mime_type: "application/json"
          }
        }),
        signal: AbortSignal.timeout(1800)
      }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as GeminiGenerateContentResponse;
    const content = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
    return parseCriteriaPatch(content ?? "");
  } catch {
    return null;
  }
}

function buildNormalizerInput(message: string, previousCriteria: UserCriteria | null) {
  return {
    message,
    previousCriteria,
    allowedValues: {
      bodyTypes: ["compact", "hatchback", "sedan", "suv", "crossover", "wagon", "van"],
      chargingAccess: ["home", "work", "public", "none", "unknown"],
      condition: ["new", "used", "any"],
      preferredBrandOrigins: ["china", "europe", "other"],
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
  return cleanPatch(parsed.criteriaPatch as CriteriaPatch);
}

function cleanPatch(patch: CriteriaPatch): CriteriaPatch {
  const clean: CriteriaPatch = {};
  if (isLanguage(patch.language)) clean.language = patch.language;
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
  return value === "compact" || value === "hatchback" || value === "sedan" || value === "suv" || value === "crossover" || value === "wagon" || value === "van";
}

function isBrandOrigin(value: unknown): value is BrandOrigin {
  return value === "china" || value === "europe" || value === "other";
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
