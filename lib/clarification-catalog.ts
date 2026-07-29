import { getMissingCriteria } from "./criteria.ts";
import type {
  ClarificationOption,
  ClarificationPrompt,
  ClarificationPromptKey,
  Language,
  MissingCriteria,
  UserCriteria
} from "./types.ts";

type LocalizedOption = {
  id: string;
  label: { en: string; de: string };
  patch?: ClarificationOption["patch"];
  skip?: boolean;
};

type LocalizedStep = {
  question: { en: string; de: string };
  explanation: { en: string; de: string };
  selectMode: "single" | "multi";
  options: LocalizedOption[];
};

const skipOption = (
  id: string,
  en: string,
  de: string
): LocalizedOption => ({ id, label: { en, de }, skip: true });

const catalog: Record<MissingCriteria, LocalizedStep> = {
  budget: {
    question: {
      en: "What budget works for you?",
      de: "Welches Budget passt für dich?"
    },
    explanation: {
      en: "This is the purchase-price range I should respect. Upper caps are hard limits, so I never show cars above them. Pick a range below or type an exact number.",
      de: "Das ist die Kaufpreis-Spanne, die ich einhalten soll. Obere Grenzen sind hart – teurere Autos zeige ich nie. Wähle eine Spanne oder nenne eine genaue Zahl."
    },
    selectMode: "single",
    options: [
      { id: "budget_under_25k", label: { en: "Under €25,000", de: "Unter 25.000 €" }, patch: { budgetMaxEUR: 25000 } },
      { id: "budget_25_40k", label: { en: "€25,000–40,000", de: "25.000–40.000 €" }, patch: { budgetMinEUR: 25000, budgetMaxEUR: 40000 } },
      { id: "budget_40_60k", label: { en: "€40,000–60,000", de: "40.000–60.000 €" }, patch: { budgetMaxEUR: 60000 } },
      { id: "budget_over_60k", label: { en: "€60,000–90,000", de: "60.000–90.000 €" }, patch: { budgetMinEUR: 60000, budgetMaxEUR: 90000 } },
      { id: "budget_over_90k", label: { en: "Over €90,000", de: "Über 90.000 €" }, patch: { budgetMinEUR: 90000, budgetMaxEUR: null } }
    ]
  },
  use_case: {
    question: {
      en: "What will you mainly use the car for? (pick any that apply)",
      de: "Wofür wirst du das Auto vor allem nutzen? (mehrere möglich)"
    },
    explanation: {
      en: "This is how the car fits your life — short city trips, a daily commute, family duty, longer road trips, or winter and mountain driving. It helps me weigh range, size, and comfort. Pick any that apply.",
      de: "Es geht darum, wie das Auto zu deinem Alltag passt – kurze Stadtfahrten, täglicher Arbeitsweg, Familie, längere Reisen oder Winter- und Bergfahrten. Das hilft mir, Reichweite, Größe und Komfort zu gewichten. Wähle alles Passende."
    },
    selectMode: "multi",
    options: [
      { id: "use_city", label: { en: "City driving", de: "Stadt" }, patch: { tripNeeds: ["city"] } },
      { id: "use_commute", label: { en: "Commuting", de: "Pendeln" }, patch: { tripNeeds: ["commute"] } },
      { id: "use_family", label: { en: "Family", de: "Familie" }, patch: { tripNeeds: ["family"] } },
      { id: "use_road_trip", label: { en: "Road trips", de: "Langstrecke" }, patch: { tripNeeds: ["road_trip"] } },
      { id: "use_winter", label: { en: "Winter / mountains", de: "Winter / Berge" }, patch: { tripNeeds: ["winter"] } },
      skipOption("use_case_skip", "No preference", "Egal")
    ]
  },
  charging_or_range: {
    question: {
      en: "What minimum range do you need?",
      de: "Welche Mindestreichweite brauchst du?"
    },
    explanation: {
      en: "Range is how far the car can go on a charge. Pick a floor for your longest usual trip — chip selections are treated as a hard minimum in search.",
      de: "Reichweite ist, wie weit das Auto mit einer Ladung kommt. Wähle eine Untergrenze für deine längste übliche Strecke — Chip-Auswahl gilt in der Suche als harte Mindestreichweite."
    },
    selectMode: "single",
    options: [
      { id: "range_250", label: { en: "About 250+ km", de: "Etwa 250+ km" }, patch: { rangeFloorKm: 250 } },
      { id: "range_350", label: { en: "About 350+ km", de: "Etwa 350+ km" }, patch: { rangeFloorKm: 350 } },
      { id: "range_450", label: { en: "About 450+ km", de: "Etwa 450+ km" }, patch: { rangeFloorKm: 450 } },
      { id: "range_550", label: { en: "About 550+ km", de: "Etwa 550+ km" }, patch: { rangeFloorKm: 550 } }
    ]
  },
  vehicle_preferences: {
    question: {
      en: "Any body style you prefer? (pick any that apply)",
      de: "Bevorzugst du eine Karosserieform? (mehrere möglich)"
    },
    explanation: {
      en: "This is the shape of the car — an SUV for space and height, a compact for easy city parking, a sedan/limousine, a wagon for cargo, or a van for maximum room. Your chip choice becomes a hard filter across all of these styles.",
      de: "Es geht um die Form des Autos – ein SUV für Platz und Höhe, ein Kompakter fürs einfache Parken, eine Limousine, ein Kombi für Stauraum oder ein Van für maximalen Platz. Deine Chip-Auswahl wird für alle Formen als harter Filter verwendet."
    },
    selectMode: "multi",
    options: [
      { id: "body_suv", label: { en: "SUV", de: "SUV" }, patch: { bodyTypes: ["suv"] } },
      { id: "body_compact", label: { en: "Compact", de: "Kompakt" }, patch: { bodyTypes: ["compact", "hatchback"] } },
      { id: "body_sedan", label: { en: "Sedan", de: "Limousine" }, patch: { bodyTypes: ["sedan"] } },
      { id: "body_wagon", label: { en: "Wagon", de: "Kombi" }, patch: { bodyTypes: ["wagon"] } },
      { id: "body_van", label: { en: "Van", de: "Van" }, patch: { bodyTypes: ["van"] } }
    ]
  },
  personal_wish: {
    question: {
      en: "What personal wish should shape the recommendation?",
      de: "Welcher persönliche Wunsch soll die Empfehlung prägen?"
    },
    explanation: {
      en: "Pick status (prestige / premium feel) or freedom (range and open-road fit). Either is enough; it nudges scoring toward cars that fit that priority.",
      de: "Wähle Status (Prestige / Premium-Gefühl) oder Freiheit (Reichweite und Fernstrecken-Fit). Einer reicht; das verschiebt die Bewertung zu passenden Autos."
    },
    selectMode: "single",
    options: [
      { id: "wish_status", label: { en: "Status", de: "Status" }, patch: { personalWish: "status" } },
      { id: "wish_freedom", label: { en: "Freedom", de: "Freiheit" }, patch: { personalWish: "freedom" } }
    ]
  }
};

const readyStep: { question: { en: string; de: string }; explanation: { en: string; de: string } } = {
  question: {
    en: "Great — I have enough to find good matches. Let me search now.",
    de: "Super – ich habe genug, um gute Treffer zu finden. Ich suche jetzt."
  },
  explanation: {
    en: "I can rank real matching EVs against everything you've told me so far.",
    de: "Ich kann echte passende EVs anhand deiner bisherigen Angaben ranken."
  }
};

const optimizationStep: LocalizedStep = {
  question: {
    en: "What should I optimize for first?",
    de: "Worauf soll ich zuerst optimieren?"
  },
  explanation: {
    en: "This keeps the first recommendation focused instead of rushing into a generic match.",
    de: "So bleibt die erste Empfehlung gezielt, statt zu schnell generisch zu wirken."
  },
  selectMode: "single",
  options: [
    { id: "opt_best_value", label: { en: "Best value", de: "Bestes Preis-Leistungs-Verhältnis" }, patch: { optimizationDirective: "best_value" } },
    { id: "opt_max_range", label: { en: "Maximum range", de: "Maximale Reichweite" }, patch: { optimizationDirective: "maximum_range" } },
    { id: "opt_reliable", label: { en: "Reliability", de: "Zuverlässigkeit" }, patch: { optimizationDirective: "most_reliable" } },
    { id: "opt_family", label: { en: "Family fit", de: "Familientauglichkeit" }, patch: { optimizationDirective: "best_family_fit" } },
    { id: "opt_fast_charging", label: { en: "Fastest charging", de: "Schnellstes Laden" }, patch: { optimizationDirective: "fastest_charging" } },
    { id: "opt_running_cost", label: { en: "Lowest running cost", de: "Niedrigste laufende Kosten" }, patch: { optimizationDirective: "lowest_running_cost" } },
    { id: "opt_performance", label: { en: "Performance", de: "Fahrspaß / Performance" }, patch: { optimizationDirective: "performance" } }
  ]
};

function localizeOption(option: LocalizedOption, language: Language): ClarificationOption {
  return {
    id: option.id,
    label: option.label[language],
    ...(option.patch ? { patch: option.patch } : {}),
    ...(option.skip ? { skip: true } : {})
  };
}

export function getClarificationPrompt(key: MissingCriteria, language: Language): ClarificationPrompt {
  const step = catalog[key];
  return {
    key,
    question: step.question[language],
    explanation: step.explanation[language],
    selectMode: step.selectMode,
    options: step.options.map((option) => localizeOption(option, language)),
    showMatchAction: false
  };
}

export function getReadyPrompt(language: Language): ClarificationPrompt {
  return {
    key: "ready",
    question: readyStep.question[language],
    explanation: readyStep.explanation[language],
    selectMode: "single",
    options: [],
    showMatchAction: false
  };
}

export function getOptimizationPrompt(language: Language): ClarificationPrompt {
  return {
    key: "optimization",
    question: optimizationStep.question[language],
    explanation: optimizationStep.explanation[language],
    selectMode: optimizationStep.selectMode,
    options: optimizationStep.options.map((option) => localizeOption(option, language)),
    showMatchAction: false
  };
}

const preferredColorStep: LocalizedStep = {
  question: {
    en: "Is there a preferred color you like?",
    de: "Gibt es eine Farbe, die du bevorzugst?"
  },
  explanation: {
    en: "Optional — I can already search for the exact model. Pick a color to prefer matching exteriors, or skip if any color works.",
    de: "Optional — ich kann das genaue Modell schon suchen. Wähle eine bevorzugte Farbe oder überspringe, wenn jede Farbe passt."
  },
  selectMode: "single",
  options: [
    { id: "color_black", label: { en: "Black", de: "Schwarz" }, patch: { preferredColors: ["black"] } },
    { id: "color_white", label: { en: "White", de: "Weiß" }, patch: { preferredColors: ["white"] } },
    { id: "color_blue", label: { en: "Blue", de: "Blau" }, patch: { preferredColors: ["blue"] } },
    { id: "color_grey", label: { en: "Grey", de: "Grau" }, patch: { preferredColors: ["grey"] } },
    { id: "color_silver", label: { en: "Silver", de: "Silber" }, patch: { preferredColors: ["silver"] } },
    { id: "color_red", label: { en: "Red", de: "Rot" }, patch: { preferredColors: ["red"] } },
    {
      id: "color_any",
      label: { en: "No preference", de: "Keine Präferenz" },
      skip: true,
      patch: { acceptAnyColor: true, preferredColors: [] }
    }
  ]
};

export function getPreferredColorPrompt(language: Language): ClarificationPrompt {
  return {
    key: "preferred_color",
    question: preferredColorStep.question[language],
    explanation: preferredColorStep.explanation[language],
    selectMode: preferredColorStep.selectMode,
    options: preferredColorStep.options.map((option) => localizeOption(option, language)),
    showMatchAction: false
  };
}

/**
 * Picks the next clarification prompt for the current criteria, skipping any
 * groups the user has explicitly waved off. Returns the ready prompt once every
 * outstanding group is either satisfied or skipped.
 */
export function nextClarificationPrompt(
  criteria: UserCriteria,
  skippedKeys: MissingCriteria[] = []
): ClarificationPrompt {
  const skipped = new Set(skippedKeys);
  const target = getMissingCriteria(criteria).find((key) => !skipped.has(key));
  return target ? getClarificationPrompt(target, criteria.language) : getReadyPrompt(criteria.language);
}

export function getPromptExplanation(
  key: ClarificationPromptKey,
  language: Language
): string {
  if (key === "ready") return readyStep.explanation[language];
  if (key === "optimization") return optimizationStep.explanation[language];
  if (key === "preferred_color") return preferredColorStep.explanation[language];
  return catalog[key].explanation[language];
}

export function isMissingCriteriaKey(value: unknown): value is MissingCriteria {
  return (
    value === "budget" ||
    value === "use_case" ||
    value === "charging_or_range" ||
    value === "vehicle_preferences" ||
    value === "personal_wish"
  );
}
