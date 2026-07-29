import { getClarificationPrompt, getOptimizationPrompt, getPreferredColorPrompt } from "./clarification-catalog.ts";
import {
  DEFAULT_BUDGET_MAX_EUR,
  DEFAULT_BUDGET_MIN_EUR,
  extractCriteria,
  looksLikeNoBudgetLimit
} from "./criteria.ts";
import type {
  BodyType,
  ClarificationOption,
  ClarificationPromptKey,
  CriteriaPatch,
  Language
} from "./types.ts";

export type ClarificationResolution =
  | { kind: "patch"; patch: CriteriaPatch }
  | { kind: "skip" };

/** Soft default when the user declines to name a range floor. */
export const DEFAULT_DECLINED_RANGE_FLOOR_KM = 300;

const OPEN_BODY_TYPES: BodyType[] = ["suv", "sedan", "compact", "hatchback", "wagon", "van"];

const skipAnswerPattern =
  /\b(no preference|no pref|don't care|doesn'?t matter|not sure(?: yet)?|no idea|don'?t know|skip|whatever(?:\s+works?)?|anything(?:\s+(?:would\s+)?works?)?|any(?:thing)?\s+(?:would\s+)?works?|any\s+is\s+(?:fine|ok|okay|good|alright)|any\s+of\s+(?:them|these|those|it)|(?:whichever|either)(?:\s+(?:one\s+)?(?:is\s+)?(?:fine|ok|okay|good))?|all\s+(?:of\s+them\s+)?(?:work|fine|ok|okay)|any style|any body|open to anything|no budget limit|no limit|just\s+(looking|browsing|exploring|want\s+to\s+see)|only\s+(looking|browsing|options?)|egal(?:\s+welche[srs]?)?|keine präferenz|keine ahnung|weiß nicht|weiss nicht|unklar|passt schon|ist mir egal|alles\s+(?:ok|gut|passt|fine))\b/i;

/** Bare "No" / "None" / "Any" / "Nein" and longer skip phrases — user declines extras. */
const declineAnswerPattern =
  /^(no|nope|nah|nein|nee|none|nothing|any|anything|egal|no thanks|no thank you|not really|nothing specific|no specific(?:\s+features?)?|keine|nichts|nein danke|nicht wirklich)\.?$/i;

const declineLeadInPattern =
  /^(no|nope|nah|nein|nee|none|nothing|not really)\b/i;

const browseWithoutDetailsPattern =
  /\b((j?ust|only)\s+(looking|want|show|see|browse|exploring)|looking\s+for\s+(the\s+)?(options?|choices?|results?|cars?|listings?)|show\s+me\s+(the\s+)?(options?|choices?|results?|cars?|listings?)|browse\s+(the\s+)?(options?|cars?|listings?))\b/i;

const noSpecificPreferencePattern =
  /\b(no|not|without|nothing)\s+(any\s+)?(specific|particular|special)\b/i;

const optionSynonyms: Record<string, RegExp[]> = {
  budget_under_25k: [
    /\b(under|below|max|up to|bis|unter|weniger als)\b[^.]{0,24}\b(25\s*k|25\.?000|25000)\b/i,
    /\b(25\s*k|25\.?000|25000)\b[^.]{0,24}\b(budget|max|limit|euro|eur|€)\b/i
  ],
  budget_25_40k: [/\b(25|30|35|40)\s*k\b/i, /\b(25|30|35|40)[.,]000\b/i],
  budget_40_60k: [/\b(40|45|50|55|60)\s*k\b/i, /\b(40|45|50|55|60)[.,]000\b/i],
  budget_over_60k: [
    /\b(60|70|80)\s*k\b/i,
    /\b(60|70|80)[.,]000\b/i,
    /\b(60\.?000|60000)\s*(?:-|–|to|bis)\s*(90\.?000|90000)\b/i
  ],
  budget_over_90k: [
    /\b(over|above|more than|über|ueber|mehr als)\b[^.]{0,24}\b(90\s*k|90\.?000|90000)\b/i,
    /\b(90\s*k|90\.?000|90000)\s*\+\b/i
  ],
  budget_skip: [/\b(no budget|no limit|unlimited budget|kein budget|kein limit)\b/i],
  opt_best_value: [/\b(best value|value for money|preis[-\s]?leistung|preiswert)\b/i],
  opt_max_range: [/\b(max(?:imum)? range|longest range|maximale reichweite|größte reichweite|groesste reichweite)\b/i],
  opt_reliable: [/\b(reliable|reliability|zuverlässig|zuverlaessig|haltbar)\b/i],
  opt_family: [/\b(family fit|family|familie|familientauglich)\b/i],
  use_city: [/\b(city|urban|town|stadt|stadtfahr|inner city|short trips?|errands?|einkauf)\b/i],
  use_commute: [
    /\b(commut|pendel|arbeitsweg|office|job|daily drive|täglich|taeglich)\b/i,
    /\b(?:to|for|at|from)\s+work\b/i,
    /\bworking\b/i
  ],
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
  vehicle_preferences_skip: [/\b(any body|any style|open to all|alles ok)\b/i],
  range_250: [/\b(250|200|city)\b/i],
  range_350: [/\b(350|300)\b/i],
  range_450: [/\b(450|400)\b/i],
  range_550: [/\b(550|500|600)\b/i],
  wish_status: [/\bstatus\b/i, /\bprestige\b/i, /\bansehen\b/i],
  wish_freedom: [/\bfreedom\b/i, /\bfreiheit\b/i],
  color_black: [/\b(black|schwarz)\b/i],
  color_white: [/\b(white|weiß|weiss)\b/i],
  color_blue: [/\b(blue|blau)\b/i],
  color_grey: [/\b(gr[eay]y|grau)\b/i],
  color_silver: [/\b(silver|silber)\b/i],
  color_red: [/\b(red|rot)\b/i],
  color_any: [/\b(any color|any colour|no preference|farbe egal|keine präferenz|keine praeferenz)\b/i]
};

/**
 * True when the user declines extras ("No", "none", "no preference", …).
 * These answers must advance the conversation — never re-nudge the same question.
 */
export function looksLikeDeclineAnswer(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (hasConcreteShoppingCriteriaInMessage(trimmed)) return false;
  if (declineAnswerPattern.test(trimmed) || skipAnswerPattern.test(trimmed)) return true;
  if (browseWithoutDetailsPattern.test(trimmed)) return true;
  if (noSpecificPreferencePattern.test(trimmed)) return true;
  if (declineLeadInPattern.test(trimmed)) {
    const tail = trimmed.replace(declineLeadInPattern, "").replace(/^[,.\s-]+/, "").trim();
    if (!tail) return true;
    if (
      skipAnswerPattern.test(tail) ||
      browseWithoutDetailsPattern.test(trimmed) ||
      noSpecificPreferencePattern.test(trimmed)
    ) {
      return true;
    }
  }
  return false;
}

function hasConcreteShoppingCriteriaInMessage(message: string) {
  const extracted = extractCriteria(message);
  if (extracted.budgetMinEUR || extracted.budgetMaxEUR || extracted.monthlyBudgetEUR) return true;
  if (extracted.bodyTypes.length) return true;
  if (extracted.rangeFloorKm || extracted.dailyKm) return true;
  if (extracted.brandPreferences.length || extracted.modelPreferences.length) return true;
  if (extracted.mustHaveFeatures.length) return true;
  if (extracted.personalWish) return true;
  if (extracted.tripNeeds.length) return true;
  if (/\b(under|over|below|above|bis|unter|über|ueber|€|\d+\s*k\b|\d+[.,]\d{3})\b/i.test(message)) {
    return true;
  }
  return false;
}

/**
 * Patch that records: no must-have features, no brand/model lock-in, no cargo/seat extras.
 * Uses remove keys because applyChipPatch merges list fields and would ignore [].
 * If body style is still empty, open the body pool so matching can proceed.
 */
export function declinedOptionalPreferencesPatch(hasBodyType = false): CriteriaPatch {
  const patch: CriteriaPatch = {
    remove: ["features", "brand", "model"],
    cargoNeeds: null,
    passengers: null
  };
  if (!hasBodyType) {
    patch.bodyTypes = [...OPEN_BODY_TYPES];
  }
  return patch;
}

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

  // Soft declines ("Any would work") must win over accidental option hits
  // like matching "work" to the commute chip.
  if (looksLikeDeclineAnswer(trimmed)) {
    if (promptKey === "budget" || looksLikeNoBudgetLimit(trimmed)) {
      return { kind: "patch", patch: defaultBudgetPatch() };
    }
    return declineResolutionForPrompt(promptKey);
  }

  const prompt =
    promptKey === "optimization"
      ? getOptimizationPrompt(language)
      : promptKey === "preferred_color"
        ? getPreferredColorPrompt(language)
        : getClarificationPrompt(promptKey, language);
  const matchedOptions = matchPromptOptions(trimmed, prompt.options);
  if (matchedOptions.length) {
    const skipOption = matchedOptions.find((option) => option.skip);
    if (promptKey === "budget" && (skipOption || looksLikeNoBudgetLimit(trimmed))) {
      return { kind: "patch", patch: defaultBudgetPatch() };
    }
    if (skipOption && matchedOptions.length === 1) {
      const declined = declineResolutionForPrompt(promptKey);
      if (declined) return declined;
      return { kind: "skip" };
    }
    const patch = mergeOptionPatches(matchedOptions.filter((option) => option.patch));
    return Object.keys(patch).length ? { kind: "patch", patch } : null;
  }

  const extractedPatch = extractPatchForPrompt(trimmed, promptKey);
  return extractedPatch ? { kind: "patch", patch: extractedPatch } : null;
}

/**
 * When the user says "No" / "no preference", advance with defaults or a skip —
 * never return null (that causes an infinite nudge loop on the same question).
 */
function declineResolutionForPrompt(promptKey: ClarificationPromptKey): ClarificationResolution | null {
  switch (promptKey) {
    case "budget":
      return { kind: "patch", patch: defaultBudgetPatch() };
    case "use_case":
      return { kind: "skip" };
    case "optimization":
      return { kind: "patch", patch: { optimizationDirective: "best_value" } };
    case "personal_wish":
      // Neutral default so binding readiness advances after an explicit decline.
      return { kind: "patch", patch: { personalWish: "freedom" } };
    case "charging_or_range":
      return { kind: "patch", patch: { rangeFloorKm: DEFAULT_DECLINED_RANGE_FLOOR_KM } };
    case "vehicle_preferences":
      // Mark: no specific features / brands / cargo / seats; open body if needed.
      return { kind: "patch", patch: declinedOptionalPreferencesPatch(false) };
    case "preferred_color":
      return { kind: "patch", patch: { acceptAnyColor: true, preferredColors: [] } };
    default:
      return { kind: "skip" };
  }
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
    case "personal_wish": {
      return extracted.personalWish ? { personalWish: extracted.personalWish } : null;
    }
    case "optimization": {
      return extracted.optimizationDirective
        ? { optimizationDirective: extracted.optimizationDirective }
        : null;
    }
    case "preferred_color": {
      if (extracted.acceptAnyColor) return { acceptAnyColor: true, preferredColors: [] };
      return extracted.preferredColors.length
        ? { preferredColors: extracted.preferredColors, acceptAnyColor: false }
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
