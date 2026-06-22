import { normalizeVehicleFeatures } from "../feature-normalization.ts";
import type { BodyType, Vehicle, VehicleCondition } from "../types.ts";

/** Willhaben API fields stripped from `raw` before Supabase upload (noise / PII / ads). */
export const WILLHABEN_RAW_OMIT_FIELDS = [
  "loginId",
  "teaserAttributes",
  "deleteReason",
  "upsellings",
  "disposed",
  "publishInfo",
  "p2ppOptions",
  "contactSuggestions",
  "equipmentList",
  "inputSource",
  "breadcrumbs",
  "contactOption",
  "ownageTypeXmlCode",
  "categoryXmlCode",
  "tooltips",
  "loginUUid",
  "chatEnabled",
  "savedInFolder",
  "categoryTreeId",
  "attributeInformation",
  "facebookTrackingData",
  "premiumServiceBoxListResponseDto",
  "seoMetaData",
  "advertEditStatusActionsList",
  "advertStatus",
  "dmpUserIdentities",
  "dmpParameters",
  "advertisingParametersV2",
  "advertisingParameters",
  "taggingData",
  "contextLinkList",
  "advertContactDetails",
  "advertAddressDetails",
  "sellerProfileUserData",
  "organisationDetails",
  "advertAttachmentList",
  "advertImageList",
  "attributes"
] as const;

const omitRawFieldSet = new Set<string>(WILLHABEN_RAW_OMIT_FIELDS);

const currentInventoryYear = 2026;

const bodyTypeDefaults: Record<BodyType, { cargoLiters: number; rangeKm: number; batteryKwh: number }> = {
  compact: { cargoLiters: 285, rangeKm: 280, batteryKwh: 42 },
  hatchback: { cargoLiters: 370, rangeKm: 320, batteryKwh: 58 },
  sedan: { cargoLiters: 430, rangeKm: 420, batteryKwh: 60 },
  suv: { cargoLiters: 520, rangeKm: 450, batteryKwh: 72 },
  crossover: { cargoLiters: 470, rangeKm: 400, batteryKwh: 64 },
  wagon: { cargoLiters: 540, rangeKm: 430, batteryKwh: 68 },
  van: { cargoLiters: 650, rangeKm: 360, batteryKwh: 75 },
  other: { cargoLiters: 450, rangeKm: 380, batteryKwh: 60 },
  minibus: { cargoLiters: 650, rangeKm: 360, batteryKwh: 75 }
};

export type WillhabenInventoryRow = Omit<Vehicle, "raw"> & {
  raw?: Record<string, unknown>;
  leasingEligible?: boolean | null;
  leaseDurationMonths?: number | null;
  leaseAdvancePaymentEUR?: number | null;
  leaseResidualValueEUR?: number | null;
  leaseDetails?: string | null;
};

export function sanitizeWillhabenRaw(raw: Record<string, unknown> | null | undefined) {
  if (!raw || typeof raw !== "object") return undefined;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!omitRawFieldSet.has(key)) sanitized[key] = value;
  }
  return Object.keys(sanitized).length ? sanitized : undefined;
}

export function prepareWillhabenVehicleForUpload(row: WillhabenInventoryRow): Vehicle {
  const bodyType = normalizeBodyType(row.bodyType);
  const defaults = bodyTypeDefaults[bodyType];
  const condition = row.condition ?? "used";
  const batteryKwh = row.batteryKwh ?? defaults.batteryKwh;
  const efficiencyKwhPer100Km = row.efficiencyKwhPer100Km ?? 18;
  const rangeKm = row.rangeKm ?? Math.max(80, Math.round((batteryKwh / efficiencyKwhPer100Km) * 100));
  const drivetrain = row.drivetrain ?? "RWD";
  const sanitizedRaw = sanitizeWillhabenRaw(row.raw as Record<string, unknown> | undefined);

  return {
    ...row,
    market: "AT",
    listingCountry: row.listingCountry ?? "AT",
    currency: row.currency ?? "EUR",
    bodyType,
    condition,
    year: row.year ?? currentInventoryYear,
    priceEUR: row.priceEUR ?? 0,
    monthlyLeaseEUR: row.monthlyLeaseEUR ?? null,
    mileageKm: condition === "new" ? (row.mileageKm ?? null) : (row.mileageKm ?? 0),
    rangeKm,
    efficiencyKwhPer100Km,
    batteryKwh,
    batterySoH: row.batterySoH ?? null,
    chargingCycles: row.chargingCycles ?? null,
    warranty:
      row.warranty ??
      (condition === "new"
        ? "New listing; verify factory vehicle and traction-battery warranty with seller or OEM."
        : "Used listing; verify remaining battery warranty and request battery state-of-health documentation."),
    seats: row.seats ?? (bodyType === "van" || bodyType === "minibus" ? 7 : 5),
    cargoLiters: row.cargoLiters ?? defaults.cargoLiters,
    drivetrain,
    powerKw: row.powerKw ?? 170,
    available: row.available ?? true,
    features: normalizeVehicleFeatures(Array.isArray(row.features) ? row.features : [], {
      drivetrain,
      cargoLiters: row.cargoLiters ?? defaults.cargoLiters,
      bodyType
    }),
    images: Array.isArray(row.images) ? row.images : [],
    notes: row.notes ?? "",
    brandOrigin: normalizeBrandOrigin(row.brandOrigin),
    reviewTags: Array.isArray(row.reviewTags) ? row.reviewTags : [],
    raw: sanitizedRaw
  };
}

function normalizeBodyType(value: string | undefined): BodyType {
  if (!value) return "crossover";
  if (value === "minibus") return "minibus";
  if (value === "other") return "other";
  const allowed: BodyType[] = [
    "compact",
    "hatchback",
    "sedan",
    "suv",
    "crossover",
    "wagon",
    "van",
    "other",
    "minibus"
  ];
  return allowed.includes(value as BodyType) ? (value as BodyType) : "crossover";
}

function normalizeBrandOrigin(value: string | undefined): Vehicle["brandOrigin"] {
  if (value === "europe" || value === "china" || value === "korea" || value === "us" || value === "other") {
    return value;
  }
  return "other";
}

export function normalizeWillhabenCondition(value: VehicleCondition | string | null | undefined): VehicleCondition {
  return value === "new" ? "new" : "used";
}
