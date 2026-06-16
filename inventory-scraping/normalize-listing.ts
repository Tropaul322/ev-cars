import crypto from "node:crypto";
import type { BodyType, Feature, Vehicle } from "../lib/types.ts";
import type { RawListing } from "./types.ts";
import { compactWhitespace } from "./html.ts";
import { parseVinFromText } from "./vin.ts";

const currentInventoryYear = 2026;

const fallbackImages: Record<BodyType, string> = {
  compact: "/vehicles/fiat-500e-icon-2022.png",
  hatchback: "/vehicles/vw-id3-pro-2023.png",
  sedan: "/vehicles/tesla-model-3-rwd-2024.png",
  suv: "/vehicles/skoda-enyaq-85-2024.png",
  crossover: "/vehicles/hyundai-ioniq5-2023.png",
  wagon: "/vehicles/nio-et5-touring-2024.png",
  van: "/vehicles/byd-atto3-design-2024.png",
  other: "/vehicles/hyundai-ioniq5-2023.png",
  minibus: "/vehicles/byd-atto3-design-2024.png"
};

const manufacturerCountries: Record<string, { country: string; code: string }> = {
  Abarth: { country: "Italy", code: "IT" },
  Audi: { country: "Germany", code: "DE" },
  BMW: { country: "Germany", code: "DE" },
  BYD: { country: "China", code: "CN" },
  Citroen: { country: "France", code: "FR" },
  Cupra: { country: "Spain", code: "ES" },
  Fiat: { country: "Italy", code: "IT" },
  Ford: { country: "United States", code: "US" },
  Hyundai: { country: "South Korea", code: "KR" },
  Jaguar: { country: "United Kingdom", code: "GB" },
  Jeep: { country: "United States", code: "US" },
  Kia: { country: "South Korea", code: "KR" },
  Leapmotor: { country: "China", code: "CN" },
  "Mercedes-Benz": { country: "Germany", code: "DE" },
  MG: { country: "China", code: "CN" },
  Mini: { country: "United Kingdom", code: "GB" },
  NIO: { country: "China", code: "CN" },
  Nissan: { country: "Japan", code: "JP" },
  Opel: { country: "Germany", code: "DE" },
  Peugeot: { country: "France", code: "FR" },
  Polestar: { country: "Sweden", code: "SE" },
  Porsche: { country: "Germany", code: "DE" },
  Renault: { country: "France", code: "FR" },
  Skoda: { country: "Czech Republic", code: "CZ" },
  Smart: { country: "Germany", code: "DE" },
  Tesla: { country: "United States", code: "US" },
  Toyota: { country: "Japan", code: "JP" },
  Volkswagen: { country: "Germany", code: "DE" },
  Volvo: { country: "Sweden", code: "SE" },
  XPeng: { country: "China", code: "CN" }
};

const supportedFeatures = new Set<Feature>([
  "apple_carplay",
  "android_auto",
  "blind_spot_detection",
  "adaptive_cruise_control",
  "lane_keeping_assist",
  "wireless_charging",
  "reliable_connectivity",
  "voice_assistant",
  "cabin_storage",
  "heated_seats",
  "large_trunk",
  "premium_audio",
  "heat_pump",
  "awd"
]);

export function normalizeInventoryListing(raw: RawListing): Vehicle {
  const make = normalizeMake(raw.make ?? raw.title ?? "Unknown");
  const model = normalizeModel(raw.model, raw.title ?? make, make);
  const bodyType = raw.bodyType ?? inferBodyType(raw.text);
  const condition = raw.condition ?? (raw.mileageKm !== null && raw.mileageKm > 50 ? "used" : "new");
  const batteryKwh = raw.batteryKwh ?? inferBatteryKwh(raw, bodyType);
  const efficiencyKwhPer100Km = raw.efficiencyKwhPer100Km ?? inferEfficiency(raw, bodyType, batteryKwh);
  const rangeKm = raw.rangeKm ?? Math.max(80, Math.round((batteryKwh / efficiencyKwhPer100Km) * 100));
  const drivetrain = inferDrivetrain(raw.text, make, bodyType);
  const cargoLiters = inferCargoLiters(raw.text, bodyType);
  const seats = inferSeats(raw.text, bodyType);
  const powerKw = raw.powerKw ?? inferPowerKw(raw.text, drivetrain, bodyType);
  const manufacturer = manufacturerCountries[make] ?? { country: "Unknown", code: "XX" };
  const inventoryFingerprint = makeInventoryFingerprint(raw, make, model, condition);
  const vin = raw.vin ?? parseVinFromText(raw.text);
  const dedupeKey = makeDedupeKey(raw, inventoryFingerprint, vin);
  const images = normalizeImages(raw, bodyType);

  return {
    id: `inventory:${dedupeKey}`.slice(0, 220),
    source: raw.source,
    provenance: raw.sourceName,
    sourceListingId: raw.sourceListingId ?? undefined,
    dedupeKey,
    inventoryFingerprint,
    market: "AT",
    listingCountry: "AT",
    currency: "EUR",
    title: raw.title ?? `${make} ${model}`,
    make,
    model,
    trim: raw.trim ?? inferTrim(raw.title, make, model),
    year: raw.year ?? currentInventoryYear,
    priceEUR: raw.priceEUR ?? 0,
    priceLabel: raw.priceLabel ?? (raw.priceEUR ? `EUR ${raw.priceEUR.toLocaleString("de-AT")}` : undefined),
    monthlyLeaseEUR: parseMonthlyLease(raw.text),
    condition,
    mileageKm: condition === "new" ? null : raw.mileageKm,
    rangeKm,
    efficiencyKwhPer100Km,
    batteryKwh,
    batterySoH: parseBatterySoh(raw.text),
    chargingCycles: null,
    warranty: raw.warranty ?? defaultWarranty(condition),
    bodyType,
    seats,
    cargoLiters,
    drivetrain,
    powerKw,
    available: true,
    features: inferFeatures(raw, drivetrain, cargoLiters),
    images: images.map((image) => image.url),
    imageDetails: images,
    location: raw.location,
    listingUrl: raw.canonicalUrl ?? raw.listingUrl,
    sellerName: raw.sellerName,
    sellerType: raw.sellerType,
    vin,
    vatDeductible: inferVatDeductible(raw.text),
    sourceUpdatedAt: null,
    crawledAt: raw.crawledAt,
    firstRegistration: raw.firstRegistration,
    exteriorColor: raw.exteriorColor,
    doors: raw.doors,
    transmission: raw.transmission,
    manufacturerCountry: manufacturer.country,
    manufacturerCountryCode: manufacturer.code,
    notes: buildNotes(raw),
    brandOrigin: inferBrandOrigin(manufacturer.code),
    reviewTags: inferReviewTags(bodyType, rangeKm, cargoLiters, condition, drivetrain),
    raw
  };
}

export function makeInventoryFingerprint(
  raw: RawListing,
  make: string,
  model: string,
  condition: Vehicle["condition"] = raw.condition ?? "used"
) {
  return sha256(
    [
      make,
      model,
      raw.trim,
      raw.year,
      condition,
      raw.mileageKm === null ? "new-mileage" : Math.round(raw.mileageKm / 250) * 250,
      raw.priceEUR === null ? "no-price" : Math.round(raw.priceEUR / 100) * 100,
      normalizeLocation(raw.location),
      normalizeSeller(raw.sellerName)
    ].join("|")
  ).slice(0, 32);
}

function makeDedupeKey(raw: RawListing, inventoryFingerprint: string, vin: string | null) {
  if (raw.sourceListingId) return `${raw.source}:${raw.sourceListingId}`;
  if (vin) return `vin:${vin}`;
  const canonical = raw.canonicalUrl ?? raw.listingUrl;
  if (canonical) return `${raw.source}:${sha256(normalizeUrl(canonical)).slice(0, 32)}`;
  return `fingerprint:${inventoryFingerprint}`;
}

function normalizeImages(raw: RawListing, bodyType: BodyType) {
  const seen = new Set<string>();
  const imageDetails = raw.imageDetails.length
    ? raw.imageDetails
    : raw.images.map((url) => ({ url, source: "raw_listing" }));
  const images = imageDetails.filter((image) => {
    if (!/^https?:\/\//i.test(image.url)) return false;
    if (seen.has(image.url)) return false;
    seen.add(image.url);
    return true;
  });
  return images.length ? images.slice(0, 24) : [{ url: fallbackImages[bodyType], source: "fallback" }];
}

function normalizeMake(value: string) {
  const matched = Object.keys(manufacturerCountries).find((make) => value.toLowerCase().includes(make.toLowerCase()));
  if (matched) return matched;
  const first = compactWhitespace(value).split(/\s+/)[0] ?? "Unknown";
  return first === "VW" ? "Volkswagen" : first;
}

function normalizeModel(model: string | null, fallback: string, make: string) {
  if (model) return compactWhitespace(model.replace(new RegExp(`^${escapeRegex(make)}\\s+`, "i"), ""));
  const title = compactWhitespace(fallback.replace(new RegExp(`^${escapeRegex(make)}\\s+`, "i"), ""));
  return title.split(/\s+/).slice(0, 3).join(" ") || "Listed EV";
}

function inferTrim(title: string | null, make: string, model: string) {
  if (!title) return "Listed trim";
  const trim = title.replace(new RegExp(`^${escapeRegex(`${make} ${model}`)}\\s*`, "i"), "").trim();
  return trim || "Listed trim";
}

function inferBodyType(text: string): BodyType {
  if (/\bvan\b|kleinbus|transporter|multivan|tourneo/i.test(text)) return "van";
  if (/kombi|touring|avant|variant|sports tourer|wagon/i.test(text)) return "wagon";
  if (/suv|gel[äa]ndewagen|sports utility/i.test(text)) return "suv";
  if (/crossover|suv-coup/i.test(text)) return "crossover";
  if (/kleinwagen|compact|kompakt|forfour|fortwo|500e/i.test(text)) return "compact";
  if (/hatchback|id\.3|zoe|born|mg4/i.test(text)) return "hatchback";
  return "sedan";
}

function inferBatteryKwh(raw: RawListing, bodyType: BodyType) {
  const titleBattery = parseNumber(raw.title ?? "", /(\d{1,3}(?:[,.]\d+)?)\s*kwh\b/i);
  if (titleBattery) return titleBattery;
  if (raw.rangeKm && raw.efficiencyKwhPer100Km) return roundOne((raw.rangeKm * raw.efficiencyKwhPer100Km) / 100);
  const defaults: Record<BodyType, number> = {
    compact: 42,
    hatchback: 58,
    sedan: 75,
    suv: 77,
    crossover: 70,
    wagon: 82,
    van: 80,
    other: 64,
    minibus: 75
  };
  return defaults[bodyType];
}

function inferEfficiency(raw: RawListing, bodyType: BodyType, batteryKwh: number) {
  if (raw.rangeKm && raw.rangeKm > 0) return roundOne((batteryKwh / raw.rangeKm) * 100);
  const defaults: Record<BodyType, number> = {
    compact: 14.5,
    hatchback: 15.8,
    sedan: 16.5,
    suv: 18.8,
    crossover: 17.6,
    wagon: 17.8,
    van: 21.5,
    other: 18.5,
    minibus: 21
  };
  return defaults[bodyType];
}

function inferDrivetrain(text: string, make: string, bodyType: BodyType): Vehicle["drivetrain"] {
  if (/\b(awd|4wd|4matic|xdrive|quattro|allrad|dual motor|4x4)\b/i.test(text)) return "AWD";
  if (/(tesla|id\.|bmw i[457x]|polestar|porsche|seal|sealion)/i.test(`${make} ${text}`)) return "RWD";
  return bodyType === "compact" || bodyType === "hatchback" ? "FWD" : "RWD";
}

function inferCargoLiters(text: string, bodyType: BodyType) {
  const parsed = parseNumber(text, /(?:kofferraum|cargo|ladevolumen)[^\d]{0,30}(\d{2,4})\s*l/i);
  if (parsed) return Math.round(parsed);
  const defaults: Record<BodyType, number> = {
    compact: 285,
    hatchback: 370,
    sedan: 430,
    suv: 520,
    crossover: 470,
    wagon: 540,
    van: 650,
    other: 450,
    minibus: 650
  };
  return defaults[bodyType];
}

function inferSeats(text: string, bodyType: BodyType) {
  const parsed = parseNumber(text, /(\d)\s*(?:sitze|sitzplätze|seats)\b/i);
  if (parsed && parsed >= 2 && parsed <= 9) return parsed;
  return bodyType === "van" ? 7 : 5;
}

function inferPowerKw(text: string, drivetrain: Vehicle["drivetrain"], bodyType: BodyType) {
  const kw = parseNumber(text.replace(/kwh/gi, ""), /(\d{2,4})\s*kw\b/i);
  if (kw) return Math.round(kw);
  const ps = parseNumber(text, /(\d{2,4})\s*ps\b/i);
  if (ps) return Math.round(ps * 0.7355);
  if (drivetrain === "AWD") return 250;
  if (bodyType === "compact" || bodyType === "hatchback") return 115;
  if (bodyType === "van") return 150;
  return 170;
}

function inferFeatures(raw: RawListing, drivetrain: Vehicle["drivetrain"], cargoLiters: number) {
  const features = new Set<Feature>();
  for (const feature of raw.features) {
    if (supportedFeatures.has(feature as Feature)) features.add(feature as Feature);
  }
  if (drivetrain === "AWD") features.add("awd");
  if (cargoLiters >= 500) features.add("large_trunk");
  if (/w[aä]rmepumpe|heat pump/i.test(raw.text)) features.add("heat_pump");
  if (/carplay/i.test(raw.text)) features.add("apple_carplay");
  if (/android auto/i.test(raw.text)) features.add("android_auto");
  return [...features];
}

function inferReviewTags(
  bodyType: BodyType,
  rangeKm: number,
  cargoLiters: number,
  condition: Vehicle["condition"],
  drivetrain: Vehicle["drivetrain"]
) {
  return [
    bodyType,
    condition,
    rangeKm >= 450 ? "road_trip_fit" : null,
    rangeKm >= 550 ? "long_range" : null,
    cargoLiters >= 500 ? "family_cargo" : null,
    drivetrain === "AWD" ? "winter_traction" : null
  ].filter((tag): tag is string => Boolean(tag));
}

function inferBrandOrigin(countryCode: string): Vehicle["brandOrigin"] {
  if (countryCode === "CN") return "china";
  if (["DE", "FR", "IT", "ES", "SE", "CZ", "GB"].includes(countryCode)) return "europe";
  return "other";
}

function parseMonthlyLease(text: string) {
  return parseNumber(text, /(?:leasing|rate|monat|monthly)[^\d€]{0,40}(?:€|eur)?\s*(\d{2,4})(?:[,.]\d{2})?/i);
}

function parseBatterySoh(text: string) {
  return parseNumber(text, /(?:soh|state of health|batteriezustand)[^\d]{0,30}(\d{2,3})(?:[,.]\d+)?\s*%/i);
}

function inferVatDeductible(text: string) {
  if (/mwst\.?\s*ausweisbar|vat deductible|vorsteuerabzugsberechtigt/i.test(text)) return true;
  if (/differenzbesteuert|privatverkauf/i.test(text)) return false;
  return null;
}

function defaultWarranty(condition: Vehicle["condition"]) {
  return condition === "new"
    ? "New listing; verify factory vehicle and traction-battery warranty with seller or OEM."
    : "Used listing; verify remaining battery warranty and request battery state-of-health documentation.";
}

function buildNotes(raw: RawListing) {
  return [`${raw.sourceName} inventory listing crawled.`, `HTML hash: ${raw.htmlHash}.`].join(" ");
}

function parseNumber(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  const number = Number(match[1].replace(/[.\s]/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function normalizeUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|cid|ref)/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

function normalizeLocation(value: string | null) {
  return compactWhitespace(value ?? "").toLowerCase().replace(/\d{4}/g, "");
}

function normalizeSeller(value: string | null) {
  return compactWhitespace(value ?? "").toLowerCase().replace(/\b(gmbh|gesmbh|kg|ag)\b/g, "");
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
