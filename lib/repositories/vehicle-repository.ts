import { allVehicles } from "../data/all-vehicles.ts";
import { matchDebug, matchDebugWarn } from "../match-debug.ts";
import { estimateMonthlyVehiclePayment } from "../tco.ts";
import type { UserCriteria, Vehicle } from "../types.ts";
import { sanitizeVehicleImages } from "../vehicle-images.ts";
import {
  vehicleMatchesBrandOriginPreferences,
  vehicleMatchesBrandPreferences,
  vehicleMatchesModelPreferences
} from "../vehicle-matching.ts";
import { getSupabaseRestConfig } from "./supabase-rest.ts";

type SupabaseVehicleRow = {
  id: string;
  payload: Vehicle;
};

const SUPABASE_VEHICLE_LIMIT = "500";
const VEHICLE_SELECT = "id,payload";

export async function listVehicles(): Promise<Vehicle[]> {
  const vehicles = await fetchSupabaseVehicles();
  if (vehicles) return vehicles;
  matchDebugWarn("vehicle-repository.fallback", {
    reason: "supabase-list-unavailable",
    localVehicles: allVehicles.length
  });
  return allVehicles;
}

export async function searchVehicles(criteria: UserCriteria): Promise<Vehicle[]> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return [];

  const params = buildVehicleSearchParams(criteria);

  try {
    const response = await fetch(`${supabase.url}/rest/v1/vehicles?${params}`, {
      headers: supabase.headers,
      next: { revalidate: 60 }
    });
    if (!response.ok) {
      const message = await response.text();
      matchDebugWarn("vehicle-repository.fallback", {
        reason: "supabase-search-status",
        status: response.status,
        message,
        localVehicles: allVehicles.length
      });
      return filterVehiclesForSearch(allVehicles, criteria);
    }

    const rows = (await response.json()) as SupabaseVehicleRow[];
    const vehicles = rows.map(mapVehicleRow).filter((vehicle): vehicle is Vehicle => Boolean(vehicle));
    const filtered = filterVehiclesForSearch(normalizeSupabaseVehicles(vehicles), criteria);
    matchDebug("vehicle-repository.search", {
      rows: rows.length,
      validVehicles: vehicles.length,
      filteredVehicles: filtered.length,
      queryFilters: summarizeVehicleSearchFilters(criteria),
      brandPreferences: criteria.brandPreferences,
      modelPreferences: criteria.modelPreferences
    });
    return filtered;
  } catch {
    matchDebugWarn("vehicle-repository.fallback", {
      reason: "supabase-search-error",
      localVehicles: allVehicles.length
    });
    return filterVehiclesForSearch(allVehicles, criteria);
  }
}

export async function upsertSeedVehicles() {
  const supabase = getSupabaseRestConfig();
  if (!supabase) {
    return {
      mode: "supabase-unconfigured",
      count: 0
    };
  }

  const rows = allVehicles.map((vehicle) => ({ id: vehicle.id, payload: vehicle }));

  for (const rowsChunk of chunk(rows, 100)) {
    const response = await fetch(`${supabase.url}/rest/v1/vehicles`, {
      method: "POST",
      headers: {
        ...supabase.headers,
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify(rowsChunk)
    });

    if (!response.ok) {
      return {
        mode: "supabase-error",
        count: 0,
        status: response.status,
        message: await response.text()
      };
    }
  }

  return {
    mode: "supabase",
    count: rows.length
  };
}

export async function getVehicleById(id: string): Promise<Vehicle | null> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return null;

  try {
    const response = await fetch(
      `${supabase.url}/rest/v1/vehicles?select=id,payload&id=eq.${encodeURIComponent(id)}&limit=1`,
      {
        headers: supabase.headers,
        next: { revalidate: 60 }
      }
    );
    if (!response.ok) return null;

    const rows = (await response.json()) as SupabaseVehicleRow[];
    const vehicle = rows.map(mapVehicleRow).find((item): item is Vehicle => Boolean(item));
    return vehicle ?? null;
  } catch {
    return null;
  }
}

async function fetchSupabaseVehicles(): Promise<Vehicle[] | null> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return allVehicles;

  try {
    const params = new URLSearchParams({
      select: VEHICLE_SELECT,
      market: "eq.AT",
      available: "eq.true",
      order: "updated_at.desc",
      limit: SUPABASE_VEHICLE_LIMIT
    });
    const response = await fetch(`${supabase.url}/rest/v1/vehicles?${params}`, {
      headers: supabase.headers,
      next: { revalidate: 60 }
    });
    if (!response.ok) return null;

    const rows = (await response.json()) as SupabaseVehicleRow[];
    const vehicles = rows.map(mapVehicleRow).filter((vehicle): vehicle is Vehicle => Boolean(vehicle));
    const normalized = normalizeSupabaseVehicles(vehicles);
    matchDebug("vehicle-repository.list", {
      rows: rows.length,
      validVehicles: vehicles.length,
      normalizedVehicles: normalized.length
    });
    return normalized;
  } catch {
    return null;
  }
}

function normalizeSupabaseVehicles(vehicles: Vehicle[]) {
  const withListingImages = vehicles.filter((vehicle) =>
    vehicle.images.some((image) => /^https?:\/\//.test(image))
  );
  return withListingImages.length ? withListingImages : vehicles;
}

export function buildVehicleSearchParams(criteria: UserCriteria) {
  const params = new URLSearchParams({
    select: VEHICLE_SELECT,
    market: "eq.AT",
    available: "eq.true",
    order: "price_eur.asc,range_km.desc",
    limit: SUPABASE_VEHICLE_LIMIT
  });

  if (criteria.budgetMaxEUR) params.set("price_eur", `lte.${criteria.budgetMaxEUR}`);
  if (criteria.monthlyBudgetEUR) {
    params.set("or", `(monthly_lease_eur.is.null,monthly_lease_eur.lte.${criteria.monthlyBudgetEUR})`);
  }
  if (criteria.preferredCondition !== "any") params.set("condition", `eq.${criteria.preferredCondition}`);
  if (criteria.rangeFloorKm) params.set("range_km", `gte.${criteria.rangeFloorKm}`);
  if (criteria.bodyTypes.length) params.set("body_type", `in.(${criteria.bodyTypes.join(",")})`);
  if (criteria.preferredBrandOrigins.length) {
    params.set("brand_origin", `in.(${criteria.preferredBrandOrigins.join(",")})`);
  }
  if (criteria.passengers) params.set("seats", `gte.${criteria.passengers}`);
  if (criteria.preferredCondition === "used" && criteria.mileageMaxKm) {
    params.set("mileage_km", `lte.${criteria.mileageMaxKm}`);
  }
  if (criteria.preferredCondition === "used" && criteria.batteryHealthRequired && criteria.batterySoHMin) {
    params.set("battery_soh", `gte.${criteria.batterySoHMin}`);
  }

  return params;
}

function summarizeVehicleSearchFilters(criteria: UserCriteria) {
  return {
    market: "AT",
    available: true,
    budgetMaxEUR: criteria.budgetMaxEUR,
    monthlyBudgetEUR: criteria.monthlyBudgetEUR,
    preferredCondition: criteria.preferredCondition,
    rangeFloorKm: criteria.rangeFloorKm,
    mileageMaxKm: criteria.mileageMaxKm,
    batterySoHMin: criteria.batteryHealthRequired ? criteria.batterySoHMin : null,
    bodyTypes: criteria.bodyTypes,
    preferredBrandOrigins: criteria.preferredBrandOrigins,
    passengers: criteria.passengers,
    brandPreferences: criteria.brandPreferences,
    modelPreferences: criteria.modelPreferences,
    avoidedBrands: criteria.avoidedBrands
  };
}

function mapVehicleRow(row: SupabaseVehicleRow): Vehicle | null {
  if (!isVehicle(row.payload)) return null;
  return sanitizeVehicleImages(row.payload);
}

function isVehicle(value: unknown): value is Vehicle {
  if (!value || typeof value !== "object") return false;
  const vehicle = value as Partial<Vehicle>;
  return (
    typeof vehicle.id === "string" &&
    vehicle.market === "AT" &&
    typeof vehicle.make === "string" &&
    typeof vehicle.model === "string" &&
    typeof vehicle.priceEUR === "number" &&
    typeof vehicle.rangeKm === "number" &&
    Array.isArray(vehicle.features) &&
    Array.isArray(vehicle.images)
  );
}

function filterVehiclesForSearch(vehicles: Vehicle[], criteria: UserCriteria) {
  return vehicles.filter((vehicle) => {
    if (vehicle.market !== "AT") return false;
    if (!vehicle.available) return false;
    if (criteria.budgetMaxEUR && vehicle.priceEUR > criteria.budgetMaxEUR) return false;
    if (criteria.monthlyBudgetEUR && estimateMonthlyVehiclePayment(vehicle) > criteria.monthlyBudgetEUR) {
      return false;
    }
    if (criteria.preferredCondition !== "any" && vehicle.condition !== criteria.preferredCondition) return false;
    if (criteria.rangeFloorKm && vehicle.rangeKm < criteria.rangeFloorKm) return false;
    if (criteria.mileageMaxKm && vehicle.mileageKm !== null && vehicle.mileageKm > criteria.mileageMaxKm) return false;
    if (criteria.mileageMaxKm && vehicle.condition === "used" && vehicle.mileageKm === null) return false;
    if (criteria.bodyTypes.length && !criteria.bodyTypes.includes(vehicle.bodyType)) return false;
    if (!vehicleMatchesBrandOriginPreferences(vehicle, criteria.preferredBrandOrigins)) return false;
    if (!vehicleMatchesBrandPreferences(vehicle, criteria.brandPreferences)) return false;
    if (!vehicleMatchesModelPreferences(vehicle, criteria.modelPreferences)) return false;
    if (criteria.passengers && vehicle.seats < criteria.passengers) return false;
    if (criteria.avoidedBrands.some((brand) => sameBrand(brand, vehicle.make))) return false;
    return true;
  });
}

function sameBrand(input: string, make: string) {
  const normalizedInput = normalizeBrand(input);
  const normalizedMake = normalizeBrand(make);
  return normalizedInput === normalizedMake || normalizedInput.includes(normalizedMake);
}

function normalizeBrand(value: string) {
  return value.toLowerCase().replace("mercedes-benz", "mercedes").replace("volkswagen", "vw");
}

function chunk<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}
