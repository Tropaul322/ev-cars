import type { TripNeed, UserCriteria } from "./types.ts";

export type VehicleSearchLexicon = {
  ftsTokens: string[];
  embeddingPhrases: string[];
};

/** Style adjectives — embedding-only; not present in vehicles.search_document. */
const PERFORMANCE_STYLE_TOKENS = [
  "sporty",
  "sportlich",
  "performance",
  "fahrspass",
  "fahrspaß"
];
/** Body/style forms that can appear in title/body_type/notes. */
const PERFORMANCE_BODY_TOKENS = ["roadster", "coupe", "cabrio", "convertible"];

/** Query-side trip adjectives — embedding-only. */
const CITY_STYLE_TOKENS = ["city", "stadt", "commute", "pendeln", "urban"];
/** Document-aligned city/compact body aliases. */
const CITY_DOCUMENT_TOKENS = ["compact", "kleinwagen"];

const FAMILY_STYLE_TOKENS = ["familie", "highway", "autobahn", "road trip", "langstrecke"];
/** "family" appears in search_document via "family seats" for seats >= 5. */
const FAMILY_DOCUMENT_TOKENS = ["family"];

const PUBLIC_CHARGING_TOKENS = [
  "public charging",
  "oeffentlich laden",
  "öffentlich laden",
  "wallbox"
];

export function seatsLexiconTokens(seats: number): string[] {
  const n = Math.max(0, Math.floor(seats));
  const tokens = [`${n} seats`, `${n} sitze`];
  if (n > 0 && n <= 2) {
    tokens.push("2-seater", "two seater", "zweisitzer", "2 sitzer");
  }
  if (n >= 5) {
    tokens.push("family seats", "familienauto");
  }
  return tokens;
}

export function bodyTypeLexiconTokens(bodyType: string): string[] {
  const key = bodyType.trim().toLowerCase();
  const map: Record<string, string[]> = {
    suv: ["suv", "geländewagen", "gelaendewagen"],
    crossover: ["crossover", "suv"],
    sedan: ["sedan", "limousine"],
    hatchback: ["hatchback", "schrägheck", "schraegheck"],
    compact: ["compact", "kleinwagen"],
    wagon: ["wagon", "kombi"],
    van: ["van", "kleinbus"],
    minibus: ["minibus"],
    other: ["other"]
  };
  return map[key] ?? (key ? [key] : []);
}

function uniqueTokens(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const token = value?.trim();
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

function messageSeatHints(message: string): string[] {
  if (/\b(2[-\s]?seater|two[-\s]?seater|zweisitzer|2[-\s]?sitzer)\b/i.test(message)) {
    return seatsLexiconTokens(2);
  }
  if (/\b(4[-\s]?seater|vier[-\s]?sitzer)\b/i.test(message)) {
    return seatsLexiconTokens(4);
  }
  return [];
}

export function expandVehicleSearchLexicon(
  criteria: UserCriteria,
  message = ""
): VehicleSearchLexicon {
  const text = `${message} ${criteria.latestUserMessage ?? ""} ${criteria.rawPrompt ?? ""}`;
  const fts: string[] = [];
  const phrases: string[] = [];

  for (const brand of criteria.brandPreferences) fts.push(brand);
  for (const model of criteria.modelPreferences) fts.push(model);
  for (const body of criteria.bodyTypes) {
    const tokens = bodyTypeLexiconTokens(body);
    fts.push(...tokens);
    phrases.push(...tokens);
  }

  if (criteria.passengers != null) {
    const seatTokens = seatsLexiconTokens(criteria.passengers);
    fts.push(...seatTokens);
    phrases.push(...seatTokens);
  }
  fts.push(...messageSeatHints(text));

  if (criteria.optimizationDirective === "performance" || /\b(sporty|sportlich|performance)\b/i.test(text)) {
    fts.push(...PERFORMANCE_BODY_TOKENS);
    phrases.push(
      ...PERFORMANCE_STYLE_TOKENS,
      ...PERFORMANCE_BODY_TOKENS,
      "sporty performance coupe cabrio roadster sportlich fahrspaß"
    );
  }

  for (const trip of criteria.tripNeeds as TripNeed[]) {
    if (trip === "city" || trip === "commute") {
      fts.push(...CITY_DOCUMENT_TOKENS);
      phrases.push(...CITY_STYLE_TOKENS, ...CITY_DOCUMENT_TOKENS, "city commute stadt pendeln kleinwagen");
    }
    if (trip === "family" || trip === "road_trip") {
      fts.push(...FAMILY_DOCUMENT_TOKENS);
      phrases.push(...FAMILY_STYLE_TOKENS, ...FAMILY_DOCUMENT_TOKENS, "family highway autobahn langstrecke");
    }
    if (trip === "winter") {
      fts.push("winter", "awd", "allrad");
      phrases.push("winter awd allrad");
    }
  }

  if (criteria.chargingAccess === "public" || criteria.qualitativeSignals.includes("public_charging_fit")) {
    fts.push(...PUBLIC_CHARGING_TOKENS);
    phrases.push("public charging ohne wallbox apartment");
  }

  if (criteria.location) fts.push(criteria.location);

  return {
    ftsTokens: uniqueTokens(fts).slice(0, 36),
    embeddingPhrases: uniqueTokens(phrases)
  };
}
