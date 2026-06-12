// Shared helpers for the structured source parsers (PoC port).
//
// Parsers emit the project's RawListing shape so everything flows through the
// existing normalizeInventoryListing() -> Vehicle pipeline.
import type { BodyType, VehicleCondition } from "../../lib/types.ts";
import { sha256 } from "../html.ts";
import type { InventorySourceConfig, RawListing } from "../types.ts";

export type ParserContext = {
  maxRows: number;
  crawledAt: string;
};

type RawListingSeed = Partial<RawListing> & {
  listingUrl: string;
  title: string | null;
};

// Build a complete RawListing from the fields a parser could extract,
// defaulting everything else so the normalizer's inference can take over.
export function makeRawListing(source: InventorySourceConfig, crawledAt: string, seed: RawListingSeed): RawListing {
  const text = seed.text ?? "";
  return {
    sourceId: source.id,
    source: source.source,
    sourceName: source.name,
    sourceUrl: source.url,
    canonicalUrl: null,
    sourceListingId: null,
    crawledAt,
    fetchedAt: crawledAt,
    priceEUR: null,
    priceLabel: null,
    condition: source.conditionHint ?? null,
    mileageKm: null,
    year: null,
    firstRegistration: null,
    make: null,
    model: null,
    trim: null,
    rangeKm: null,
    batteryKwh: null,
    efficiencyKwhPer100Km: null,
    bodyType: null,
    location: null,
    sellerName: null,
    sellerType: source.sellerTypeHint ?? "unknown",
    exteriorColor: null,
    doors: null,
    transmission: null,
    powerKw: null,
    warranty: null,
    features: [],
    images: [],
    imageDetails: [],
    vin: null,
    htmlHash: sha256(text || seed.listingUrl),
    ...seed,
    text
  };
}

// "€ 21 590" / "€ 21.590,-" -> 21590
export function parseEuro(value: unknown) {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/[^\d.,]/g, "").replace(/[.,]/g, "");
  if (!digits) return null;
  const parsed = parseInt(digits, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

// "79 088 km" -> 79088
export function parseInteger(value: unknown) {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/[^\d]/g, "");
  if (!digits) return null;
  const parsed = parseInt(digits, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

// "11/2020" or "new" -> 2020 / null
export function yearFromText(value: unknown) {
  if (!value) return null;
  const match = String(value).match(/(19|20)\d{2}/);
  return match ? parseInt(match[0], 10) : null;
}

// "336 km Reichweite" -> 336
export function parseRangeKm(value: unknown) {
  if (!value) return null;
  const match = String(value).match(/(\d[\d.\s]*)\s*km/i);
  if (!match) return null;
  const parsed = parseInt(match[1].replace(/[^\d]/g, ""), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

// Battery capacity often appears as "71 kWh" in the model version string.
// Negative lookahead for "/" avoids matching the "kWh" inside an efficiency
// figure like "25,8 kWh/100 km"; packs are ~20-250 kWh.
export function parseBatteryKwh(value: unknown) {
  if (!value) return null;
  const match = String(value).match(/(\d{2,3}(?:[.,]\d)?)\s*kwh(?!\s*\/)/i);
  if (!match) return null;
  const parsed = parseFloat(match[1].replace(",", "."));
  return !Number.isNaN(parsed) && parsed >= 20 && parsed <= 250 ? parsed : null;
}

// "25,8 kWh/100 km (komb.)" -> 25.8
export function parseEfficiency(value: unknown) {
  if (!value) return null;
  const match = String(value).match(/([\d.,]+)\s*kwh\/100/i);
  if (!match) return null;
  const parsed = parseFloat(match[1].replace(",", "."));
  return Number.isNaN(parsed) ? null : parsed;
}

const conditionMap: Record<string, VehicleCondition> = {
  new: "new",
  neu: "new",
  neuwagen: "new",
  used: "used",
  gebraucht: "used",
  demo: "used",
  vorfuehrwagen: "used",
  jahreswagen: "used",
  oldtimer: "used"
};

export function mapCondition(value: unknown): VehicleCondition | null {
  if (!value) return null;
  const key = String(value).trim().toLowerCase();
  if (conditionMap[key]) return conditionMap[key];
  if (/neu/.test(key)) return "new";
  if (/gebraucht|used|demo|vorf/.test(key)) return "used";
  return null;
}

// Map marketplace body-type labels (mostly German) to the project BodyType.
export function mapBodyType(value: unknown): BodyType | null {
  if (!value) return null;
  const key = String(value).toLowerCase();
  if (/\bvan\b|kleinbus|transporter|multivan/.test(key)) return "van";
  if (/kombi|touring|variant|avant|wagon/.test(key)) return "wagon";
  if (/suv|gel[äa]ndewagen|sav|pick/.test(key)) return "suv";
  if (/crossover/.test(key)) return "crossover";
  if (/kleinwagen|kompakt|compact|city/.test(key)) return "compact";
  if (/hatch|schr[äa]gheck/.test(key)) return "hatchback";
  if (/limousine|sedan|coup/.test(key)) return "sedan";
  return null;
}

const featureKeywords: Array<[feature: string, keywords: string[]]> = [
  ["apple_carplay", ["apple carplay", "carplay"]],
  ["android_auto", ["android auto"]],
  ["adaptive_cruise_control", ["adaptive cruise", "abstandsregeltempomat", "acc"]],
  ["lane_keeping_assist", ["lane keep", "spurhalte"]],
  ["blind_spot_detection", ["blind spot", "totwinkel"]],
  ["heated_seats", ["heated seats", "sitzheizung"]],
  ["wireless_charging", ["wireless charging", "induktives laden"]],
  ["premium_audio", ["bose", "harman", "bowers", "burmester", "soundsystem"]],
  ["heat_pump", ["wärmepumpe", "heat pump"]]
];

// Detect feature names from free text (keyword scan, PoC detectBool port).
export function detectFeatures(text: string | null | undefined) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return featureKeywords.filter(([, keywords]) => keywords.some((k) => lower.includes(k))).map(([feature]) => feature);
}

// Listing key for in-source dedupe while paginating.
export function listingKey(listing: RawListing) {
  return listing.listingUrl || `${listing.title}|${listing.priceEUR}`;
}

export function setPageParam(baseUrl: string, param: string, value: string | number) {
  const url = new URL(baseUrl);
  url.searchParams.set(param, String(value));
  return url.toString();
}
