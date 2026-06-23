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
      en: "This is the most you'd want to spend on the car's purchase price. It's a hard limit, so I never show cars above it. Pick a range below, type an exact number, or choose no limit.",
      de: "Das ist der maximale Kaufpreis, den du ausgeben möchtest. Es ist eine harte Grenze – teurere Autos zeige ich nie. Wähle eine Spanne, nenne eine genaue Zahl oder wähle kein Limit."
    },
    selectMode: "single",
    options: [
      { id: "budget_under_25k", label: { en: "Under €25,000", de: "Unter 25.000 €" }, patch: { budgetMaxEUR: 25000 } },
      { id: "budget_25_40k", label: { en: "€25,000–40,000", de: "25.000–40.000 €" }, patch: { budgetMinEUR: 25000, budgetMaxEUR: 40000 } },
      { id: "budget_40_60k", label: { en: "€40,000–60,000", de: "40.000–60.000 €" }, patch: { budgetMaxEUR: 60000 } },
      { id: "budget_over_60k", label: { en: "Over €60,000", de: "Über 60.000 €" }, patch: { budgetMaxEUR: 90000 } },
      skipOption("budget_skip", "No budget limit", "Kein Budgetlimit")
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
      en: "Where will you usually charge?",
      de: "Wo wirst du normalerweise laden?"
    },
    explanation: {
      en: "Charging is about where you'll plug in most of the time: at home on a wallbox, at work, or only at public stations. If you mostly use public charging, I'll favor longer range and faster charging. Not sure? That's fine too.",
      de: "Beim Laden geht es darum, wo du meistens lädst: zu Hause an der Wallbox, bei der Arbeit oder nur an öffentlichen Stationen. Wenn du vor allem öffentlich lädst, bevorzuge ich mehr Reichweite und schnelleres Laden. Unsicher? Auch okay."
    },
    selectMode: "single",
    options: [
      { id: "charge_home", label: { en: "Home / wallbox", de: "Zu Hause / Wallbox" }, patch: { chargingAccess: "home" } },
      { id: "charge_work", label: { en: "At work", de: "Bei der Arbeit" }, patch: { chargingAccess: "work" } },
      { id: "charge_public", label: { en: "Public only", de: "Nur öffentlich" }, patch: { chargingAccess: "public" } },
      skipOption("charge_skip", "Not sure yet", "Noch unklar")
    ]
  },
  vehicle_preferences: {
    question: {
      en: "Any body style you prefer? (pick any that apply)",
      de: "Bevorzugst du eine Karosserieform? (mehrere möglich)"
    },
    explanation: {
      en: "This is the shape of the car — an SUV for space and height, a compact for easy city parking, a sedan, a wagon for cargo, or a van for maximum room. Pick any that appeal, or skip if you're open to anything.",
      de: "Es geht um die Form des Autos – ein SUV für Platz und Höhe, ein Kompakter fürs einfache Parken, eine Limousine, ein Kombi für Stauraum oder ein Van für maximalen Platz. Wähle, was dir gefällt, oder überspringe, wenn du offen bist."
    },
    selectMode: "multi",
    options: [
      { id: "body_suv", label: { en: "SUV", de: "SUV" }, patch: { bodyTypes: ["suv"] } },
      { id: "body_compact", label: { en: "Compact", de: "Kompakt" }, patch: { bodyTypes: ["compact", "hatchback"] } },
      { id: "body_sedan", label: { en: "Sedan", de: "Limousine" }, patch: { bodyTypes: ["sedan"] } },
      { id: "body_wagon", label: { en: "Wagon", de: "Kombi" }, patch: { bodyTypes: ["wagon"] } },
      { id: "body_van", label: { en: "Van", de: "Van" }, patch: { bodyTypes: ["van"] } },
      skipOption("vehicle_preferences_skip", "No preference", "Egal")
    ]
  }
};

const readyStep: { question: { en: string; de: string }; explanation: { en: string; de: string } } = {
  question: {
    en: "Great — I have enough to find good matches. Let me search now.",
    de: "Super – ich habe genug, um gute Treffer zu finden. Ich suche jetzt."
  },
  explanation: {
    en: "I can rank real listings against everything you've told me so far.",
    de: "Ich kann echte Angebote anhand deiner bisherigen Angaben ranken."
  }
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
  return key === "ready" ? readyStep.explanation[language] : catalog[key].explanation[language];
}

export function isMissingCriteriaKey(value: unknown): value is MissingCriteria {
  return value === "budget" || value === "use_case" || value === "charging_or_range" || value === "vehicle_preferences";
}
