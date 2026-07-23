import { allVehicles } from "../data/all-vehicles.ts";
import { VEHICLE_REVALIDATE_SECONDS } from "../cache.ts";
import {
  hasHardBodyTypeConstraint,
  hasHardBrandConstraint,
  hasHardBrandOriginConstraint,
  hasHardConditionConstraint,
  hasHardPassengerConstraint,
  hasHardRangeConstraint
} from "../criteria.ts";
import { createEmbeddingWithProvider } from "../embeddings.ts";
import { normalizeVehicleFeatures } from "../feature-normalization.ts";
import { resolveInventoryLocationFilter } from "../location-search.ts";
import { matchDebug, matchDebugWarn } from "../match-debug.ts";
import { estimateMonthlyVehiclePayment } from "../tco.ts";
import type { UserCriteria, Vehicle } from "../types.ts";
import {
  inferSearchRangeFloorKm,
  isPlausiblePurchasePrice,
  resolveVehicleSearchOrder
} from "../vehicle-search-helpers.ts";
import {
  vehicleEmbeddingMinSimilarity,
  vehicleEmbeddingSearchEnabled,
  vehicleEmbeddingSearchLimit,
  vehicleStructuredSearchEnabled
} from "../vehicle-search-settings.ts";
import { sanitizeVehicleImages } from "../vehicle-images.ts";
import {
  countryCodesForBrandOrigins,
  vehicleMatchesBrandOriginPreferences,
  vehicleMatchesBrandPreferences,
  vehicleMatchesModelPreferences
} from "../vehicle-matching.ts";
import { getSupabaseRestConfig } from "./supabase-rest.ts";

type SupabaseVehicleRow = {
  id: string;
  payload: Vehicle;
  similarity?: number;
};

const SUPABASE_VEHICLE_LIMIT = "120";
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

export type VehicleSearchOptions = {
  offset?: number;
};

export async function searchVehicles(
  criteria: UserCriteria,
  message = "",
  options: VehicleSearchOptions = {}
): Promise<Vehicle[]> {
  const structuredEnabled = vehicleStructuredSearchEnabled();
  const embeddingEnabled = vehicleEmbeddingSearchEnabled();

  if (!structuredEnabled && !embeddingEnabled) {
    matchDebug("vehicle-repository.search-disabled", {
      structuredEnabled,
      embeddingEnabled
    });
    return [];
  }

  const [structuredVehicles, embeddingResult] = await Promise.all([
    structuredEnabled ? searchVehiclesByStructuredFilters(criteria, options.offset ?? 0) : Promise.resolve([]),
    embeddingEnabled ? searchVehiclesByEmbedding(criteria, message) : Promise.resolve({ vehicles: [], status: "disabled" as const, provider: undefined })
  ]);
  const embeddingVehicles = embeddingResult.vehicles;

  const merged = mergeVehiclesById([...embeddingVehicles, ...structuredVehicles]);
  const filtered = filterVehiclesForSearch(normalizeSupabaseVehicles(merged), criteria);

  matchDebug("vehicle-repository.search", {
    structuredEnabled,
    embeddingEnabled,
    structuredVehicles: structuredVehicles.length,
    embeddingVehicles: embeddingVehicles.length,
    embeddingQueryStatus: embeddingResult.status,
    embeddingProvider: "provider" in embeddingResult ? embeddingResult.provider : undefined,
    searchOffset: options.offset ?? 0,
    mergedVehicles: merged.length,
    filteredVehicles: filtered.length,
    queryFilters: summarizeVehicleSearchFilters(criteria),
    brandPreferences: criteria.brandPreferences,
    modelPreferences: criteria.modelPreferences
  });

  return filtered;
}

async function searchVehiclesByStructuredFilters(criteria: UserCriteria, offset = 0): Promise<Vehicle[]> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return [];

  const params = buildVehicleSearchParams(criteria, offset);

  try {
    const response = await fetch(`${supabase.url}/rest/v1/vehicles?${params}`, {
      headers: supabase.headers,
      next: { revalidate: VEHICLE_REVALIDATE_SECONDS }
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
    return rows.map(mapVehicleRow).filter((vehicle): vehicle is Vehicle => Boolean(vehicle));
  } catch {
    matchDebugWarn("vehicle-repository.fallback", {
      reason: "supabase-search-error",
      localVehicles: allVehicles.length
    });
    return filterVehiclesForSearch(allVehicles, criteria);
  }
}

async function searchVehiclesByEmbedding(criteria: UserCriteria, message: string) {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return { vehicles: [], status: "unavailable" as const };

  const query = buildVehicleEmbeddingQuery(criteria, message);
  const embeddingResult = await createEmbeddingWithProvider(query, "query");
  if (!embeddingResult.embedding) {
    matchDebugWarn("vehicle-repository.embedding-query-missing", {
      status: embeddingResult.status,
      provider: embeddingResult.provider,
      reason:
        embeddingResult.status === "disabled"
          ? "FLOWRYD_DISABLE_EMBEDDINGS=1"
          : "No query embedding provider succeeded; structured search only",
      queryPreview: query.slice(0, 160)
    });
    return { vehicles: [], status: embeddingResult.status };
  }

  try {
    const response = await fetch(`${supabase.url}/rest/v1/rpc/match_vehicles_by_embedding`, {
      method: "POST",
      headers: supabase.headers,
      body: JSON.stringify({
        query_embedding: `[${embeddingResult.embedding.join(",")}]`,
        match_count: vehicleEmbeddingSearchLimit(),
        min_similarity: vehicleEmbeddingMinSimilarity()
      })
    });

    if (!response.ok) {
      matchDebugWarn("vehicle-repository.embedding-search-unavailable", {
        status: response.status,
        message: await response.text()
      });
      return { vehicles: [], status: "unavailable" as const, provider: embeddingResult.provider };
    }

    const rows = (await response.json()) as SupabaseVehicleRow[];
    const vehicles = rows.map(mapVehicleRow).filter((vehicle): vehicle is Vehicle => Boolean(vehicle));
    return { vehicles, status: "ok" as const, provider: embeddingResult.provider };
  } catch {
    matchDebugWarn("vehicle-repository.embedding-search-error", {
      reason: "rpc-error"
    });
    return { vehicles: [], status: "unavailable" as const, provider: embeddingResult.provider };
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
  const localVehicle = findLocalVehicleById(id);
  if (!supabase) return localVehicle;

  try {
    const response = await fetch(
      `${supabase.url}/rest/v1/vehicles?select=id,payload&id=eq.${encodeURIComponent(id)}&limit=1`,
      {
        headers: supabase.headers,
        next: { revalidate: VEHICLE_REVALIDATE_SECONDS }
      }
    );
    if (!response.ok) return localVehicle;

    const rows = (await response.json()) as SupabaseVehicleRow[];
    const vehicle = rows.map(mapVehicleRow).find((item): item is Vehicle => Boolean(item));
    return vehicle ?? localVehicle;
  } catch {
    return localVehicle;
  }
}

function findLocalVehicleById(id: string) {
  const vehicle = allVehicles.find((item) => item.id === id);
  return vehicle ? sanitizeVehicleImages(vehicle) : null;
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
      next: { revalidate: VEHICLE_REVALIDATE_SECONDS }
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

function mergeVehiclesById(vehicles: Vehicle[]) {
  const byId = new Map<string, Vehicle>();
  for (const vehicle of vehicles) {
    const existing = byId.get(vehicle.id);
    if (!existing) {
      byId.set(vehicle.id, vehicle);
      continue;
    }
    byId.set(vehicle.id, mergeVehicleSearchSignals(existing, vehicle));
  }
  return [...byId.values()];
}

function mergeVehicleSearchSignals(left: Vehicle, right: Vehicle): Vehicle {
  const leftSimilarity = left.embeddingSimilarity ?? 0;
  const rightSimilarity = right.embeddingSimilarity ?? 0;
  if (rightSimilarity <= leftSimilarity) return left;
  return { ...left, embeddingSimilarity: rightSimilarity };
}

function buildVehicleEmbeddingQuery(criteria: UserCriteria, message: string) {
  return [
    message,
    criteria.rawPrompt,
    criteria.bodyTypes.join(" "),
    criteria.tripNeeds.join(" "),
    criteria.mustHaveFeatures.join(" "),
    criteria.qualitativeSignals.join(" "),
    criteria.brandPreferences.join(" "),
    criteria.modelPreferences.join(" "),
    criteria.chargingAccess,
    resolveInventoryLocationFilter(criteria.location),
    criteria.cargoNeeds,
    criteria.preferredCondition,
    criteria.rangeFloorKm ? `${criteria.rangeFloorKm} km range reichweite` : null,
    criteria.mileageMaxKm ? `${criteria.mileageMaxKm} km mileage kilometerstand` : null,
    criteria.batterySoHMin ? `battery health soh batteriegesundheit ${criteria.batterySoHMin}` : null,
    criteria.budgetMaxEUR ? `${criteria.budgetMaxEUR} eur budget` : null,
    criteria.monthlyBudgetEUR ? `${criteria.monthlyBudgetEUR} eur monthly leasing` : null
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildVehicleSearchParams(criteria: UserCriteria, offset = 0) {
  const params = new URLSearchParams({
    select: VEHICLE_SELECT,
    market: "eq.AT",
    available: "eq.true",
    order: resolveVehicleSearchOrder(criteria),
    limit: SUPABASE_VEHICLE_LIMIT
  });
  if (offset > 0) params.set("offset", String(offset));

  const orGroups: string[][] = [];
  const searchRangeFloorKm = hasHardRangeConstraint(criteria) ? inferSearchRangeFloorKm(criteria) : null;

  if (criteria.budgetMinEUR) params.append("price_eur", `gte.${criteria.budgetMinEUR}`);
  if (criteria.budgetMaxEUR) params.append("price_eur", `lte.${criteria.budgetMaxEUR}`);
  if (hasHardConditionConstraint(criteria) && criteria.preferredCondition !== "any") {
    params.set("condition", `eq.${criteria.preferredCondition}`);
  }
  if (searchRangeFloorKm) params.set("range_km", `gte.${searchRangeFloorKm}`);
  if (hasHardBodyTypeConstraint(criteria) && criteria.bodyTypes.length) {
    params.set("body_type", `in.(${criteria.bodyTypes.join(",")})`);
  }
  if (hasHardPassengerConstraint(criteria) && criteria.passengers) params.set("seats", `gte.${criteria.passengers}`);
  if (criteria.mileageMaxKm) params.set("mileage_km", `lte.${criteria.mileageMaxKm}`);
  if (criteria.batteryHealthRequired && criteria.batterySoHMin) {
    params.set("battery_soh", `gte.${criteria.batterySoHMin}`);
  }
  const locationFilter = resolveInventoryLocationFilter(criteria.location);
  if (locationFilter) {
    params.set("location", `ilike.${buildPostgrestIlikePattern(locationFilter)}`);
  }

  if (hasHardBrandConstraint(criteria) && criteria.brandPreferences.length) {
    params.set("brand", `in.(${formatPostgrestInList(expandBrandSearchValues(criteria.brandPreferences))})`);
  }
  if (criteria.avoidedBrands.length) {
    params.set("brand", `not.in.(${formatPostgrestInList(expandBrandSearchValues(criteria.avoidedBrands))})`);
  }

  if (hasHardBrandOriginConstraint(criteria) && criteria.preferredBrandOrigins.length) {
    const originFilters = [`brand_origin.in.(${criteria.preferredBrandOrigins.join(",")})`];
    const countryCodes = countryCodesForBrandOrigins(criteria.preferredBrandOrigins);
    if (countryCodes.length) {
      originFilters.push(`manufacturer_country_code.in.(${countryCodes.join(",")})`);
    }
    if (originFilters.length === 1) {
      params.set("brand_origin", `in.(${criteria.preferredBrandOrigins.join(",")})`);
    } else {
      orGroups.push(originFilters);
    }
  }

  if (criteria.monthlyBudgetEUR) {
    orGroups.push([
      "monthly_lease_eur.is.null",
      `monthly_lease_eur.lte.${criteria.monthlyBudgetEUR}`
    ]);
  }

  if (criteria.modelPreferences.length) {
    orGroups.push(
      criteria.modelPreferences.flatMap((model) => [
        `model.ilike.${buildPostgrestIlikePattern(model)}`,
        `title.ilike.${buildPostgrestIlikePattern(model)}`
      ])
    );
  }

  applyPostgrestOrGroups(params, orGroups);

  return params;
}

function applyPostgrestOrGroups(params: URLSearchParams, orGroups: string[][]) {
  if (!orGroups.length) return;
  if (orGroups.length === 1) {
    params.set("or", `(${orGroups[0].join(",")})`);
    return;
  }
  params.set("and", `(${orGroups.map((group) => `or(${group.join(",")})`).join(",")})`);
}

function expandBrandSearchValues(brands: string[]) {
  const values = new Set<string>();
  for (const brand of brands) {
    const trimmed = brand.trim();
    if (!trimmed) continue;
    values.add(trimmed);

    const normalized = normalizeBrand(trimmed);
    if (normalized === "vw") {
      values.add("VW");
      values.add("Volkswagen");
    }
    if (normalized === "mercedes") {
      values.add("Mercedes");
      values.add("Mercedes-Benz");
    }
  }
  return Array.from(values);
}

function formatPostgrestInList(values: string[]) {
  return values.map(escapePostgrestValue).join(",");
}

function escapePostgrestValue(value: string) {
  if (/[,.()*"]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildPostgrestIlikePattern(value: string) {
  const trimmed = value.trim().replace(/\*/g, "");
  if (!trimmed) return "*";
  return `*${escapePostgrestValue(trimmed)}*`;
}

export type HybridSearchFilters = {
  market: "AT";
  available: true;
  budgetMinEUR: number | null;
  budgetMaxEUR: number | null;
  monthlyBudgetEUR: number | null;
  modelPreferences: string[];
  avoidedBrands: string[];
  mustHaveFeatures: UserCriteria["mustHaveFeatures"];
  hardRangeFloorKm: number | null;
  hardBodyTypes: UserCriteria["bodyTypes"];
  hardPassengers: number | null;
  hardCondition: UserCriteria["preferredCondition"] | null;
  hardBrandPreferences: string[];
  hardBrandOrigins: UserCriteria["preferredBrandOrigins"];
  hardBrandOriginCountryCodes: string[];
  mileageMaxKm: number | null;
  batterySoHMin: number | null;
  location: string | null;
};

/** Typed hard-filter payload for `search_vehicles_hybrid`. Soft preferences are omitted. */
export function buildHybridSearchFilters(criteria: UserCriteria): HybridSearchFilters {
  const hardBrandOrigins = hasHardBrandOriginConstraint(criteria)
    ? criteria.preferredBrandOrigins
    : [];
  return {
    market: "AT",
    available: true,
    budgetMinEUR: criteria.budgetMinEUR,
    budgetMaxEUR: criteria.budgetMaxEUR,
    monthlyBudgetEUR: criteria.monthlyBudgetEUR,
    modelPreferences: criteria.modelPreferences,
    avoidedBrands: expandBrandSearchValues(criteria.avoidedBrands),
    mustHaveFeatures: criteria.mustHaveFeatures,
    hardRangeFloorKm: hasHardRangeConstraint(criteria) ? inferSearchRangeFloorKm(criteria) : null,
    hardBodyTypes: hasHardBodyTypeConstraint(criteria) ? criteria.bodyTypes : [],
    hardPassengers: hasHardPassengerConstraint(criteria) ? criteria.passengers : null,
    hardCondition:
      hasHardConditionConstraint(criteria) && criteria.preferredCondition !== "any"
        ? criteria.preferredCondition
        : null,
    hardBrandPreferences: hasHardBrandConstraint(criteria)
      ? expandBrandSearchValues(criteria.brandPreferences)
      : [],
    hardBrandOrigins,
    hardBrandOriginCountryCodes: countryCodesForBrandOrigins(hardBrandOrigins),
    mileageMaxKm: criteria.mileageMaxKm,
    batterySoHMin: criteria.batteryHealthRequired ? criteria.batterySoHMin : null,
    location: resolveInventoryLocationFilter(criteria.location)
  };
}

export function summarizeVehicleSearchFilters(criteria: UserCriteria) {
  return {
    market: "AT",
    available: true,
    budgetMinEUR: criteria.budgetMinEUR,
    budgetMaxEUR: criteria.budgetMaxEUR,
    monthlyBudgetEUR: criteria.monthlyBudgetEUR,
    preferredCondition: hasHardConditionConstraint(criteria) ? criteria.preferredCondition : "any",
    rangeFloorKm: hasHardRangeConstraint(criteria) ? criteria.rangeFloorKm ?? inferSearchRangeFloorKm(criteria) : null,
    mileageMaxKm: criteria.mileageMaxKm,
    batterySoHMin: criteria.batteryHealthRequired ? criteria.batterySoHMin : null,
    bodyTypes: hasHardBodyTypeConstraint(criteria) ? criteria.bodyTypes : [],
    preferredBrandOrigins: hasHardBrandOriginConstraint(criteria) ? criteria.preferredBrandOrigins : [],
    passengers: hasHardPassengerConstraint(criteria) ? criteria.passengers : null,
    brandPreferences: hasHardBrandConstraint(criteria) ? criteria.brandPreferences : [],
    modelPreferences: criteria.modelPreferences,
    avoidedBrands: criteria.avoidedBrands,
    location: resolveInventoryLocationFilter(criteria.location),
    mustHaveFeatures: criteria.mustHaveFeatures
  };
}

function mapVehicleRow(row: SupabaseVehicleRow): Vehicle | null {
  if (!isVehicle(row.payload)) return null;
  const vehicle = sanitizeVehicleImages(row.payload);
  const mapped: Vehicle = {
    ...vehicle,
    features: normalizeVehicleFeatures(vehicle.features, vehicle)
  };
  if (typeof row.similarity === "number" && Number.isFinite(row.similarity)) {
    mapped.embeddingSimilarity = row.similarity;
  }
  return mapped;
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
  const searchRangeFloorKm = hasHardRangeConstraint(criteria) ? inferSearchRangeFloorKm(criteria) : null;
  return vehicles.filter((vehicle) => {
    if (vehicle.market !== "AT") return false;
    if (!vehicle.available) return false;
    if (!isPlausiblePurchasePrice(vehicle.priceEUR, vehicle.monthlyLeaseEUR)) return false;
    if (criteria.budgetMinEUR && vehicle.priceEUR < criteria.budgetMinEUR) return false;
    if (criteria.budgetMaxEUR && vehicle.priceEUR > criteria.budgetMaxEUR) return false;
    if (criteria.monthlyBudgetEUR && estimateMonthlyVehiclePayment(vehicle) > criteria.monthlyBudgetEUR) {
      return false;
    }
    if (
      hasHardConditionConstraint(criteria) &&
      criteria.preferredCondition !== "any" &&
      vehicle.condition !== criteria.preferredCondition
    ) {
      return false;
    }
    if (searchRangeFloorKm && vehicle.rangeKm < searchRangeFloorKm) return false;
    if (criteria.mileageMaxKm && vehicle.mileageKm !== null && vehicle.mileageKm > criteria.mileageMaxKm) return false;
    if (criteria.mileageMaxKm && vehicle.condition === "used" && vehicle.mileageKm === null) return false;
    if (
      hasHardBodyTypeConstraint(criteria) &&
      criteria.bodyTypes.length &&
      !criteria.bodyTypes.includes(vehicle.bodyType)
    ) {
      return false;
    }
    if (
      hasHardBrandOriginConstraint(criteria) &&
      !vehicleMatchesBrandOriginPreferences(vehicle, criteria.preferredBrandOrigins)
    ) {
      return false;
    }
    if (hasHardBrandConstraint(criteria) && !vehicleMatchesBrandPreferences(vehicle, criteria.brandPreferences)) {
      return false;
    }
    if (!vehicleMatchesModelPreferences(vehicle, criteria.modelPreferences)) return false;
    if (hasHardPassengerConstraint(criteria) && criteria.passengers && vehicle.seats < criteria.passengers) {
      return false;
    }
    if (criteria.avoidedBrands.some((brand) => sameBrand(brand, vehicle.make))) return false;
    if (criteria.mustHaveFeatures.length) {
      const normalizedFeatures = normalizeVehicleFeatures(vehicle.features, vehicle);
      if (!criteria.mustHaveFeatures.every((feature) => normalizedFeatures.includes(feature))) return false;
    }
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
