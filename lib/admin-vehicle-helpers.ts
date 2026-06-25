import { normalizeVehicleFeatures } from "./feature-normalization.ts";
import { sanitizeVehicleImages } from "./vehicle-images.ts";
import type { BodyType, Feature, Vehicle, VehicleCondition } from "./types.ts";

export const VEHICLE_WIZARD_FEATURES: Feature[] = [
  "apple_carplay",
  "android_auto",
  "adaptive_cruise_control",
  "lane_keeping_assist",
  "wireless_charging",
  "heated_seats",
  "premium_audio",
  "heat_pump",
  "awd",
  "blind_spot_detection",
  "reliable_connectivity",
  "voice_assistant",
  "cabin_storage",
  "large_trunk"
];

export const VEHICLE_WIZARD_BODY_TYPES: BodyType[] = [
  "compact",
  "hatchback",
  "sedan",
  "suv",
  "crossover",
  "wagon",
  "van",
  "other"
];

export const VEHICLE_WIZARD_CONDITIONS: VehicleCondition[] = ["new", "used"];

export function decodeVehicleRouteId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

export function adminVehicleEditPath(id: string): string {
  return `/admin/vehicles/${encodeURIComponent(decodeVehicleRouteId(id))}/edit`;
}

export function adminVehicleApiPath(id: string): string {
  return `/api/admin/vehicles/${encodeURIComponent(decodeVehicleRouteId(id))}`;
}

export function generateVehicleId(make: string, model: string, year: number) {
  const slug = [make, model, String(year)]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `vehicle-${Date.now()}`;
}

export function buildDefaultVehicle(input: Partial<Vehicle> & Pick<Vehicle, "make" | "model" | "year">): Vehicle {
  const id = input.id?.trim() || generateVehicleId(input.make, input.model, input.year);
  return normalizeVehiclePayload({
    id,
    source: input.source ?? "seed",
    market: "AT",
    make: input.make,
    model: input.model,
    trim: input.trim ?? "",
    year: input.year,
    priceEUR: input.priceEUR ?? 0,
    monthlyLeaseEUR: input.monthlyLeaseEUR ?? null,
    condition: input.condition ?? "used",
    mileageKm: input.mileageKm ?? null,
    rangeKm: input.rangeKm ?? 300,
    efficiencyKwhPer100Km: input.efficiencyKwhPer100Km ?? 16,
    batteryKwh: input.batteryKwh ?? 60,
    batterySoH: input.batterySoH ?? null,
    chargingCycles: input.chargingCycles ?? null,
    warranty: input.warranty ?? "",
    bodyType: input.bodyType ?? "hatchback",
    seats: input.seats ?? 5,
    cargoLiters: input.cargoLiters ?? 300,
    drivetrain: input.drivetrain ?? "RWD",
    powerKw: input.powerKw ?? 150,
    available: input.available ?? true,
    features: input.features ?? [],
    images: input.images ?? [],
    notes: input.notes ?? "",
    brandOrigin: input.brandOrigin ?? "europe",
    reviewTags: input.reviewTags ?? [],
    location: input.location ?? null,
    listingUrl: input.listingUrl,
    title: input.title,
    leasingEligible: input.leasingEligible ?? null,
    leaseDurationMonths: input.leaseDurationMonths ?? null
  });
}

export function normalizeVehiclePayload(vehicle: Vehicle): Vehicle {
  const sanitized = sanitizeVehicleImages(vehicle);
  return {
    ...sanitized,
    market: "AT",
    features: normalizeVehicleFeatures(sanitized.features, sanitized),
    images: sanitized.images ?? [],
    available: sanitized.available ?? true
  };
}
