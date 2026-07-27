import type {
  BrandOrigin,
  BodyType,
  ChargingAccess,
  Feature,
  Importance,
  Language,
  MissingCriteria,
  OptimizationDirective,
  PersonalWish,
  QualitativeSignal,
  TripNeed,
  UserCriteria,
  VehicleCondition
} from "./types.ts";

export const DEFAULT_BUDGET_MIN_EUR = 25_000;
export const DEFAULT_BUDGET_MAX_EUR = 60_000;

const germanSignals = [
  "ich",
  "suche",
  "brauche",
  "reichweite",
  "monat",
  "gebraucht",
  "gebrauchter",
  "gebrauchte",
  "gebrauchtes",
  "neu",
  "neuer",
  "neue",
  "neues",
  "wohnung",
  "pendeln",
  "taeglich",
  "täglich",
  "autobahn",
  "familie",
  "kofferraum",
  "hallo",
  "danke",
  "bitte",
  "ja",
  "nein",
  "österreich",
  "oesterreich",
  "fuer",
  "für",
  "ohne",
  "mit",
  "bis"
];

const englishSignals = [
  "i",
  "need",
  "looking",
  "find",
  "used",
  "under",
  "with",
  "for",
  "range",
  "monthly",
  "lease",
  "commute",
  "highway",
  "family",
  "trunk",
  "hello",
  "hi",
  "thanks",
  "thank",
  "please",
  "yes",
  "no",
  "without",
  "public",
  "home",
  "work",
  "city",
  "mileage"
];

const bodyTypeKeywords: Array<[BodyType, RegExp]> = [
  ["suv", /\b(suvs?|geländewagen)\b/i],
  ["wagon", /\b(kombi|wagon|estate|touring)\b/i],
  ["sedan", /\b(limousine|sedan|saloon)\b/i],
  ["hatchback", /\b(hatchback|kleinwagen|kompaktwagen)\b/i],
  ["compact", /\b(compact|kompakt|stadtwagen)\b/i],
  ["crossover", /\b(crossover)\b/i],
  ["van", /\b(van|bus|transporter)\b/i]
];

const featureKeywords: Array<[Feature, RegExp]> = [
  ["apple_carplay", /\b(carplay|apple carplay)\b/i],
  ["android_auto", /\b(android auto)\b/i],
  ["blind_spot_detection", /\b(blind spot|totwinkel|toter winkel)\b/i],
  ["adaptive_cruise_control", /\b(adaptive cruise|acc|abstandsregeltempomat|tempomat)\b/i],
  ["lane_keeping_assist", /\b(lane keeping|spurhalte|spurassistent)\b/i],
  ["wireless_charging", /\b(wireless charging|kabellos laden|induktiv)\b/i],
  ["heated_seats", /\b(heated seats|sitzheizung|beheizte sitze)\b/i],
  ["premium_audio", /\b(bose|harman|bowers|b&w|burmester|premium audio|guter sound)\b/i],
  // large_trunk is scored via cargoNeeds — do not hard-require the feature tag
  ["heat_pump", /\b(heat pump|wärmepumpe|waermepumpe)\b/i],
  ["awd", /\b(awd|all[\s-]?wheel(?:\s+drive)?|4wd|4x4|allrad(?:antrieb)?)\b/i],
  ["voice_assistant", /\b(voice assistant|sprachassistent|sprachsteuerung)\b/i],
  ["reliable_connectivity", /\b(ota|bluetooth|wi-fi|wifi|usb-c|connectivity|konnektivität)\b/i]
];

const brandNames = [
  "Volkswagen",
  "VW",
  "BMW",
  "Mercedes",
  "Mercedes-Benz",
  "Audi",
  "Tesla",
  "Kia",
  "Hyundai",
  "MG",
  "BYD",
  "Cupra",
  "Citroen",
  "Ford",
  "Jaguar",
  "Jeep",
  "Mazda",
  "MINI",
  "Opel",
  "Peugeot",
  "XPeng",
  "NIO",
  "Polestar",
  "Porsche",
  "Renault",
  "Skoda",
  "smart",
  "Volvo",
  "Fiat"
];

const modelAliases: Array<[string, RegExp]> = [
  ["A6", /\ba6\b/i],
  ["Atto 2", /\batto\s*2\b/i],
  ["Atto 3", /\batto\s*3\b/i],
  ["Astra", /\bastra\b/i],
  ["Avenger", /\bavenger\b/i],
  ["Born", /\bborn\b/i],
  ["C3 Aircross", /\bc3\s*aircross\b/i],
  ["Combo", /\bcombo\b/i],
  ["Cooper SE", /\bcooper\s*se\b/i],
  ["Corsa-e", /\bcorsa(?:\s|-)?e\b/i],
  ["Dolphin", /\bdolphin\b/i],
  ["Elroq", /\belroq\b/i],
  ["Enyaq", /\benyaq\b/i],
  ["EQA", /\beqa\b/i],
  ["EQB", /\beqb\b/i],
  ["EQC", /\beqc(?:\s*400)?\b/i],
  ["EQE", /\beqe(?:\s*43)?\b/i],
  ["ET5 Touring", /\bet5\s*touring\b/i],
  ["EV2", /\bev\s*2\b/i],
  ["EV3", /\bev\s*3\b/i],
  ["EV4", /\bev\s*4\b/i],
  ["EV5", /\bev\s*5\b/i],
  ["EV6", /\bev\s*6\b/i],
  ["Explorer", /\bexplorer\b/i],
  ["EX30", /\bex\s*30\b/i],
  ["e-Golf", /\be\s*-?\s*golf\b/i],
  ["e-2008", /\be\s*-?\s*2008\b/i],
  ["500e", /\b500\s*e\b/i],
  ["forTwo", /\bfor\s*two\b/i],
  ["G6", /\bg6\b/i],
  ["i3", /\bi3\b/i],
  ["i4", /\bi4\b/i],
  ["i5", /\bi5\b/i],
  ["i7", /\bi7\b/i],
  ["ID.3", /\bid\.?\s*3\b/i],
  ["ID.4", /\bid\.?\s*4\b/i],
  ["ID.5", /\bid\.?\s*5\b/i],
  ["ID.7 Tourer", /\bid\.?\s*7\s*tourer\b/i],
  ["ID.7", /\bid\.?\s*7\b/i],
  ["Ioniq 5", /\bioniq\s*5\b/i],
  ["IONIQ 6", /\bioniq\s*6\b/i],
  ["Ioniq 9", /\bioniq\s*9\b/i],
  ["Inster", /\binster\b/i],
  ["iX1", /\bix\s*1\b/i],
  ["iX2", /\bix\s*2\b/i],
  ["iX3", /\bix\s*3\b/i],
  ["iX", /\bix\b/i],
  ["I-Pace", /\bi\s*-?\s*pace\b/i],
  ["KONA", /\bkona\b/i],
  ["Macan", /\bmacan\b/i],
  ["Megane E-Tech", /\bmegane(?:\s*e(?:\s|-)?tech)?\b/i],
  ["Model 3", /\bmodel\s*3\b/i],
  ["Model Y", /\bmodel\s*y\b/i],
  ["Mustang Mach-E", /\bmustang\s*mach(?:\s|-)?e\b/i],
  ["MX-30", /\bmx\s*-?\s*30\b/i],
  ["MG4", /\bmg\s*4\b/i],
  ["Polestar 2", /\bpolestar\s*2\b/i],
  ["Polestar 4", /\bpolestar\s*4\b/i],
  ["PV5 Passenger", /\bpv\s*5(?:\s*passenger)?\b/i],
  ["Q4 e-tron", /\bq4(?:\s*e(?:\s|-)?tron)?\b/i],
  ["Q6 e-tron", /\bq6(?:\s*e(?:\s|-)?tron)?\b/i],
  ["Seal U", /\bseal\s*u\b/i],
  ["Seal", /\bseal\b/i],
  ["Tavascan", /\btavascan\b/i],
  ["Taycan", /\btaycan\b/i],
  ["ZOE", /\bzoe\b/i]
];

export const optimizationDirectiveLabels: Record<OptimizationDirective, string> = {
  best_value: "best value",
  maximum_range: "maximum range",
  most_reliable: "most reliable",
  fastest_charging: "fastest charging",
  lowest_running_cost: "lowest running cost",
  best_family_fit: "best family fit",
  performance: "performance"
};

export const personalWishLabels: Record<PersonalWish, string> = {
  status: "status",
  freedom: "freedom",
  childhood_memories: "childhood memories"
};

export function emptyCriteria(rawPrompt = "", language: Language = "en"): UserCriteria {
  return {
    language,
    budgetMinEUR: null,
    budgetMaxEUR: null,
    monthlyBudgetEUR: null,
    dailyKm: null,
    rangeFloorKm: null,
    mileageMaxKm: null,
    mileageTargetKm: null,
    batterySoHMin: null,
    batteryHealthRequired: false,
    tripNeeds: [],
    chargingAccess: "unknown",
    passengers: null,
    cargoNeeds: null,
    preferredCondition: "any",
    bodyTypes: [],
    brandPreferences: [],
    preferredBrandOrigins: [],
    modelPreferences: [],
    avoidedBrands: [],
    brandFit: "medium",
    reliabilityImportance: "medium",
    mustHaveFeatures: [],
    qualitativeSignals: [],
    optimizationDirective: null,
    personalWish: null,
    location: null,
    rawPrompt,
    latestUserMessage: rawPrompt
  };
}

function countLanguageSignals(prompt: string, signals: string[]) {
  return signals.filter((signal) => new RegExp(`\\b${escapeRegExp(signal)}\\b`, "i").test(prompt)).length;
}

function detectPromptLanguage(prompt: string): Language | null {
  const normalized = prompt.toLowerCase();
  const hasGermanCharacter = /[äöüß]/i.test(prompt);
  if (hasGermanCharacter) return "de";

  const germanHits = countLanguageSignals(normalized, germanSignals);
  const englishHits = countLanguageSignals(normalized, englishSignals);
  if (germanHits > englishHits && germanHits >= 1) return "de";
  if (englishHits > germanHits && englishHits >= 1) return "en";
  return null;
}

export function detectLanguage(prompt: string, fallback: Language = "en"): Language {
  return detectPromptLanguage(prompt) ?? fallback;
}

export function languageLabel(language: Language): "English" | "German" {
  return language === "de" ? "German" : "English";
}

export function languageReplyInstruction(language: Language): string {
  const label = languageLabel(language);
  const other = language === "de" ? "English" : "German";
  return `The user's current message is in ${label}. You MUST write all user-facing text in ${label} only. Never respond in ${other}.`;
}

export function extractCriteria(prompt: string, previous?: UserCriteria): UserCriteria {
  const language = detectLanguage(prompt, previous?.language ?? "en");
  const base = previous ? normalizeCriteriaShape({ ...previous, language }) : emptyCriteria(prompt, language);
  const normalizedPrompt = prompt.trim();
  const text = normalizedPrompt.toLowerCase();
  const removals = extractRemovals(text);

  const budgetRange = removals.has("budget") ? { min: null, max: null } : extractBudgetRange(text);
  const usesDefaultBudget = !removals.has("budget") && looksLikeNoBudgetLimit(text);
  const budgetMinEUR = removals.has("budget")
    ? null
    : budgetRange.min ?? (usesDefaultBudget ? DEFAULT_BUDGET_MIN_EUR : base.budgetMinEUR);
  const budgetMaxEUR = removals.has("budget")
    ? null
    : budgetRange.max ?? extractBudget(text, false) ?? (usesDefaultBudget ? DEFAULT_BUDGET_MAX_EUR : base.budgetMaxEUR);
  const monthlyBudgetEUR = removals.has("budget")
    ? null
    : usesDefaultBudget
      ? null
      : extractBudget(text, true) ?? base.monthlyBudgetEUR;
  const dailyKm = removals.has("dailyKm") ? null : extractKm(text, "daily") ?? base.dailyKm;
  const mileageMaxKm = removals.has("mileage")
    ? null
    : extractMileageKm(text, "max") ?? inferMileagePreference(text).max ?? base.mileageMaxKm;
  const mileageTargetKm = removals.has("mileage")
    ? null
    : extractMileageKm(text, "target") ?? inferMileagePreference(text).target ?? base.mileageTargetKm;
  const tripNeeds = removals.has("use_case") ? [] : mergeUnique(base.tripNeeds, extractTripNeeds(text));
  const rangeFloorKm = removals.has("range")
    ? null
    : extractKm(text, "range") ?? inferQualitativeRangeFloor(text, tripNeeds) ?? base.rangeFloorKm;
  const batteryHealth = extractBatteryHealth(text);
  const batterySoHMin = removals.has("battery") ? null : batteryHealth.min ?? base.batterySoHMin;
  const batteryHealthRequired = removals.has("battery")
    ? false
    : batteryHealth.required || base.batteryHealthRequired;
  const chargingAccess = removals.has("charging") ? "unknown" : extractChargingAccess(text) ?? base.chargingAccess;
  const preferredCondition = removals.has("condition") ? "any" : extractCondition(text) ?? base.preferredCondition;
  const passengers = removals.has("passengers") ? null : extractPassengers(text) ?? base.passengers;
  const cargoNeeds = removals.has("cargo") ? null : extractCargoNeeds(text) ?? base.cargoNeeds;
  const extractedBodyTypes = extractBodyTypes(text);
  const shouldReplaceLists = hasReplaceIntent(text);
  const bodyTypes = removals.has("body")
    ? []
    : shouldReplaceLists && extractedBodyTypes.length
      ? extractedBodyTypes
      : mergeUnique(base.bodyTypes, extractedBodyTypes);
  const mustHaveFeatures = removals.has("features") ? [] : mergeUnique(base.mustHaveFeatures, extractFeatures(text));
  const extractedBrands = extractBrandPreferences(text);
  const brandFocus = looksLikeBrandFocusQuestion(normalizedPrompt);
  const brandPreferences = removals.has("brand")
    ? []
    : shouldReplaceLists && extractedBrands.length
      ? extractedBrands
      : brandFocus && extractedBrands.length
        ? extractedBrands
        : mergeUnique(base.brandPreferences, extractedBrands);
  const preferredBrandOrigins = removals.has("origin")
    ? []
    : mergeUnique(base.preferredBrandOrigins, extractPreferredBrandOrigins(text));
  const extractedModels = extractModelPreferences(normalizedPrompt);
  const modelPreferences = removals.has("model")
    ? []
    : shouldReplaceLists && extractedModels.length
      ? extractedModels
      : shouldReplaceLists && extractedBrands.length
        ? []
        : brandFocus && extractedBrands.length && !extractedModels.length
          ? []
          : mergeUnique(base.modelPreferences, extractedModels);
  const avoidedBrands = mergeUnique(base.avoidedBrands, extractAvoidedBrands(text));
  const location = removals.has("location") ? null : extractLocation(normalizedPrompt) ?? base.location;
  const qualitativeSignals = removals.has("qualitative")
    ? []
    : mergeUnique(base.qualitativeSignals, extractQualitativeSignals(text));
  const optimizationDirective = removals.has("optimization")
    ? null
    : extractOptimizationDirective(text) ?? base.optimizationDirective;
  const personalWish = removals.has("personal_wish")
    ? null
    : extractPersonalWish(text) ?? base.personalWish;
  const reliabilityImportance = deriveReliabilityImportance(text, qualitativeSignals, base.reliabilityImportance);
  const avoidedLower = new Set(avoidedBrands.map((brand) => brand.toLowerCase()));
  const preferredBrands = brandPreferences.filter((brand) => !avoidedLower.has(brand.toLowerCase()));
  const brandFit = deriveBrandFit(text, preferredBrands, base.brandFit);

  return {
    ...base,
    budgetMinEUR,
    budgetMaxEUR,
    monthlyBudgetEUR,
    dailyKm,
    rangeFloorKm,
    mileageMaxKm,
    mileageTargetKm,
    batterySoHMin,
    batteryHealthRequired,
    tripNeeds,
    chargingAccess,
    passengers,
    cargoNeeds,
    preferredCondition,
    bodyTypes,
    brandPreferences: preferredBrands,
    preferredBrandOrigins,
    modelPreferences,
    avoidedBrands,
    brandFit,
    reliabilityImportance,
    mustHaveFeatures,
    qualitativeSignals,
    optimizationDirective,
    personalWish,
    location,
    rawPrompt: [base.rawPrompt, normalizedPrompt].filter(Boolean).join("\n"),
    latestUserMessage: normalizedPrompt
  };
}

export function needsClarification(criteria: UserCriteria) {
  return !getCriteriaReadiness(criteria).readyToMatch;
}

const missingCriteriaPriority: MissingCriteria[] = [
  "budget",
  "vehicle_preferences",
  "charging_or_range",
  "personal_wish",
  "use_case"
];

export function clarificationQuestion(criteria: UserCriteria) {
  const missing = getMissingCriteria(criteria);
  const target = missingCriteriaPriority.find((key) => missing.includes(key)) ?? "vehicle_preferences";

  if (target === "budget") {
    return criteria.language === "de"
      ? "Welches Budget soll ich einhalten: maximaler Kaufpreis oder monatliche Leasingrate?"
      : "What budget should I respect: maximum purchase price or monthly lease target?";
  }

  if (target === "charging_or_range") {
    return criteria.language === "de"
      ? "Welche Mindestreichweite brauchst du, oder wie viele km faehrst du pro Tag?"
      : "What minimum range do you need, or how many km do you drive per day?";
  }

  if (target === "vehicle_preferences") {
    return criteria.language === "de"
      ? "Welche Karosserieform passt am besten: SUV, Limousine, Kompakt, Kombi oder Van?"
      : "Which body style fits best: SUV, sedan, compact, wagon, or van?";
  }

  if (target === "personal_wish") {
    return criteria.language === "de"
      ? "Was ist dir emotional wichtiger: Status, Freiheit oder Kindheitserinnerungen?"
      : "What matters more emotionally: status, freedom, or fond childhood memories?";
  }

  return criteria.language === "de"
    ? "Wofuer soll das Auto vor allem passen: Stadt, Pendeln, Familie, Langstrecke oder Winter?"
    : "What should the car mainly fit: city driving, commuting, family use, road trips, or winter driving?";
}

export function getMissingCriteria(criteria: UserCriteria): MissingCriteria[] {
  return getCriteriaReadiness(criteria).missingCriteria;
}

export type CriteriaReadiness = {
  readyToMatch: boolean;
  collectedCriteriaCount: number;
  groups: Record<MissingCriteria, boolean>;
  missingCriteria: MissingCriteria[];
};

export function getCriteriaReadiness(criteria: UserCriteria): CriteriaReadiness {
  // Binding minimum criteria (PoC Test Summary §4): budget, body type, range, personal wish.
  // Brand/origin alone must not unlock matching.
  const groups: Record<MissingCriteria, boolean> = {
    budget: Boolean(criteria.budgetMinEUR || criteria.budgetMaxEUR || criteria.monthlyBudgetEUR),
    vehicle_preferences: hasBodyTypeSignal(criteria),
    charging_or_range: hasRangeSignal(criteria),
    personal_wish: Boolean(criteria.personalWish),
    // Optional enrichment — collected when present but not required to match.
    use_case: hasUseCaseSignal(criteria)
  };
  const bindingKeys: MissingCriteria[] = [
    "budget",
    "vehicle_preferences",
    "charging_or_range",
    "personal_wish"
  ];
  const collectedCriteriaCount = bindingKeys.filter((key) => groups[key]).length;
  const missingCriteria = bindingKeys.filter((key) => !groups[key]);

  return {
    readyToMatch: missingCriteria.length === 0,
    collectedCriteriaCount,
    groups,
    missingCriteria
  };
}

export function getCriteriaConfidence(criteria: UserCriteria) {
  let score = 0.35;
  if (criteria.budgetMinEUR || criteria.budgetMaxEUR || criteria.monthlyBudgetEUR) score += 0.2;
  if (hasUseCaseSignal(criteria)) score += 0.2;
  if (criteria.bodyTypes.length) score += 0.08;
  if (criteria.chargingAccess !== "unknown") score += 0.07;
  if (criteria.rangeFloorKm || criteria.dailyKm) score += 0.06;
  if (criteria.mileageMaxKm || criteria.batterySoHMin) score += 0.05;
  if (criteria.qualitativeSignals.length) score += 0.05;
  if (criteria.optimizationDirective) score += 0.05;
  return Math.min(0.95, Math.round(score * 100) / 100);
}

export function criteriaSummary(criteria: UserCriteria) {
  const parts: string[] = [];
  if (criteria.budgetMinEUR && criteria.budgetMaxEUR) {
    parts.push(
      `EUR ${criteria.budgetMinEUR.toLocaleString("de-AT")}–${criteria.budgetMaxEUR.toLocaleString("de-AT")}`
    );
  } else if (criteria.budgetMaxEUR) {
    parts.push(`max EUR ${criteria.budgetMaxEUR.toLocaleString("de-AT")}`);
  } else if (criteria.budgetMinEUR) {
    parts.push(`from EUR ${criteria.budgetMinEUR.toLocaleString("de-AT")}`);
  }
  if (criteria.monthlyBudgetEUR) parts.push(`monthly EUR ${criteria.monthlyBudgetEUR.toLocaleString("de-AT")}`);
  if (criteria.dailyKm) parts.push(`${criteria.dailyKm} km/day`);
  if (criteria.rangeFloorKm) parts.push(`${criteria.rangeFloorKm} km range`);
  if (criteria.mileageMaxKm) parts.push(`max ${criteria.mileageMaxKm.toLocaleString("de-AT")} km`);
  if (criteria.batterySoHMin) parts.push(`SoH ${criteria.batterySoHMin}%+`);
  if (criteria.preferredCondition !== "any") parts.push(criteria.preferredCondition);
  if (criteria.bodyTypes.length) parts.push(criteria.bodyTypes.join(", "));
  if (criteria.preferredBrandOrigins.length) parts.push(`${criteria.preferredBrandOrigins.join(", ")} origin`);
  if (criteria.modelPreferences?.length) parts.push(criteria.modelPreferences.join(", "));
  if (criteria.tripNeeds.length) parts.push(criteria.tripNeeds.join(", "));
  if (criteria.chargingAccess !== "unknown") parts.push(`${criteria.chargingAccess} charging`);
  if (criteria.qualitativeSignals.length) parts.push(criteria.qualitativeSignals.join(", "));
  if (criteria.optimizationDirective) parts.push(optimizationDirectiveLabels[criteria.optimizationDirective]);
  return parts;
}

export type CriteriaChipKey =
  | "budget"
  | "dailyKm"
  | "range"
  | "mileage"
  | "battery"
  | "condition"
  | "body"
  | "use_case"
  | "charging"
  | "passengers"
  | "cargo"
  | "brand"
  | "origin"
  | "model"
  | "features"
  | "qualitative"
  | "optimization"
  | "personal_wish"
  | "location";

export type CriteriaChip = {
  key: CriteriaChipKey;
  label: string;
};

export function criteriaChips(criteria: UserCriteria): CriteriaChip[] {
  const chips: CriteriaChip[] = [];
  if (criteria.budgetMinEUR && criteria.budgetMaxEUR) {
    chips.push({
      key: "budget",
      label: `EUR ${criteria.budgetMinEUR.toLocaleString("de-AT")}–${criteria.budgetMaxEUR.toLocaleString("de-AT")}`
    });
  } else if (criteria.budgetMaxEUR) {
    chips.push({ key: "budget", label: `max EUR ${criteria.budgetMaxEUR.toLocaleString("de-AT")}` });
  } else if (criteria.budgetMinEUR) {
    chips.push({ key: "budget", label: `from EUR ${criteria.budgetMinEUR.toLocaleString("de-AT")}` });
  }
  if (criteria.monthlyBudgetEUR) {
    chips.push({ key: "budget", label: `monthly EUR ${criteria.monthlyBudgetEUR.toLocaleString("de-AT")}` });
  }
  if (criteria.dailyKm) chips.push({ key: "dailyKm", label: `${criteria.dailyKm} km/day` });
  if (criteria.rangeFloorKm) chips.push({ key: "range", label: `${criteria.rangeFloorKm} km range` });
  if (criteria.mileageMaxKm) {
    chips.push({ key: "mileage", label: `max ${criteria.mileageMaxKm.toLocaleString("de-AT")} km` });
  } else if (criteria.mileageTargetKm) {
    chips.push({ key: "mileage", label: `low km target` });
  }
  if (criteria.batterySoHMin) chips.push({ key: "battery", label: `SoH ${criteria.batterySoHMin}%+` });
  if (criteria.preferredCondition !== "any") {
    chips.push({ key: "condition", label: criteria.preferredCondition });
  }
  if (criteria.bodyTypes.length) chips.push({ key: "body", label: criteria.bodyTypes.join(", ") });
  if (criteria.tripNeeds.length) chips.push({ key: "use_case", label: criteria.tripNeeds.join(", ") });
  if (criteria.chargingAccess !== "unknown") {
    chips.push({ key: "charging", label: `${criteria.chargingAccess} charging` });
  }
  if (criteria.passengers) chips.push({ key: "passengers", label: `${criteria.passengers} seats` });
  if (criteria.cargoNeeds) chips.push({ key: "cargo", label: `${criteria.cargoNeeds} cargo` });
  if (criteria.brandPreferences.length) chips.push({ key: "brand", label: criteria.brandPreferences.join(", ") });
  if (criteria.preferredBrandOrigins.length) {
    chips.push({ key: "origin", label: `${criteria.preferredBrandOrigins.join(", ")} origin` });
  }
  if (criteria.modelPreferences?.length) chips.push({ key: "model", label: criteria.modelPreferences.join(", ") });
  if (criteria.avoidedBrands.length) chips.push({ key: "brand", label: `no ${criteria.avoidedBrands.join(", ")}` });
  if (criteria.mustHaveFeatures.length) chips.push({ key: "features", label: criteria.mustHaveFeatures.join(", ") });
  if (criteria.qualitativeSignals.length) {
    chips.push({ key: "qualitative", label: criteria.qualitativeSignals.join(", ") });
  }
  if (criteria.optimizationDirective) {
    chips.push({ key: "optimization", label: optimizationDirectiveLabels[criteria.optimizationDirective] });
  }
  if (criteria.personalWish) {
    chips.push({ key: "personal_wish", label: personalWishLabels[criteria.personalWish] });
  }
  if (criteria.location) chips.push({ key: "location", label: criteria.location });
  return chips;
}

export function removeCriteriaKey(criteria: UserCriteria, key: CriteriaChipKey): UserCriteria {
  const next = normalizeCriteriaShape({ ...criteria });
  if (key === "budget") {
    next.budgetMinEUR = null;
    next.budgetMaxEUR = null;
    next.monthlyBudgetEUR = null;
  }
  if (key === "dailyKm") next.dailyKm = null;
  if (key === "range") next.rangeFloorKm = null;
  if (key === "mileage") {
    next.mileageMaxKm = null;
    next.mileageTargetKm = null;
  }
  if (key === "battery") {
    next.batterySoHMin = null;
    next.batteryHealthRequired = false;
  }
  if (key === "condition") next.preferredCondition = "any";
  if (key === "body") next.bodyTypes = [];
  if (key === "use_case") next.tripNeeds = [];
  if (key === "charging") next.chargingAccess = "unknown";
  if (key === "passengers") next.passengers = null;
  if (key === "cargo") next.cargoNeeds = null;
  if (key === "brand") {
    next.brandPreferences = [];
    next.avoidedBrands = [];
    next.brandFit = "medium";
  }
  if (key === "origin") next.preferredBrandOrigins = [];
  if (key === "model") next.modelPreferences = [];
  if (key === "features") next.mustHaveFeatures = [];
  if (key === "qualitative") next.qualitativeSignals = [];
  if (key === "optimization") next.optimizationDirective = null;
  if (key === "personal_wish") next.personalWish = null;
  if (key === "location") next.location = null;
  return next;
}

export function normalizeCriteriaShape(criteria: UserCriteria): UserCriteria {
  return {
    ...emptyCriteria(criteria.rawPrompt, criteria.language),
    ...criteria,
    tripNeeds: criteria.tripNeeds ?? [],
    bodyTypes: criteria.bodyTypes ?? [],
    brandPreferences: criteria.brandPreferences ?? [],
    preferredBrandOrigins: criteria.preferredBrandOrigins ?? [],
    modelPreferences: criteria.modelPreferences ?? [],
    avoidedBrands: criteria.avoidedBrands ?? [],
    mustHaveFeatures: criteria.mustHaveFeatures ?? [],
    qualitativeSignals: criteria.qualitativeSignals ?? [],
    optimizationDirective: criteria.optimizationDirective ?? null,
    personalWish: criteria.personalWish ?? null,
    mileageMaxKm: criteria.mileageMaxKm ?? null,
    mileageTargetKm: criteria.mileageTargetKm ?? null,
    batterySoHMin: criteria.batterySoHMin ?? null,
    batteryHealthRequired: criteria.batteryHealthRequired ?? false,
    brandFit: criteria.brandFit ?? "medium",
    reliabilityImportance: criteria.reliabilityImportance ?? "medium",
    latestUserMessage: criteria.latestUserMessage ?? criteria.rawPrompt ?? ""
  };
}

function hasUseCaseSignal(criteria: UserCriteria) {
  return Boolean(
    criteria.tripNeeds.length ||
      criteria.dailyKm ||
      criteria.passengers ||
      criteria.cargoNeeds
  );
}

/** Binding body-type signal — brand/origin alone must not satisfy vehicle_preferences. */
function hasBodyTypeSignal(criteria: UserCriteria) {
  return criteria.bodyTypes.length > 0;
}

/** Binding range signal — charging access alone must not satisfy charging_or_range. */
function hasRangeSignal(criteria: UserCriteria) {
  return Boolean(criteria.rangeFloorKm || criteria.dailyKm);
}

export function hasReplaceIntent(text: string) {
  return /\b(only|just|nur|ausschliesslich|ausschließlich)\b/i.test(text);
}

export function looksLikeBrandFocusQuestion(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (
    !/\b(what|how) about\b/i.test(trimmed) &&
    !/\b(und\s+)?was ist mit\b/i.test(trimmed) &&
    !/\b(what|how) about the\b/i.test(trimmed)
  ) {
    return false;
  }
  return extractBrandPreferences(trimmed).length > 0;
}

export function looksLikeBrandWidenRequest(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return (
    /\b((what|which)\s+other\s+(car\s+)?brands?\b|\bother\s+(car\s+)?brands?\b|\bany\s+brand\b|\bany\s+make\b|\bbrand\s+doesn'?t\s+matter\b|\bno\s+brand\s+preference\b)/i.test(
      trimmed
    ) ||
    /\b(andere\s+marken|welche\s+marken|egal\s+welche\s+marke|marke\s+egal|egal\s+welche\s+marke)\b/i.test(
      trimmed
    )
  );
}

function extractRemovals(text: string) {
  const removals = new Set<CriteriaChipKey>();
  const hasRemoveIntent = /\b(remove|clear|delete|reset|ignore|forget|egal|entferne|loesche|lösche|vergiss)\b/i.test(text);
  if (!hasRemoveIntent) return removals;

  if (/\b(budget|preis|price|monthly|monat|leasing)\b/i.test(text)) removals.add("budget");
  if (/\b(daily|commute|pendel|tag|taeglich|täglich)\b/i.test(text)) removals.add("dailyKm");
  if (/\b(range|reichweite)\b/i.test(text)) removals.add("range");
  if (/\b(mileage|kilometerstand|km stand|km-stand|low km|wenig kilometer)\b/i.test(text)) removals.add("mileage");
  if (/\b(battery|batterie|soh|health|gesundheit)\b/i.test(text)) removals.add("battery");
  if (/\b(condition|zustand|new|used|neu|gebraucht)\b/i.test(text)) removals.add("condition");
  if (/\b(body|suv|sedan|wagon|kombi|van|karosserie)\b/i.test(text)) removals.add("body");
  if (/\b(use case|family|familie|city|stadt|winter|road trip|langstrecke)\b/i.test(text)) removals.add("use_case");
  if (/\b(charging|laden|wallbox|public|öffentlich)\b/i.test(text)) removals.add("charging");
  if (/\b(seats|sitze|passengers|personen)\b/i.test(text)) removals.add("passengers");
  if (/\b(cargo|trunk|kofferraum|boot)\b/i.test(text)) removals.add("cargo");
  if (/\b(brand|marke|tesla|bmw|audi|mercedes|vw|volkswagen)\b/i.test(text)) removals.add("brand");
  if (/\b(origin|country|herkunft|china|chinese|chinesisch|chinesische|chinesisches|european|europe|europäisch|europaeisch|korean|korea|koreanisch)\b/i.test(text)) {
    removals.add("origin");
  }
  if (/\b(model|modell|ev6|ev3|id\.?3|id\.?4|model 3|model y|ioniq|q4|e-tron)\b/i.test(text)) {
    removals.add("model");
  }
  if (/\b(features|ausstattung|carplay|acc|tempomat|assist)\b/i.test(text)) removals.add("features");
  if (/\b(premium|reliable|zuverlässig|qualitative|tech|technology)\b/i.test(text)) removals.add("qualitative");
  if (/\b(optimization|priority|prioritize|optimierung|prioritaet|priorität|wert|reichweite|performance)\b/i.test(text)) {
    removals.add("optimization");
  }
  if (/\b(personal wish|wish|status|freedom|freiheit|childhood|kindheit|erinnerung)\b/i.test(text)) {
    removals.add("personal_wish");
  }
  if (/\b(location|ort|wien|graz|linz|salzburg|plz)\b/i.test(text)) removals.add("location");
  return removals;
}

export function looksLikeNoBudgetLimit(text: string) {
  return /\b(no budget(?: limit)?|no price limit|no limit|unlimited budget|budget does(?:n'?t)? matter|budget is irrelevant|price does(?:n'?t)? matter|money (?:is|does)(?:\s+not|n't) (?:the main )?concern|money does(?:n'?t)? matter|kein budget(?:limit)?|kein limit|budget egal|preis egal|geld (?:spielt )?keine rolle)\b/i.test(
    text
  );
}

function extractBudgetRange(text: string) {
  const rangePattern =
    /(?:€|eur|euro)?\s*(\d{1,3}(?:[.,]\d{3})+|\d{1,3})\s*(k|tsd|000)?\s*(?:-|–|to|bis)\s*(\d{1,3}(?:[.,]\d{3})+|\d{1,3})\s*(k|tsd|000)?(?:\s*(?:€|eur|euro))?/gi;
  const betweenPattern =
    /between\s+(\d{1,3}(?:[.,]\d{3})+|\d{1,3})\s*(k|tsd|000)?\s+and\s+(\d{1,3}(?:[.,]\d{3})+|\d{1,3})\s*(k|tsd|000)?/gi;

  for (const pattern of [rangePattern, betweenPattern]) {
    const match = pattern.exec(text);
    if (!match) continue;
    const min = parseBudgetAmount(match[1], match[2]);
    const max = parseBudgetAmount(match[3], match[4]);
    if (min !== null && max !== null && min < max) {
      return { min, max };
    }
  }

  return { min: null, max: null };
}

function parseBudgetAmount(raw: string, suffix: string | undefined) {
  const number = Number(raw.replace(/[.,]/g, ""));
  if (!Number.isFinite(number)) return null;
  const multiplier = suffix ? 1000 : number <= 120 ? 1000 : 1;
  const value = number * multiplier;
  if (value >= 10000 && value <= 150000) return value;
  return null;
}

function extractBudget(text: string, monthly: boolean) {
  const monthlyContext = /(month|monthly|lease|leasing|rate|monat|monatlich|leasingrate)/i;
  const amountPattern = /(?:€|eur|euro)?\s?(\d{1,3}(?:[.,]\d{3})+|\d{4,6}|\d{1,3})\s?(k|tsd|000)?\s?(?:€|eur|euro)?/gi;
  const matches = Array.from(text.matchAll(amountPattern));

  for (const match of matches) {
    const windowStart = Math.max(0, match.index ? match.index - 28 : 0);
    const windowEnd = Math.min(text.length, (match.index ?? 0) + match[0].length + 28);
    const context = text.slice(windowStart, windowEnd);
    const isMonthly = monthlyContext.test(context);
    if (isMonthly !== monthly) continue;

    const raw = match[1].replace(/[.,]/g, "");
    const number = Number(raw);
    if (!Number.isFinite(number)) continue;
    const multiplier = match[2] ? 1000 : number <= 120 && !monthly ? 1000 : 1;
    const value = number * multiplier;
    if (monthly && value >= 150 && value <= 2000) return value;
    if (!monthly && value >= 10000 && value <= 150000) return value;
  }

  return null;
}

function extractKm(text: string, mode: "daily" | "range") {
  const matches = Array.from(text.matchAll(/(\d{2,4})\s?(km|kilometer)/gi));
  for (const match of matches) {
    const index = match.index ?? 0;
    const context = text.slice(Math.max(0, index - 34), Math.min(text.length, index + 48));
    const value = Number(match[1]);
    const isMileage = /(mileage|odometer|kilometerstand|km stand|km-stand|gelaufen|laufleistung|low km|wenig kilometer)/i.test(context);
    if (isMileage) continue;
    const isDaily = /(daily|per day|a day|commute|pendel|tag|täglich|taeglich|arbeitsweg)/i.test(context);
    const isRange = /(range|reichweite|single charge|ladung|autobahn)/i.test(context);
    if (mode === "daily" && isDaily && value <= 400) return value;
    if (mode === "range" && (isRange || value > 250)) return value;
  }
  return null;
}

function extractMileageKm(text: string, mode: "max" | "target") {
  const explicit = Array.from(
    text.matchAll(
      /(?:under|below|max(?:imum)?|less than|bis|maximal|unter|weniger als)?\s*(\d{1,3}(?:[.,]\d{3})+|\d{4,6}|\d{1,3})\s?(k|000)?\s?(?:km|kilometer)\b/gi
    )
  );

  for (const match of explicit) {
    const index = match.index ?? 0;
    const context = text.slice(Math.max(0, index - 42), Math.min(text.length, index + 64));
    if (!/(mileage|odometer|kilometerstand|km stand|km-stand|gelaufen|laufleistung|low km|wenig kilometer)/i.test(context)) {
      continue;
    }
    const raw = match[1].replace(/[.,]/g, "");
    const number = Number(raw);
    if (!Number.isFinite(number)) continue;
    const value = number * (match[2] || number < 500 ? 1000 : 1);
    if (value >= 1 && value <= 250000) return value;
  }

  const inferred = inferMileagePreference(text);
  return mode === "max" ? inferred.max : inferred.target;
}

function inferMileagePreference(text: string) {
  if (/(very low km|very low mileage|sehr wenig kilometer|kaum kilometer|tageszulassung)/i.test(text)) {
    return { max: null, target: 15000 };
  }
  if (/(low km|low mileage|few kilometer|wenig kilometer|niedriger kilometerstand|geringe laufleistung)/i.test(text)) {
    return { max: null, target: 30000 };
  }
  return { max: null, target: null };
}

function extractBatteryHealth(text: string) {
  const percent = text.match(/(?:soh|state of health|battery health|batteriegesundheit|akku(?:zustand)?)[^\d]{0,24}(\d{2,3})\s?%/i);
  const required = /\b(must|required|only|at least|minimum|min\.?|mindestens|nur|pflicht)\b/i.test(text);
  if (percent) {
    const value = Number(percent[1]);
    return {
      min: Number.isFinite(value) ? Math.min(100, Math.max(70, value)) : null,
      required
    };
  }
  if (/(excellent|very good|strong|healthy|good battery health|gute batteriegesundheit|guter akku|batteriegesundheit wichtig|akku gesund)/i.test(text)) {
    return {
      min: /(excellent|very good|sehr gut)/i.test(text) ? 92 : 90,
      required
    };
  }
  return { min: null, required: false };
}

function extractChargingAccess(text: string): ChargingAccess | null {
  if (/(public charg|öffentlich laden|keine wallbox|ohne wallbox|no home charg|wohnung|apartment)/i.test(text)) {
    return "public";
  }
  if (/(wallbox|garage|home charg|zu hause laden|eigene ladestation|private ladestation)/i.test(text)) {
    return "home";
  }
  if (/(work charg|office charg|firma laden|arbeit laden)/i.test(text)) return "work";
  if (/(no charging|keine lademöglichkeit)/i.test(text)) return "none";
  return null;
}

function extractCondition(text: string): VehicleCondition | "any" | null {
  if (/\b(new|neu|neue|neues|neuer|neuwagen)\b/i.test(text)) return "new";
  if (/\b(used|gebraucht|gebrauchte|gebrauchter|gebrauchtes|gebrauchtwagen|second hand)\b/i.test(text)) {
    return "used";
  }
  return null;
}

function extractPassengers(text: string) {
  if (/\b(2|two)[-\s]?(seater|sitzer)\b/i.test(text)) return 2;
  const explicit = text.match(/(\d)\s?(people|persons|passengers|sitze|personen|kids|children|kinder)/i);
  if (explicit) return Number(explicit[1]);
  const seatVerb = text.match(/\b(?:seat|seats|sitze?)\s?(\d)\b/i);
  if (seatVerb) return Number(seatVerb[1]);
  if (/(family|familie|kinder|child|kids)/i.test(text)) return 4;
  return null;
}

function extractCargoNeeds(text: string): UserCriteria["cargoNeeds"] {
  if (
    /(large trunk|big boot|big cargo|large cargo|viel stauraum|großer kofferraum|grosser kofferraum|kinderwagen|ski|mountain\s*bike|bike\s*rack|fahrrad|e-?bike|stroller)/i.test(
      text
    )
  ) {
    return "high";
  }
  if (/(some cargo|weekend bags|einkauf|medium trunk)/i.test(text)) return "medium";
  if (/(easy parking|city only|stadt|klein)/i.test(text)) return "low";
  return null;
}

function extractQualitativeSignals(text: string): QualitativeSignal[] {
  const signals: QualitativeSignal[] = [];
  if (/(premium|luxury|hochwertig|wertig|komfort|comfort|leather|leder|quiet|ruhig)/i.test(text)) {
    signals.push("premium");
  }
  if (/(low km|low mileage|wenig kilometer|niedriger kilometerstand|geringe laufleistung)/i.test(text)) {
    signals.push("low_mileage");
  }
  if (/(battery health|batteriegesundheit|akku gesund|good battery|soh)/i.test(text)) {
    signals.push("good_battery_health");
  }
  if (/(reliable|reliability|zuverlässig|zuverlaessig|haltbar|warranty|garantie)/i.test(text)) {
    signals.push("reliable");
  }
  if (/(road trip|langstrecke|autobahn|weekend|wochenende|urlaub)/i.test(text)) {
    signals.push("road_trip_comfort");
  }
  if (/(fast charging|schnellladen|ladeleistung|800v|800 volt)/i.test(text)) {
    signals.push("fast_charging");
  }
  if (/(value|good deal|preiswert|günstig|guenstig|low running costs|niedrige kosten)/i.test(text)) {
    signals.push("good_value");
  }
  if (/(safety|safe|sicher|assistenz|totwinkel|lane|spur)/i.test(text)) {
    signals.push("safety");
  }
  if (/(technology|tech|software|ota|display|infotainment|connectivity|konnektivität)/i.test(text)) {
    signals.push("technology");
  }
  if (/(public charging|öffentlich laden|oeffentlich laden|wohnung|apartment|keine wallbox|ohne wallbox)/i.test(text)) {
    signals.push("public_charging_fit");
  }
  return signals;
}

export function extractOptimizationDirective(text: string): OptimizationDirective | null {
  const cleaned = stripNegatedTopicPhrases(text);

  // Value-for-money before performance so "price-to-performance" is not misread as sporty.
  if (/(best value|value for money|price[-\s]?to[-\s]?performance|price performance|bang for buck|preis[-\s]?leistung|preiswert|gutes angebot|bestes angebot)/i.test(cleaned)) {
    return "best_value";
  }
  if (/(fastest charging|best charging|schnellladen|schnellste ladung|beste ladeleistung|800v|800 volt)/i.test(cleaned)) {
    return "fastest_charging";
  }
  // Sports / performance before family so "forget the family car … sports EV" resolves correctly.
  // Keep "schnell" as a whole word so Schnellladen is not misread as sporty.
  if (/(?:\bperformance\b|\bsporty\b|\bsports?\b|quick|fast acceleration|\bschnell\b|sportlich|beschleunigung|fahrspaß|fahrspass)/i.test(cleaned)) {
    return "performance";
  }
  if (
    /(maximum(?:\s+\w+){0,2}\s+range|max(?:imum)? reichweite|maximale reichweite|most range|longest range|possible range|größte reichweite|groesste reichweite|hoechste reichweite|höchste reichweite)/i.test(
      cleaned
    )
  ) {
    return "maximum_range";
  }
  if (/(most reliable|reliability first|zuverlässigst|zuverlaessigst|am zuverlässigsten|am zuverlaessigsten|haltbar(st)?)/i.test(cleaned)) {
    return "most_reliable";
  }
  if (/(lowest running cost|low(?:est)? running costs|cheapest to run|niedrigste laufende kosten|niedrige kosten|verbrauch optimieren)/i.test(cleaned)) {
    return "lowest_running_cost";
  }
  if (/(best family fit|family fit|familienfreundlich|beste familie|familienauto|family car)/i.test(cleaned)) {
    return "best_family_fit";
  }
  return null;
}

/** Drop phrases that were explicitly abandoned (forget X / instead of X) before directive extraction. */
function stripNegatedTopicPhrases(text: string) {
  return text
    .replace(
      /\b(?:forget(?:\s+(?:about|the|that|previous))?|statt|statt dessen|instead of|rather than|nicht mehr)\b[^.\n]{0,48}\b(?:family(?:\s+car)?|familie|familienauto|suv|kids?|kinder)\b/gi,
      " "
    )
    .replace(/\b(?:forget that|vergiss das)\b/gi, " ");
}

export function extractPersonalWish(text: string): PersonalWish | null {
  if (
    /\b(fond\s+)?childhood(\s+memories?)?\b/i.test(text) ||
    /\bkindheit(s)?(erinnerungen?)?\b/i.test(text) ||
    /\berinnerungen?\s+an\s+die\s+kindheit\b/i.test(text)
  ) {
    return "childhood_memories";
  }
  if (/\bfreedom\b/i.test(text) || /\bfreiheit\b/i.test(text)) {
    return "freedom";
  }
  if (/\bstatus\b/i.test(text) || /\bprestige\b/i.test(text) || /\bansehen\b/i.test(text)) {
    return "status";
  }
  return null;
}

export function constraintSourceText(criteria: UserCriteria) {
  const latest = (criteria.latestUserMessage || "").trim();
  const raw = (criteria.rawPrompt || "").trim();
  if (!latest) return raw;
  if (!raw || raw === latest) return latest;
  // Thin chip / nudge replies must not wipe exclusivity established earlier in the thread.
  // Real pivots ("only Ford", "actually a 2-seater") still win via the latest message.
  if (isThinConstraintReply(latest)) return raw;
  return latest;
}

function isThinConstraintReply(message: string) {
  const words = message.split(/\s+/).filter(Boolean);
  if (
    /^(best value|maximum range|reliability|family fit|fastest charging|lowest running cost|performance|bestes preis(?:-leistungs-verhältnis)?|maximale reichweite|zuverlässigkeit|familientauglichkeit|schnellstes laden|niedrigste laufende kosten|fahrspaß|fahrspass)\b/i.test(
      message
    )
  ) {
    return true;
  }
  // One/two-word chip taps ("Thanks", "SUV", "Home charging") stay thin; longer soft follow-ups
  // like "preferably something efficient" must redefine exclusivity from the latest turn.
  return words.length <= 2;
}

export function hasHardRangeConstraint(criteria: UserCriteria) {
  if (!criteria.rangeFloorKm) return false;
  return /(?:\b\d{2,4}\s?(?:km|kilometer)\b[^.\n]{0,36}\b(?:range|reichweite|single charge|ladung|autobahn)\b|\b(?:range|reichweite|single charge|ladung|autobahn)\b[^.\n]{0,36}\b\d{2,4}\s?(?:km|kilometer)\b|\b(?:at least|minimum|min\.?|must|need|require|mindestens|min(?:dest)?|brauche|benötige|benoetige)\b[^.\n]{0,40}\b\d{2,4}\s?(?:km|kilometer)\b)/i.test(
    constraintSourceText(criteria)
  );
}

export function hasHardPassengerConstraint(criteria: UserCriteria) {
  if (!criteria.passengers) return false;
  return /(?:\b(?:must|need|needs|required|require|requires|only|at least|minimum|min\.?|mindestens|nur|brauche|benötige|benoetige)\b[^.\n]{0,36}\b\d\s?(?:seats?|sitze|personen|passengers)\b|\b(?:must|need|needs|required|require|requires|only|at least|minimum|min\.?|mindestens|nur|brauche|benötige|benoetige)\b[^.\n]{0,36}\b(?:seat|seats|sitze?)\s?\d\b|\b(?:2|two)[-\s]?(?:seater|sitzer)\b)/i.test(
    constraintSourceText(criteria)
  );
}

/** "2-seater" / "zweisitzer" / "only 2 seats" — prefer exact capacity, not merely seats >= N. */
export function hasExactSeatPreference(criteria: UserCriteria) {
  if (!criteria.passengers) return false;
  return /\b(?:\d|two|three|four|five|six|zwei|drei|vier|fünf|fuenf|sechs)[-\s]?(?:seater|sitzer)\b|\b(?:only|nur)\s+\d\s?(?:seats?|sitze|personen)\b/i.test(
    constraintSourceText(criteria)
  );
}

/** Quantity / floor language — used for range and seats. */
const exclusiveCue =
  /\b(only|must|need|needs|required|require|requires|at least|minimum|min\.?|mindestens|nur|brauche|benötige|benoetige|ausschließlich|ausschliesslich)\b/i;

/**
 * Strong exclusivity for body / condition / brand / origin.
 * Bare "need/brauche" is everyday shopping language ("I need a compact EV") and must stay soft.
 */
const strictExclusiveCue =
  /\b(only|just|must(?:\s+be)?|required|require|requires|has to be|needs to be|mindestens|nur|ausschließlich|ausschliesslich)\b/i;

export function hasHardBodyTypeConstraint(criteria: UserCriteria) {
  if (!criteria.bodyTypes.length) return false;
  const text = constraintSourceText(criteria);
  return (
    strictExclusiveCue.test(text) &&
    /\b(suv|sedan|hatchback|wagon|van|compact|coupe|crossover|limousine|kombi|kleinwagen)\b/i.test(text)
  );
}

export function hasHardConditionConstraint(criteria: UserCriteria) {
  if (criteria.preferredCondition === "any") return false;
  const text = constraintSourceText(criteria);
  return strictExclusiveCue.test(text) && /\b(new|used|neu|gebraucht(?:e|es|er)?|new car|used car)\b/i.test(text);
}

export function hasHardBrandConstraint(criteria: UserCriteria) {
  if (!criteria.brandPreferences.length) return false;
  if (criteria.modelPreferences.length) return true;
  const text = constraintSourceText(criteria);
  return (
    strictExclusiveCue.test(text) &&
    criteria.brandPreferences.some((brand) => new RegExp(`\\b${escapeRegExp(brand)}\\b`, "i").test(text))
  );
}

export function hasHardBrandOriginConstraint(criteria: UserCriteria) {
  if (!criteria.preferredBrandOrigins.length) return false;
  const text = constraintSourceText(criteria);
  return (
    strictExclusiveCue.test(text) &&
    /\b(european|europe|europäisch|europaeisch|chinese|china|chinesisch|korean|korea|american|usa|us)\b/i.test(text)
  );
}

function extractBodyTypes(text: string) {
  const bodyTypes = bodyTypeKeywords
    .filter(([, pattern]) => pattern.test(text))
    .map(([bodyType]) => bodyType);
  if (bodyTypes.includes("compact") && !bodyTypes.includes("hatchback")) {
    bodyTypes.push("hatchback");
  }
  return bodyTypes;
}

function extractTripNeeds(text: string): TripNeed[] {
  const tripNeeds: TripNeed[] = [];
  if (/(city|urban|stadt|stadtfahr|inner city|short trips?|errands?|einkauf|wien|graz|linz|salzburg)/i.test(text)) {
    tripNeeds.push("city");
  }
  if (/(commute|commuting|pendel|arbeitsweg|daily|täglich|taeglich|office|work(?:ing)?)/i.test(text)) {
    tripNeeds.push("commute");
  }
  if (
    /(road\s*trip|autobahn|long\s*(trip|drive|distance)|langstrecke|urlaub|weekend|wochenende|highway|motorway|vacation|holiday)/i.test(
      text
    ) ||
    /(cruis|leisure|joy\s*rid|pleasure\s*driv|fun\s*driv|sightseeing|scenic|touring|spazier|ausflug)/i.test(text) ||
    /(?:for\s+)?trips?|reisen|fahrten|travels?/i.test(text)
  ) {
    tripNeeds.push("road_trip");
  }
  if (/(family|familie|kinder|kids|children|school run)/i.test(text)) tripNeeds.push("family");
  if (/(winter|snow|schnee|berge|ski|alpen)/i.test(text)) tripNeeds.push("winter");
  return tripNeeds;
}

function extractFeatures(text: string) {
  return featureKeywords.filter(([, pattern]) => pattern.test(text)).map(([feature]) => feature);
}

function extractBrandPreferences(text: string) {
  const avoided = new Set(extractAvoidedBrands(text).map((brand) => brand.toLowerCase()));
  const explicit = brandNames.filter((brand) => {
    if (avoided.has(brand.toLowerCase())) return false;
    if (isBrandMentionNegated(text, brand)) return false;
    return new RegExp(`\\b${escapeRegExp(brand.toLowerCase())}\\b`, "i").test(text);
  });
  return Array.from(new Set(explicit));
}

function extractPreferredBrandOrigins(text: string): BrandOrigin[] {
  const origins: BrandOrigin[] = [];
  if (/(chinese|china|chinesisch|chinesisches|chinesische)/i.test(text)) origins.push("china");
  if (/(korean|korea|koreanisch|koreanische|koreanisches|suedkorea|südkorea|south korea)/i.test(text)) {
    origins.push("korea");
  }
  if (/(american|usa|u\.s\.|united states|us-made|amerikanisch|amerikanische|amerikanisches)/i.test(text)) {
    origins.push("us");
  }
  if (/(european|europe|europäisch|europaeisch|europa)/i.test(text)) origins.push("europe");
  return Array.from(new Set(origins));
}

function extractModelPreferences(text: string) {
  const explicit = modelAliases
    .filter(([, pattern]) => pattern.test(text))
    .map(([model]) => model);

  return Array.from(new Set(explicit));
}

function extractAvoidedBrands(text: string) {
  const avoided: string[] = [];
  for (const brand of brandNames) {
    if (isBrandMentionNegated(text, brand)) avoided.push(brand);
  }
  return avoided;
}

/** True when a brand appears in a negation / exclusion phrase. */
function isBrandMentionNegated(text: string, brand: string) {
  const escaped = escapeRegExp(brand.toLowerCase());
  return new RegExp(
    `\\b(?:not|avoid|avoiding|without|except|no|kein|keine|keinen|keinem|ohne|nicht)\\s+${escaped}\\b|\\b${escaped}\\s+(?:is\\s+)?(?:out|excluded|vermeiden)\\b|\\bno\\s+${escaped}\\s+please\\b`,
    "i"
  ).test(text);
}

function deriveBrandFit(text: string, brandPreferences: string[], previous: Importance): Importance {
  if (/\b(brand is very important|specific brand|nur diese marke|marke sehr wichtig)\b/i.test(text)) return "high";
  if (brandPreferences.length) return previous === "high" ? "high" : "medium";
  if (/\b(any brand|brand egal|marke egal|no brand preference)\b/i.test(text)) return "low";
  return previous;
}

function deriveReliabilityImportance(
  text: string,
  qualitativeSignals: QualitativeSignal[],
  previous: Importance
): Importance {
  if (/\b(reliability very important|must be reliable|zuverlässigkeit sehr wichtig|zuverlaessigkeit sehr wichtig)\b/i.test(text)) {
    return "high";
  }
  if (qualitativeSignals.includes("reliable") || qualitativeSignals.includes("good_battery_health")) {
    return previous === "high" ? "high" : "medium";
  }
  if (/\b(reliability not important|zuverlässigkeit egal|zuverlaessigkeit egal)\b/i.test(text)) return "low";
  return previous;
}

function inferQualitativeRangeFloor(text: string, tripNeeds: TripNeed[]) {
  if (/(good range|long range|great range|strong range|gute reichweite|hohe reichweite|lange reichweite)/i.test(text)) {
    return tripNeeds.includes("road_trip") ? 450 : 380;
  }
  return null;
}

function extractLocation(prompt: string) {
  const plz = prompt.match(/\b([1-9]\d{3})\b/);
  if (plz) return plz[1];
  const city = prompt.match(/\b(Vienna|Wien|Graz|Linz|Salzburg|Innsbruck|Klagenfurt)\b/i);
  if (!city?.[1]) return null;
  return /^vienna$/i.test(city[1]) ? "Wien" : city[1];
}

function mergeUnique<T>(left: T[], right: T[]) {
  return Array.from(new Set([...left, ...right]));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
