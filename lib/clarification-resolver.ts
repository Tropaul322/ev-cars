import { getClarificationPrompt, getOptimizationPrompt } from "./clarification-catalog.ts";
import { DEFAULT_BUDGET_MAX_EUR, DEFAULT_BUDGET_MIN_EUR, extractCriteria, looksLikeNoBudgetLimit } from "./criteria.ts";
import type { ClarificationOption, ClarificationPromptKey, CriteriaPatch, Language } from "./types.ts";

export type ClarificationResolution =
  | { kind: "patch"; patch: CriteriaPatch }
  | { kind: "skip" };

const skipAnswerPattern =
  /\b(no preference|no pref|don't care|doesn'?t matter|not sure(?: yet)?|no idea|don'?t know|skip|whatever|anything|any style|any body|open to anything|no budget limit|no limit|egal|keine präferenz|keine ahnung|weiß nicht|weiss nicht|unklar|passt schon|ist mir egal)\b/i;

const optionSynonyms: Record<string, RegExp[]> = {
  budget_under_25k: [
    /\b(under|below|max|up to|bis|unter|weniger als)\b[^.]{0,24}\b(25\s*k|25\.?000|25000)\b/i,
    /\b(25\s*k|25\.?000|25000)\b[^.]{0,24}\b(budget|max|limit|euro|eur|€)\b/i
  ],
  budget_25_40k: [/\b(25|30|35|40)\s*k\b/i, /\b(25|30|35|40)[.,]000\b/i],
  budget_40_60k: [/\b(40|45|50|55|60)\s*k\b/i, /\b(40|45|50|55|60)[.,]000\b/i],
  budget_over_60k: [/\b(over|above|more than|über|ueber|mehr als)\b[^.]{0,20}\b(60|70|80|90)\s*k\b/i],
  budget_skip: [/\b(no budget|no limit|unlimited budget|kein budget|kein limit)\b/i],
  opt_best_value: [/\b(best value|value for money|preis[-\s]?leistung|preiswert)\b/i],
  opt_max_range: [/\b(max(?:imum)? range|longest range|maximale reichweite|größte reichweite|groesste reichweite)\b/i],
  opt_reliable: [/\b(reliable|reliability|zuverlässig|zuverlaessig|haltbar)\b/i],
  opt_family: [/\b(family fit|family|familie|familientauglich)\b/i],
  use_city: [/\b(city|urban|town|stadt|stadtfahr|inner city|short trips?|errands?|einkauf)\b/i],
  use_commute: [/\b(commut|pendel|arbeitsweg|work(?:ing)?|office|job|daily drive|täglich|taeglich)\b/i],
  use_family: [/\b(famil|kids?|children|kinder|school run|kindergarten|kinderwagen)\b/i],
  use_road_trip: [
    /\b(road\s*trip|long\s*(trip|drive|distance)|highway|motorway|autobahn|langstrecke|urlaub|vacation|holiday|weekend|wochenende)\b/i,
    /\b(cruis|leisure|joy\s*rid|pleasure\s*driv|fun\s*driv|sightseeing|scenic|touring|spazier|ausflug)\b/i
  ],
  use_winter: [/\b(winter|snow|schnee|mountain|berge|alps?|alpen|ski)\b/i],
  use_case_skip: [/\b(no use case|any use|doesn'?t matter what i use)\b/i],
  charge_home: [/\b(home|wallbox|garage|zu hause|zuhause|eigene ladestation|private charg)\b/i],
  charge_work: [/\b(work|office|arbeit|firma|employer)\b/i],
  charge_public: [/\b(public|öffentlich|oeffentlich|street|apartment|wohnung|no home|keine wallbox|ohne wallbox)\b/i],
  charge_skip: [/\b(not sure(?: yet)? about charg|charging unclear|laden unklar)\b/i],
  body_suv: [/\b(suv|geländewagen|gelaendewagen|crossover)\b/i],
  body_compact: [/\b(compact|kompakt|hatchback|kleinwagen|stadtwagen|small car)\b/i],
  body_sedan: [/\b(sedan|limousine|saloon)\b/i],
  body_wagon: [/\b(wagon|estate|kombi|touring)\b/i],
  body_van: [/\b(van|minivan|transporter|bus)\b/i],
  vehicle_preferences_skip: [/\b(any body|any style|open to all|alles ok)\b/i]
};

/**
 * Maps a free-text reply to a clarification chip patch when the user answers
 * in chat instead of tapping a chip.
 */
export function resolveClarificationAnswer(
  message: string,
  promptKey: ClarificationPromptKey,
  language: Language
): ClarificationResolution | null {
  const trimmed = message.trim();
  if (!trimmed) return null;

  if (promptKey === "ready") return null;

  const prompt =
    promptKey === "optimization"
      ? getOptimizationPrompt(language)
      : getClarificationPrompt(promptKey, language);
  const matchedOptions = matchPromptOptions(trimmed, prompt.options);
  if (matchedOptions.length) {
    const skipOption = matchedOptions.find((option) => option.skip);
    if (promptKey === "budget" && (skipOption || looksLikeNoBudgetLimit(trimmed))) {
      return { kind: "patch", patch: defaultBudgetPatch() };
    }
    if (skipOption && matchedOptions.length === 1) {
      return { kind: "skip" };
    }
    const patch = mergeOptionPatches(matchedOptions.filter((option) => option.patch));
    return Object.keys(patch).length ? { kind: "patch", patch } : null;
  }

  if (isSkipAnswer(trimmed)) {
    if (promptKey === "budget") return { kind: "patch", patch: defaultBudgetPatch() };
    return { kind: "skip" };
  }

  const extractedPatch = extractPatchForPrompt(trimmed, promptKey);
  return extractedPatch ? { kind: "patch", patch: extractedPatch } : null;
}

function matchPromptOptions(message: string, options: ClarificationOption[]) {
  return options.filter((option) => optionMatches(message, option));
}

function optionMatches(message: string, option: ClarificationOption) {
  if (optionSynonyms[option.id]?.some((pattern) => pattern.test(message))) {
    return true;
  }

  const label = option.label.toLowerCase();
  const normalizedMessage = message.toLowerCase();
  if (normalizedMessage.includes(label)) {
    return true;
  }

  const labelTokens = label
    .split(/[^a-z0-9äöüß]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
  return labelTokens.some((token) => new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(message));
}

function isSkipAnswer(message: string) {
  return skipAnswerPattern.test(message);
}

function extractPatchForPrompt(message: string, promptKey: ClarificationPromptKey): CriteriaPatch | null {
  const extracted = extractCriteria(message);
  switch (promptKey) {
    case "budget": {
      const patch: CriteriaPatch = {};
      if (looksLikeNoBudgetLimit(message)) return defaultBudgetPatch();
      if (extracted.budgetMinEUR) patch.budgetMinEUR = extracted.budgetMinEUR;
      if (extracted.budgetMaxEUR) patch.budgetMaxEUR = extracted.budgetMaxEUR;
      if (extracted.monthlyBudgetEUR) patch.monthlyBudgetEUR = extracted.monthlyBudgetEUR;
      return Object.keys(patch).length ? patch : null;
    }
    case "use_case": {
      const patch: CriteriaPatch = {};
      if (extracted.tripNeeds.length) patch.tripNeeds = extracted.tripNeeds;
      if (extracted.dailyKm) patch.dailyKm = extracted.dailyKm;
      if (extracted.passengers) patch.passengers = extracted.passengers;
      if (extracted.cargoNeeds) patch.cargoNeeds = extracted.cargoNeeds;
      return Object.keys(patch).length ? patch : null;
    }
    case "charging_or_range": {
      const patch: CriteriaPatch = {};
      if (extracted.chargingAccess !== "unknown") patch.chargingAccess = extracted.chargingAccess;
      if (extracted.rangeFloorKm) patch.rangeFloorKm = extracted.rangeFloorKm;
      if (extracted.dailyKm) patch.dailyKm = extracted.dailyKm;
      return Object.keys(patch).length ? patch : null;
    }
    case "vehicle_preferences": {
      const patch: CriteriaPatch = {};
      if (extracted.bodyTypes.length) patch.bodyTypes = extracted.bodyTypes;
      if (extracted.preferredCondition !== "any") patch.preferredCondition = extracted.preferredCondition;
      if (extracted.brandPreferences.length) patch.brandPreferences = extracted.brandPreferences;
      if (extracted.modelPreferences.length) patch.modelPreferences = extracted.modelPreferences;
      if (extracted.mustHaveFeatures.length) patch.mustHaveFeatures = extracted.mustHaveFeatures;
      if (extracted.qualitativeSignals.length) patch.qualitativeSignals = extracted.qualitativeSignals;
      return Object.keys(patch).length ? patch : null;
    }
    case "optimization": {
      return extracted.optimizationDirective
        ? { optimizationDirective: extracted.optimizationDirective }
        : null;
    }
    default:
      return null;
  }
}

function defaultBudgetPatch(): CriteriaPatch {
  return {
    budgetMinEUR: DEFAULT_BUDGET_MIN_EUR,
    budgetMaxEUR: DEFAULT_BUDGET_MAX_EUR,
    monthlyBudgetEUR: null
  };
}

function mergeOptionPatches(options: ClarificationOption[]): CriteriaPatch {
  const patch: Record<string, unknown> = {};
  for (const option of options) {
    if (!option.patch) continue;
    for (const [key, value] of Object.entries(option.patch)) {
      if (Array.isArray(value)) {
        const existing = (patch[key] as unknown[] | undefined) ?? [];
        patch[key] = Array.from(new Set([...existing, ...value]));
      } else {
        patch[key] = value;
      }
    }
  }
  return patch as CriteriaPatch;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
