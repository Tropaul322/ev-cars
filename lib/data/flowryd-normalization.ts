import type {
  BodyType,
  Feature,
  InventorySource,
  Vehicle,
  VehicleCondition
} from "../types.ts";

export type RawInventoryRow = {
  source: string;
  provenance: string;
  title: string;
  make_model: string | null;
  condition: string | null;
  price_eur: number | null;
  price_label: string;
  year: number | null;
  mileage_km: number | null;
  range_km: number | null;
  battery_kwh: number | null;
  efficiency_kwh_per_100_km: number | null;
  body_type: string | null;
  location: string | null;
  listing_url: string | null;
  image_url: string | null;
};

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

const europeanMakes = new Set([
  "Abarth",
  "Audi",
  "BMW",
  "Citroen",
  "Cupra",
  "Fiat",
  "Ford",
  "Jaguar",
  "Jeep",
  "Mercedes-Benz",
  "MINI",
  "Opel",
  "Peugeot",
  "Polestar",
  "Porsche",
  "Renault",
  "Skoda",
  "smart",
  "Volkswagen",
  "Volvo"
]);

const chineseMakes = new Set(["BYD", "Leapmotor", "MG", "NIO", "XPeng"]);

export function normalizeFlowrydVehicle(row: RawInventoryRow): Vehicle {
  const { make, model } = splitMakeModel(row.make_model ?? row.title);
  const bodyType = normalizeBodyType(row.body_type, row.title);
  const condition = normalizeCondition(row);
  const batteryKwh = inferBatteryKwh(row, bodyType);
  const efficiencyKwhPer100Km = inferEfficiency(row, bodyType, batteryKwh);
  const rangeKm = inferRangeKm(row, batteryKwh, efficiencyKwhPer100Km);
  const drivetrain = inferDrivetrain(row.title, make, bodyType);
  const cargoLiters = inferCargoLiters(row, bodyType);
  const seats = inferSeats(row, bodyType);
  const features = inferFeatures(row, make, bodyType, drivetrain, cargoLiters, condition);
  const estimatedFields = getEstimatedFields(row);

  return {
    id: makeFlowrydInventoryId(row),
    source: normalizeSource(row.source),
    provenance: row.provenance,
    market: "AT",
    title: row.title,
    make,
    model,
    trim: inferTrim(row, make, model),
    year: row.year ?? currentInventoryYear,
    priceEUR: row.price_eur ?? 0,
    priceLabel: row.price_label,
    monthlyLeaseEUR: null,
    condition,
    mileageKm: condition === "new" ? null : row.mileage_km,
    rangeKm,
    efficiencyKwhPer100Km,
    batteryKwh,
    batterySoH: null,
    chargingCycles: null,
    warranty:
      condition === "new"
        ? "New or nearly-new listing; verify factory and battery warranty with seller."
        : "Used listing; verify remaining battery warranty and battery state-of-health with seller.",
    bodyType,
    seats,
    cargoLiters,
    drivetrain,
    powerKw: inferPowerKw(row.title, drivetrain, bodyType),
    available: true,
    features,
    images: [row.image_url ?? fallbackImages[bodyType]],
    location: row.location,
    listingUrl: row.listing_url ?? undefined,
    notes:
      `FlowRyd ${row.provenance} listing from ${row.source}.` +
      (estimatedFields.length
        ? ` Estimated ${estimatedFields.join(", ")} from listing title/body data.`
        : ""),
    brandOrigin: inferBrandOrigin(make),
    reviewTags: inferReviewTags(bodyType, rangeKm, cargoLiters, condition, drivetrain),
    raw: row
  };
}

export function makeFlowrydInventoryId(row: RawInventoryRow) {
  const stablePart = row.listing_url ?? `${row.source}-${row.title}-${row.price_eur ?? "no-price"}`;
  return `flowryd:${row.source}:${slug(stablePart)}`.slice(0, 220);
}

function normalizeSource(source: string): InventorySource {
  if (source === "autoscout24_at") return "autoscout24_at";
  if (source === "gebrauchtwagen_at") return "gebrauchtwagen_at";
  if (source === "bmw_boerse_at") return "bmw_boerse_at";
  if (source === "vw_austria_ev_leasing") return "vw_austria_ev_leasing";
  if (source === "willhaben") return "willhaben";
  if (source === "autoscout24") return "autoscout24";
  if (source === "gebrauchtwagen") return "gebrauchtwagen";
  return "oem";
}

function normalizeCondition(row: RawInventoryRow): VehicleCondition {
  if (row.condition === "new" || row.condition === "used") return row.condition;
  if (row.source.includes("leasing") || row.mileage_km === null || row.mileage_km <= 50) return "new";
  return "used";
}

function normalizeBodyType(bodyType: string | null, title: string): BodyType {
  const value = `${bodyType ?? ""} ${title}`.toLowerCase();
  if (value.includes("mopedauto") || value.includes("rocks")) return "compact";
  if (value.includes("van") || value.includes("tourneo") || value.includes("combo")) return "van";
  if (value.includes("kombi") || value.includes("tourer") || value.includes("sports tourer")) return "wagon";
  if (value.includes("suv-coup") || value.includes("crossover")) return "crossover";
  if (value.includes("suv") || value.includes("geländewagen")) return "suv";
  if (value.includes("klein") || value.includes("kompakt") || value.includes("corsa")) return "compact";
  if (value.includes("limousine") || value.includes("gran coup") || value.includes("fastback")) return "sedan";
  if (value.includes("born") || value.includes("id.3") || value.includes("zoe")) return "hatchback";
  return "sedan";
}

function inferBatteryKwh(row: RawInventoryRow, bodyType: BodyType) {
  if (isPositive(row.battery_kwh)) return roundOne(row.battery_kwh);

  const titleBattery = parseNumberBeforeUnit(row.title, "kwh");
  if (titleBattery) return roundOne(titleBattery);

  const efficiency = row.efficiency_kwh_per_100_km ?? defaultEfficiency(bodyType);
  if (isPositive(row.range_km)) return roundOne((row.range_km * efficiency) / 100);

  return defaultBattery(bodyType);
}

function inferEfficiency(row: RawInventoryRow, bodyType: BodyType, batteryKwh: number) {
  if (isPositive(row.efficiency_kwh_per_100_km)) return roundOne(row.efficiency_kwh_per_100_km);
  if (isPositive(row.range_km)) return roundOne((batteryKwh / row.range_km) * 100);
  return defaultEfficiency(bodyType);
}

function inferRangeKm(row: RawInventoryRow, batteryKwh: number, efficiencyKwhPer100Km: number) {
  if (isPositive(row.range_km)) return Math.round(row.range_km);
  return Math.max(70, Math.round((batteryKwh / efficiencyKwhPer100Km) * 100));
}

function inferDrivetrain(title: string, make: string, bodyType: BodyType): Vehicle["drivetrain"] {
  if (/(awd|4wd|4matic|xdrive|quattro|allrad|dual motor|4x4)/i.test(title)) return "AWD";
  if (/(id\.|i4|i5|i7|ix|taycan|macan|polestar|mustang|seal|sealion)/i.test(`${make} ${title}`)) {
    return "RWD";
  }
  if (bodyType === "sedan" || bodyType === "suv" || bodyType === "crossover" || bodyType === "wagon") {
    return "RWD";
  }
  return "FWD";
}

function inferPowerKw(title: string, drivetrain: Vehicle["drivetrain"], bodyType: BodyType) {
  const titleKw = parseNumberBeforeUnit(title.replace(/kwh/gi, ""), "kw");
  if (titleKw) return Math.round(titleKw);

  const psMatch = title.match(/(\d{2,4})\s*ps/i);
  if (psMatch) return Math.round(Number(psMatch[1]) * 0.7355);

  if (drivetrain === "AWD") return 250;
  if (bodyType === "van") return 150;
  if (bodyType === "compact" || bodyType === "hatchback") return 115;
  if (bodyType === "sedan") return 180;
  return 165;
}

function inferSeats(row: RawInventoryRow, bodyType: BodyType) {
  if (/7\s*(stz|sitz|seats)/i.test(row.title) || bodyType === "van") return 7;
  if (/4\s*(sitz|seats|plätze)/i.test(row.title)) return 4;
  if (row.body_type === "Mopedauto" || /rocks/i.test(row.title)) return 2;
  return 5;
}

function inferCargoLiters(row: RawInventoryRow, bodyType: BodyType) {
  if (row.body_type === "Mopedauto" || /rocks/i.test(row.title)) return 63;

  const cargoByBody: Record<BodyType, number> = {
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

  return cargoByBody[bodyType];
}

function inferFeatures(
  row: RawInventoryRow,
  make: string,
  bodyType: BodyType,
  drivetrain: Vehicle["drivetrain"],
  cargoLiters: number,
  condition: VehicleCondition
) {
  const features = new Set<Feature>([
    "apple_carplay",
    "android_auto",
    "adaptive_cruise_control",
    "lane_keeping_assist"
  ]);

  const title = row.title.toLowerCase();
  if (condition === "new" || /navi|radar|acc|assist|matrix|led/i.test(row.title)) {
    features.add("heated_seats");
  }
  if (/leder|kamera|cam|park|ultra|ultimate|luxury|advanced|s-line|calligraphy/i.test(row.title)) {
    features.add("blind_spot_detection");
    features.add("wireless_charging");
  }
  if (["Audi", "BMW", "Mercedes-Benz", "Porsche", "Polestar", "Volvo"].includes(make)) {
    features.add("premium_audio");
  }
  if (cargoLiters >= 500 || bodyType === "wagon" || bodyType === "van") features.add("large_trunk");
  if (drivetrain === "AWD") features.add("awd");
  if (title.includes("wärmepumpe") || title.includes("heat pump")) features.add("heat_pump");

  return [...features];
}

function inferTrim(row: RawInventoryRow, make: string, model: string) {
  const makeModel = `${make} ${model}`;
  const sourceText = row.make_model ?? makeModel;
  const escaped = sourceText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const trim = row.title.replace(new RegExp(`^${escaped}\\s*`, "i"), "").trim();
  return trim || row.title.replace(new RegExp(`^${make}\\s*`, "i"), "").trim() || "Listed trim";
}

function inferBrandOrigin(make: string): Vehicle["brandOrigin"] {
  if (chineseMakes.has(make)) return "china";
  if (europeanMakes.has(make)) return "europe";
  return "other";
}

function inferReviewTags(
  bodyType: BodyType,
  rangeKm: number,
  cargoLiters: number,
  condition: VehicleCondition,
  drivetrain: Vehicle["drivetrain"]
) {
  const tags = new Set<string>(["real listing"]);
  if (rangeKm >= 500) tags.add("road trip");
  if (rangeKm <= 360 || bodyType === "compact" || bodyType === "hatchback") tags.add("city");
  if (cargoLiters >= 470 || bodyType === "suv" || bodyType === "wagon" || bodyType === "van") {
    tags.add("family");
  }
  if (cargoLiters >= 500) tags.add("large trunk");
  if (condition === "new") tags.add("new");
  if (drivetrain === "AWD") tags.add("winter");
  return [...tags];
}

function splitMakeModel(value: string) {
  const parts = value.trim().split(/\s+/);
  const rawMake = parts[0] ?? value;
  const make = normalizeMake(rawMake);
  const modelParts = parts.slice(1);

  return {
    make,
    model: modelParts.join(" ") || make
  };
}

function normalizeMake(make: string) {
  const aliases: Record<string, string> = {
    CUPRA: "Cupra",
    KIA: "Kia",
    VW: "Volkswagen"
  };

  return aliases[make] ?? make;
}

function getEstimatedFields(row: RawInventoryRow) {
  const fields: string[] = [];
  if (!isPositive(row.range_km)) fields.push("range");
  if (!isPositive(row.battery_kwh)) fields.push("battery size");
  if (!isPositive(row.efficiency_kwh_per_100_km)) fields.push("efficiency");
  if (!row.body_type) fields.push("body type");
  if (!row.year) fields.push("model year");
  return fields;
}

function defaultBattery(bodyType: BodyType) {
  const values: Record<BodyType, number> = {
    compact: 45,
    hatchback: 58,
    sedan: 75,
    suv: 77,
    crossover: 72,
    wagon: 77,
    van: 75,
    other: 60,
    minibus: 75
  };
  return values[bodyType];
}

function defaultEfficiency(bodyType: BodyType) {
  const values: Record<BodyType, number> = {
    compact: 15.2,
    hatchback: 15.4,
    sedan: 16.4,
    suv: 17.6,
    crossover: 17.1,
    wagon: 17.4,
    van: 20.1,
    other: 18.5,
    minibus: 21
  };
  return values[bodyType];
}

function parseNumberBeforeUnit(value: string, unit: string) {
  const match = value.match(new RegExp(`(\\d{1,3}(?:[\\.,]\\d+)?)\\s*${unit}`, "i"));
  return match ? Number(match[1].replace(",", ".")) : null;
}

function isPositive(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
