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
import { expandVehicleSearchLexicon } from "../vehicle-search-lexicon.ts";
import {
  lightHardMatchingEnabled,
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
  semantic_similarity?: number;
  text_rank?: number;
  rrf_score?: number;
};

const SUPABASE_VEHICLE_LIMIT = "120";
const VEHICLE_SELECT = "id,payload";

export async function listVehicles(): Promise<Vehicle[]> {
  const vehicles = await fetchSupabaseVehicles();
  if (vehicles?.length) return vehicles;
  matchDebugWarn("vehicle-repository.list-unavailable", {
    reason: vehicles ? "supabase-list-empty" : "supabase-list-unavailable",
    fallback: "bundled-catalog"
  });
  return listBundledVehicles();
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
      embeddingEnabled,
      fallback: "bundled-catalog"
    });
    return searchBundledVehicles(criteria, options);
  }

  const supabase = getSupabaseRestConfig();
  if (!supabase) {
    matchDebugWarn("vehicle-repository.search-unavailable", {
      reason: "supabase-unconfigured",
      fallback: "bundled-catalog"
    });
    return searchBundledVehicles(criteria, options);
  }

  const embeddingQuery = buildVehicleEmbeddingQuery(criteria, message);
  const ftsQuery = buildVehicleFtsQuery(criteria, message);
  let queryEmbedding: string | null = null;
  let embeddingQueryStatus: "ok" | "disabled" | "unavailable" = "disabled";
  let embeddingProvider: string | undefined;

  if (embeddingEnabled) {
    const embeddingResult = await createEmbeddingWithProvider(embeddingQuery, "query");
    embeddingQueryStatus = embeddingResult.status;
    embeddingProvider = "provider" in embeddingResult ? embeddingResult.provider : undefined;
    if (embeddingResult.embedding) {
      queryEmbedding = `[${embeddingResult.embedding.join(",")}]`;
    } else {
      matchDebugWarn("vehicle-repository.embedding-query-missing", {
        status: embeddingResult.status,
        provider: embeddingProvider,
        reason:
          embeddingResult.status === "disabled"
            ? "FLOWRYD_DISABLE_EMBEDDINGS=1"
            : "No query embedding provider succeeded; hybrid text search only",
        queryPreview: embeddingQuery.slice(0, 160),
        ftsQueryPreview: ftsQuery.slice(0, 160),
        embeddingQueryPreview: embeddingQuery.slice(0, 160)
      });
    }
  }

  try {
    const response = await fetch(`${supabase.url}/rest/v1/rpc/search_vehicles_hybrid`, {
      method: "POST",
      headers: supabase.headers,
      body: JSON.stringify({
        // Short lexical tokens only — long prose ANDs to zero hits in websearch_to_tsquery.
        query_text: ftsQuery,
        query_embedding: queryEmbedding,
        filters: buildHybridSearchFilters(criteria),
        match_count: vehicleEmbeddingSearchLimit(),
        min_similarity: vehicleEmbeddingMinSimilarity()
      }),
      next: { revalidate: VEHICLE_REVALIDATE_SECONDS }
    });

    if (!response.ok) {
      const errorMessage = await response.text();
      matchDebugWarn("vehicle-repository.search-unavailable", {
        reason: "supabase-hybrid-search-status",
        status: response.status,
        message: errorMessage
      });
      return searchVehiclesStructured(criteria, options);
    }

    const rows = (await response.json()) as SupabaseVehicleRow[];
    const vehicles = rows.map(mapVehicleRow).filter((vehicle): vehicle is Vehicle => Boolean(vehicle));
    const filtered = filterVehiclesForSearch(normalizeSupabaseVehicles(vehicles), criteria);
    const offset = options.offset ?? 0;
    const paged = offset > 0 ? filtered.slice(offset) : filtered;

    matchDebug("vehicle-repository.search", {
      structuredEnabled,
      embeddingEnabled,
      hybridRpc: true,
      hybridVehicles: vehicles.length,
      embeddingQueryStatus,
      embeddingProvider,
      searchOffset: offset,
      filteredVehicles: filtered.length,
      returnedVehicles: paged.length,
      ftsQueryPreview: ftsQuery.slice(0, 160),
      embeddingQueryPreview: embeddingQuery.slice(0, 160),
      queryFilters: summarizeVehicleSearchFilters(criteria),
      brandPreferences: criteria.brandPreferences,
      modelPreferences: criteria.modelPreferences
    });

    if (!paged.length && structuredEnabled) {
      matchDebugWarn("vehicle-repository.hybrid-empty-structured-fallback", {
        ftsQueryPreview: ftsQuery.slice(0, 160),
        embeddingQueryPreview: embeddingQuery.slice(0, 160)
      });
      return searchVehiclesStructured(criteria, options);
    }

    return paged;
  } catch {
    matchDebugWarn("vehicle-repository.search-unavailable", {
      reason: "supabase-hybrid-search-error"
    });
    return searchVehiclesStructured(criteria, options);
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
        next: { revalidate: VEHICLE_REVALIDATE_SECONDS }
      }
    );
    if (!response.ok) return null;

    const rows = (await response.json()) as SupabaseVehicleRow[];
    return rows.map(mapVehicleRow).find((item): item is Vehicle => Boolean(item)) ?? null;
  } catch {
    return null;
  }
}

async function fetchSupabaseVehicles(): Promise<Vehicle[] | null> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return null;

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

/** Offline / unconfigured fallback: curated seed + checked-in FlowRyd inventory. */
function listBundledVehicles(): Vehicle[] {
  const bundled = normalizeSupabaseVehicles(allVehicles);
  matchDebug("vehicle-repository.list-bundled", { vehicles: bundled.length });
  return bundled;
}

function searchBundledVehicles(criteria: UserCriteria, options: VehicleSearchOptions = {}): Vehicle[] {
  const filtered = filterVehiclesForSearch(listBundledVehicles(), criteria);
  const offset = options.offset ?? 0;
  const paged = offset > 0 ? filtered.slice(offset) : filtered;
  matchDebug("vehicle-repository.search-bundled", {
    filteredVehicles: filtered.length,
    returnedVehicles: paged.length,
    searchOffset: offset,
    queryFilters: summarizeVehicleSearchFilters(criteria)
  });
  return paged;
}

function normalizeSupabaseVehicles(vehicles: Vehicle[]) {
  const withListingImages = vehicles.filter((vehicle) =>
    vehicle.images.some((image) => /^https?:\/\//.test(image))
  );
  return withListingImages.length ? withListingImages : vehicles;
}

export function buildVehicleFtsQuery(criteria: UserCriteria, message: string) {
  const lexicon = expandVehicleSearchLexicon(criteria, message);
  // websearch_to_tsquery treats spaces as AND; OR so any document-aligned token can hit.
  return lexicon.ftsTokens.join(" or ").trim();
}

export function buildVehicleEmbeddingQuery(criteria: UserCriteria, message: string) {
  const lexicon = expandVehicleSearchLexicon(criteria, message);
  return [
    message,
    criteria.rawPrompt,
    ...lexicon.embeddingPhrases,
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

async function searchVehiclesStructured(
  criteria: UserCriteria,
  options: VehicleSearchOptions = {}
): Promise<Vehicle[]> {
  if (!vehicleStructuredSearchEnabled()) return [];
  const supabase = getSupabaseRestConfig();
  if (!supabase) return [];

  try {
    const params = buildVehicleSearchParams(criteria, options.offset ?? 0);
    const response = await fetch(`${supabase.url}/rest/v1/vehicles?${params}`, {
      headers: supabase.headers,
      next: { revalidate: VEHICLE_REVALIDATE_SECONDS }
    });
    if (!response.ok) {
      matchDebugWarn("vehicle-repository.structured-search-unavailable", {
        status: response.status,
        message: await response.text()
      });
      return [];
    }
    const rows = (await response.json()) as SupabaseVehicleRow[];
    const vehicles = rows.map(mapVehicleRow).filter((vehicle): vehicle is Vehicle => Boolean(vehicle));
    const filtered = filterVehiclesForSearch(normalizeSupabaseVehicles(vehicles), criteria);
    matchDebug("vehicle-repository.structured-search", {
      rows: rows.length,
      filteredVehicles: filtered.length,
      queryFilters: summarizeVehicleSearchFilters(criteria)
    });
    return filtered;
  } catch {
    matchDebugWarn("vehicle-repository.structured-search-unavailable", {
      reason: "structured-search-error"
    });
    return [];
  }
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
  if (lightHardMatchingEnabled()) {
    return {
      market: "AT",
      available: true,
      budgetMinEUR: criteria.budgetMinEUR,
      budgetMaxEUR: criteria.budgetMaxEUR,
      monthlyBudgetEUR: criteria.monthlyBudgetEUR,
      modelPreferences: [],
      avoidedBrands: expandBrandSearchValues(criteria.avoidedBrands),
      mustHaveFeatures: [],
      hardRangeFloorKm: null,
      hardBodyTypes: [],
      hardPassengers: null,
      hardCondition: null,
      hardBrandPreferences: [],
      hardBrandOrigins: [],
      hardBrandOriginCountryCodes: [],
      mileageMaxKm: null,
      batterySoHMin: null,
      location: null
    };
  }
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
  if (lightHardMatchingEnabled()) {
    return {
      retrievePolicy: "light_hard" as const,
      market: "AT" as const,
      available: true as const,
      budgetMinEUR: criteria.budgetMinEUR,
      budgetMaxEUR: criteria.budgetMaxEUR,
      monthlyBudgetEUR: criteria.monthlyBudgetEUR,
      preferredCondition: "any" as const,
      rangeFloorKm: null,
      mileageMaxKm: null,
      batterySoHMin: null,
      bodyTypes: [] as UserCriteria["bodyTypes"],
      preferredBrandOrigins: [] as UserCriteria["preferredBrandOrigins"],
      passengers: null,
      brandPreferences: [] as string[],
      modelPreferences: [] as string[],
      avoidedBrands: criteria.avoidedBrands,
      location: null,
      mustHaveFeatures: [] as UserCriteria["mustHaveFeatures"]
    };
  }
  return {
    retrievePolicy: "full_hard" as const,
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
    // Marketplace payloads often omit SoH; normalize to null so downstream null-checks work.
    batterySoH:
      typeof vehicle.batterySoH === "number" && Number.isFinite(vehicle.batterySoH)
        ? vehicle.batterySoH
        : null,
    features: normalizeVehicleFeatures(vehicle.features, vehicle)
  };
  if (typeof row.semantic_similarity === "number" && Number.isFinite(row.semantic_similarity)) {
    mapped.embeddingSimilarity = row.semantic_similarity;
  } else if (typeof row.similarity === "number" && Number.isFinite(row.similarity)) {
    mapped.embeddingSimilarity = row.similarity;
  }
  if (typeof row.text_rank === "number" && Number.isFinite(row.text_rank)) {
    mapped.textRank = row.text_rank;
  }
  if (typeof row.rrf_score === "number" && Number.isFinite(row.rrf_score)) {
    mapped.retrievalScore = row.rrf_score;
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

export function filterVehiclesForSearch(vehicles: Vehicle[], criteria: UserCriteria) {
  if (lightHardMatchingEnabled()) {
    return vehicles.filter((vehicle) => {
      if (vehicle.market !== "AT") return false;
      if (!vehicle.available) return false;
      if (!isPlausiblePurchasePrice(vehicle.priceEUR, vehicle.monthlyLeaseEUR)) return false;
      if (criteria.budgetMinEUR && vehicle.priceEUR < criteria.budgetMinEUR) return false;
      if (criteria.budgetMaxEUR && vehicle.priceEUR > criteria.budgetMaxEUR) return false;
      if (criteria.monthlyBudgetEUR && estimateMonthlyVehiclePayment(vehicle) > criteria.monthlyBudgetEUR) {
        return false;
      }
      if (criteria.avoidedBrands.some((brand) => sameBrand(brand, vehicle.make))) return false;
      return true;
    });
  }
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
