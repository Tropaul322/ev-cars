import type { BrandOrigin, Vehicle } from "./types.ts";

const originCountryCodes: Record<BrandOrigin, string[]> = {
  china: ["CN"],
  korea: ["KR"],
  us: ["US"],
  europe: [
    "AT",
    "BE",
    "CZ",
    "DE",
    "ES",
    "FR",
    "GB",
    "IT",
    "NL",
    "PL",
    "RO",
    "SE",
    "SK"
  ],
  other: []
};

export function vehicleMatchesModelPreferences(vehicle: Vehicle, modelPreferences: string[]) {
  return !modelPreferences.length || modelPreferences.some((model) => vehicleMatchesModelPreference(vehicle, model));
}

export function vehicleMatchesBrandPreferences(vehicle: Vehicle, brandPreferences: string[]) {
  return !brandPreferences.length || brandPreferences.some((brand) => vehicleMatchesBrandPreference(vehicle, brand));
}

export function vehicleMatchesBrandPreference(vehicle: Vehicle, brandPreference: string) {
  const preferred = normalizeVehicleText(brandPreference);
  if (!preferred) return false;

  return vehicleBrandCandidates(vehicle).some((candidate) => {
    const normalizedCandidate = normalizeBrand(candidate);
    return (
      normalizedCandidate === preferred ||
      normalizedCandidate.startsWith(`${preferred} `) ||
      preferred.startsWith(`${normalizedCandidate} `)
    );
  });
}

export function vehicleMatchesBrandOriginPreferences(vehicle: Vehicle, origins: BrandOrigin[] = []) {
  if (!origins.length) return true;
  return origins.some((origin) => vehicleMatchesBrandOriginPreference(vehicle, origin));
}

export function vehicleMatchesBrandOriginPreference(vehicle: Vehicle, origin: BrandOrigin) {
  if (vehicle.brandOrigin === origin) return true;
  const countryCode = vehicle.manufacturerCountryCode?.toUpperCase();
  if (countryCode && originCountryCodes[origin].includes(countryCode)) return true;
  if (origin === "china") {
    return (
      /china|chinese/i.test(vehicle.manufacturerCountry ?? "")
    );
  }
  if (origin === "europe") {
    return /europe|eu|germany|france|italy|spain|sweden|czech|austria|uk|united kingdom/i.test(
      vehicle.manufacturerCountry ?? ""
    );
  }
  return false;
}

export function countryCodesForBrandOrigins(origins: BrandOrigin[]) {
  return Array.from(new Set(origins.flatMap((origin) => originCountryCodes[origin])));
}

export function vehiclePrimaryBrand(vehicle: Vehicle) {
  return vehicle.brand ?? vehicle.make;
}

export function vehicleMatchesModelPreference(vehicle: Vehicle, modelPreference: string) {
  const preferred = normalizeVehicleText(modelPreference);
  if (!preferred) return false;

  const searchable = normalizeVehicleText(
    [
      vehicle.make,
      vehicle.model,
      vehicle.trim,
      vehicle.title,
      `${vehicle.make} ${vehicle.model}`,
      `${vehicle.model} ${vehicle.trim}`
    ]
      .filter(Boolean)
      .join(" ")
  );

  const paddedSearchable = ` ${searchable} `;
  const paddedPreferred = ` ${preferred} `;
  return paddedSearchable.includes(paddedPreferred);
}

function normalizeVehicleText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeBrand(value: string) {
  return normalizeVehicleText(value).replace("mercedes benz", "mercedes").replace("volkswagen", "vw");
}

function vehicleBrandCandidates(vehicle: Vehicle) {
  return [vehicle.brand, vehicle.make].filter((value): value is string => Boolean(value));
}
