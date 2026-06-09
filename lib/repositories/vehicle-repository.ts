import { allVehicles } from "../data/all-vehicles.ts";
import type { UserCriteria, Vehicle } from "../types.ts";
import { sanitizeVehicleImages } from "../vehicle-images.ts";
import { vehicleMatchesBrandOriginPreferences, vehicleMatchesModelPreferences } from "../vehicle-matching.ts";
import { getSupabaseRestConfig } from "./supabase-rest.ts";

type SupabaseVehicleRow = {
  id: string;
  payload: Vehicle;
};

export type EmbeddedVehicleMatch = {
  vehicle: Vehicle;
  similarity: number;
};

export async function listVehicles(): Promise<Vehicle[]> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return allVehicles;

  try {
    const response = await fetch(`${supabase.url}/rest/v1/vehicles?select=id,payload`, {
      headers: supabase.headers,
      next: { revalidate: 60 }
    });

    if (!response.ok) return allVehicles;
    const rows = (await response.json()) as SupabaseVehicleRow[];
    const vehicles = rows.map(mapVehicleRow).filter((vehicle): vehicle is Vehicle => Boolean(vehicle));
    return vehicles.length ? preferVehiclesWithListingImages(vehicles) : allVehicles;
  } catch {
    return allVehicles;
  }
}

export async function searchVehicles(criteria: UserCriteria): Promise<Vehicle[]> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return filterVehiclesForSearch(allVehicles, criteria);

  const params = new URLSearchParams({
    select: "id,payload",
    available: "eq.true",
    limit: "500"
  });
  if (criteria.budgetMaxEUR) params.set("price_eur", `lte.${criteria.budgetMaxEUR}`);
  if (criteria.preferredCondition !== "any") params.set("condition", `eq.${criteria.preferredCondition}`);
  if (criteria.rangeFloorKm) params.set("range_km", `gte.${criteria.rangeFloorKm}`);
  if (criteria.mileageMaxKm) params.set("mileage_km", `lte.${criteria.mileageMaxKm}`);
  if (criteria.bodyTypes.length) params.set("body_type", `in.(${criteria.bodyTypes.join(",")})`);

  try {
    const response = await fetch(`${supabase.url}/rest/v1/vehicles?${params}`, {
      headers: supabase.headers,
      next: { revalidate: 60 }
    });
    if (!response.ok) return filterVehiclesForSearch(await listVehicles(), criteria);

    const rows = (await response.json()) as SupabaseVehicleRow[];
    const vehicles = rows.map(mapVehicleRow).filter((vehicle): vehicle is Vehicle => Boolean(vehicle));
    return filterVehiclesForSearch(
      vehicles.length ? preferVehiclesWithListingImages(vehicles) : await listVehicles(),
      criteria
    );
  } catch {
    return filterVehiclesForSearch(await listVehicles(), criteria);
  }
}

export async function getVehicleById(id: string): Promise<Vehicle | null> {
  const vehicles = await listVehicles();
  return vehicles.find((vehicle) => vehicle.id === id) ?? null;
}

export async function matchVehiclesByEmbedding(
  embedding: number[],
  limit = 30
): Promise<EmbeddedVehicleMatch[]> {
  const supabase = getSupabaseRestConfig();
  if (!supabase || !embedding.length) return [];

  try {
    const response = await fetch(`${supabase.url}/rest/v1/rpc/match_vehicles_by_embedding`, {
      method: "POST",
      headers: supabase.headers,
      body: JSON.stringify({
        query_embedding: `[${embedding.join(",")}]`,
        match_count: limit,
        min_similarity: 0
      })
    });
    if (!response.ok) return [];
    const rows = (await response.json()) as Array<{
      id?: string;
      payload?: Vehicle;
      similarity?: number;
    }>;
    return rows
      .map((row) => {
        if (!isVehicle(row.payload)) return null;
        return {
          vehicle: sanitizeVehicleImages(row.payload),
          similarity: row.similarity ?? 0
        };
      })
      .filter((row): row is EmbeddedVehicleMatch => Boolean(row));
  } catch {
    return [];
  }
}

export async function upsertSeedVehicles() {
  const supabase = getSupabaseRestConfig();
  if (!supabase) {
    return {
      mode: "local-seed",
      count: allVehicles.length
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
    if (
      criteria.monthlyBudgetEUR &&
      vehicle.monthlyLeaseEUR &&
      vehicle.monthlyLeaseEUR > criteria.monthlyBudgetEUR
    ) {
      return false;
    }
    if (criteria.preferredCondition !== "any" && vehicle.condition !== criteria.preferredCondition) return false;
    if (criteria.rangeFloorKm && vehicle.rangeKm < criteria.rangeFloorKm) return false;
    if (criteria.mileageMaxKm && vehicle.mileageKm !== null && vehicle.mileageKm > criteria.mileageMaxKm) return false;
    if (criteria.mileageMaxKm && vehicle.condition === "used" && vehicle.mileageKm === null) return false;
    if (criteria.bodyTypes.length && !criteria.bodyTypes.includes(vehicle.bodyType)) return false;
    if (!vehicleMatchesBrandOriginPreferences(vehicle, criteria.preferredBrandOrigins)) return false;
    if (!vehicleMatchesModelPreferences(vehicle, criteria.modelPreferences)) return false;
    if (criteria.passengers && vehicle.seats < criteria.passengers) return false;
    if (criteria.avoidedBrands.some((brand) => sameBrand(brand, vehicle.make))) return false;
    return true;
  });
}

function preferVehiclesWithListingImages(vehicles: Vehicle[]) {
  const scrapedWithImages = vehicles.filter((vehicle) => {
    return vehicle.source !== "seed" && vehicle.images.some((image) => /^https?:\/\//.test(image));
  });

  return scrapedWithImages.length ? scrapedWithImages : vehicles;
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
