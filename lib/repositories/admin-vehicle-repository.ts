import { parseVehicleSheetCsv } from "../inventory/vehicles-sheet-import.ts";
import { buildDefaultVehicle, normalizeVehiclePayload } from "../admin-vehicle-helpers.ts";
import { embedVehicles, fetchVehicleEmbeddingRows } from "../vehicle-embeddings.ts";
import type { Vehicle } from "../types.ts";
import { getSupabaseRestConfig } from "./supabase-rest.ts";

export {
  buildDefaultVehicle,
  generateVehicleId,
  VEHICLE_WIZARD_BODY_TYPES,
  VEHICLE_WIZARD_CONDITIONS,
  VEHICLE_WIZARD_FEATURES
} from "../admin-vehicle-helpers.ts";

const CSV_IMPORT_MAX_ROWS = 200;
const VEHICLE_SELECT = "id,payload,available";

type SupabaseVehicleRow = {
  id: string;
  payload: Vehicle;
  available?: boolean;
};

export type AdminVehicleListItem = Vehicle & {
  available: boolean;
};

export type AdminVehicleListQuery = {
  q?: string;
  make?: string;
  condition?: Vehicle["condition"] | "any";
  bodyType?: Vehicle["bodyType"] | "any";
  location?: string;
  priceMinEUR?: number | null;
  priceMaxEUR?: number | null;
  includeUnavailable?: boolean;
  page?: number;
  pageSize?: number;
};

export type AdminVehicleListResult = {
  vehicles: AdminVehicleListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_ADMIN_PAGE_SIZE = 20;
const MAX_ADMIN_PAGE_SIZE = 100;

export async function searchVehiclesAdmin(
  query: AdminVehicleListQuery = {}
): Promise<AdminVehicleListResult> {
  const supabase = getSupabaseRestConfig();
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(MAX_ADMIN_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_ADMIN_PAGE_SIZE));
  const emptyResult = { vehicles: [], total: 0, page, pageSize, totalPages: 0 };

  if (!supabase) return emptyResult;

  const params = buildAdminVehicleListParams(query, page, pageSize);

  try {
    const response = await fetch(`${supabase.url}/rest/v1/vehicles?${params}`, {
      headers: {
        ...supabase.headers,
        Prefer: "count=exact"
      },
      cache: "no-store"
    });
    if (!response.ok) return emptyResult;

    const rows = (await response.json()) as SupabaseVehicleRow[];
    const vehicles = rows
      .map((row) => mapAdminVehicleRow(row))
      .filter((vehicle): vehicle is AdminVehicleListItem => Boolean(vehicle));
    const total = parseContentRangeTotal(response.headers.get("content-range"));
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

    return { vehicles, total, page, pageSize, totalPages };
  } catch {
    return emptyResult;
  }
}

/** @deprecated Use searchVehiclesAdmin */
export async function listAllVehiclesAdmin(options: {
  includeUnavailable?: boolean;
  limit?: number;
  offset?: number;
} = {}): Promise<AdminVehicleListItem[]> {
  const pageSize = options.limit ?? 500;
  const page = Math.floor((options.offset ?? 0) / pageSize) + 1;
  const result = await searchVehiclesAdmin({
    includeUnavailable: options.includeUnavailable,
    page,
    pageSize
  });
  return result.vehicles;
}
export type UpsertVehicleResult = {
  saved: boolean;
  vehicle?: Vehicle;
  embedded: boolean;
  embeddingError?: string;
  error?: string;
};

export type ImportVehiclesResult = {
  imported: number;
  embedded: number;
  skipped: number;
  errors: string[];
  embeddingError?: string;
};

export async function getVehicleAdmin(id: string): Promise<AdminVehicleListItem | null> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return null;

  try {
    const response = await fetch(
      `${supabase.url}/rest/v1/vehicles?select=${VEHICLE_SELECT}&id=eq.${encodeURIComponent(id)}&limit=1`,
      {
        headers: supabase.headers,
        cache: "no-store"
      }
    );
    if (!response.ok) return null;

    const rows = (await response.json()) as SupabaseVehicleRow[];
    return rows[0] ? mapAdminVehicleRow(rows[0]) : null;
  } catch {
    return null;
  }
}

export async function upsertVehicleAdmin(vehicle: Vehicle): Promise<UpsertVehicleResult> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) {
    return { saved: false, embedded: false, error: "Supabase is not configured." };
  }

  const normalized = normalizeVehiclePayload(vehicle);

  try {
    const response = await fetch(`${supabase.url}/rest/v1/vehicles?on_conflict=id`, {
      method: "POST",
      headers: {
        ...supabase.headers,
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify({
        id: normalized.id,
        payload: normalized,
        available: normalized.available
      })
    });

    if (!response.ok) {
      return {
        saved: false,
        embedded: false,
        error: await response.text()
      };
    }

    const embeddingRows = await fetchVehicleEmbeddingRows([normalized.id]);
    const embeddingResult = await embedVehicles([normalized], embeddingRows);

    return {
      saved: true,
      vehicle: normalized,
      embedded: embeddingResult.updated > 0,
      embeddingError: embeddingResult.error
    };
  } catch (error) {
    return {
      saved: false,
      embedded: false,
      error: error instanceof Error ? error.message : "Failed to save vehicle."
    };
  }
}

export async function deactivateVehicleAdmin(id: string): Promise<UpsertVehicleResult> {
  const existing = await getVehicleAdmin(id);
  if (!existing) {
    return { saved: false, embedded: false, error: "Vehicle not found." };
  }

  return upsertVehicleAdmin({ ...existing, available: false });
}

export async function activateVehicleAdmin(id: string): Promise<UpsertVehicleResult> {
  const existing = await getVehicleAdmin(id);
  if (!existing) {
    return { saved: false, embedded: false, error: "Vehicle not found." };
  }

  return upsertVehicleAdmin({ ...existing, available: true });
}

export async function importVehiclesFromCsv(content: string): Promise<ImportVehiclesResult> {
  const errors: string[] = [];

  let vehicles: Vehicle[];
  try {
    vehicles = parseVehicleSheetCsv(content);
  } catch (error) {
    return {
      imported: 0,
      embedded: 0,
      skipped: 0,
      errors: [error instanceof Error ? error.message : "Invalid CSV."]
    };
  }

  if (vehicles.length > CSV_IMPORT_MAX_ROWS) {
    return {
      imported: 0,
      embedded: 0,
      skipped: 0,
      errors: [`CSV import is limited to ${CSV_IMPORT_MAX_ROWS} rows per upload.`]
    };
  }

  const normalized = vehicles.map((vehicle) => normalizeVehiclePayload(vehicle));
  const supabase = getSupabaseRestConfig();
  if (!supabase) {
    return {
      imported: 0,
      embedded: 0,
      skipped: normalized.length,
      errors: ["Supabase is not configured."]
    };
  }

  let imported = 0;
  for (const chunk of chunkArray(normalized, 50)) {
    try {
      const response = await fetch(`${supabase.url}/rest/v1/vehicles?on_conflict=id`, {
        method: "POST",
        headers: {
          ...supabase.headers,
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(chunk.map((vehicle) => ({ id: vehicle.id, payload: vehicle })))
      });

      if (!response.ok) {
        errors.push(await response.text());
        continue;
      }

      imported += chunk.length;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Import batch failed.");
    }
  }

  const embeddingRows = await fetchVehicleEmbeddingRows(normalized.map((vehicle) => vehicle.id));
  const embeddingResult = await embedVehicles(normalized, embeddingRows, { batchSize: 20 });

  return {
    imported,
    embedded: embeddingResult.updated,
    skipped: embeddingResult.skipped,
    errors,
    embeddingError: embeddingResult.error
  };
}

function mapAdminVehicleRow(row: SupabaseVehicleRow): AdminVehicleListItem | null {
  if (!row.payload || typeof row.payload !== "object") return null;

  const raw = row.payload as Partial<Vehicle>;
  if (!raw.id || !raw.make || !raw.model) return null;

  const vehicle = normalizeVehiclePayload(
    buildDefaultVehicle({
      ...raw,
      id: raw.id,
      make: raw.make,
      model: raw.model,
      year: typeof raw.year === "number" ? raw.year : new Date().getFullYear(),
      available: row.available ?? raw.available
    })
  );

  return {
    ...vehicle,
    available: row.available ?? vehicle.available
  };
}

export function buildAdminVehicleListParams(
  query: AdminVehicleListQuery,
  page: number,
  pageSize: number
) {
  const params = new URLSearchParams({
    select: VEHICLE_SELECT,
    market: "eq.AT",
    order: "make.asc,model.asc,year.desc",
    limit: String(pageSize),
    offset: String((page - 1) * pageSize)
  });

  if (!query.includeUnavailable) {
    params.set("available", "eq.true");
  }

  const search = query.q?.trim();
  if (search) {
    const pattern = buildPostgrestIlikePattern(search);
    params.set(
      "or",
      `(make.ilike.${pattern},model.ilike.${pattern},title.ilike.${pattern},id.ilike.${pattern},location.ilike.${pattern})`
    );
  }

  const make = query.make?.trim();
  if (make) {
    params.set("make", `ilike.${buildPostgrestIlikePattern(make)}`);
  }

  if (query.condition && query.condition !== "any") {
    params.set("condition", `eq.${query.condition}`);
  }

  if (query.bodyType && query.bodyType !== "any") {
    params.set("body_type", `eq.${query.bodyType}`);
  }

  const location = query.location?.trim();
  if (location) {
    params.set("location", `ilike.${buildPostgrestIlikePattern(location)}`);
  }

  if (typeof query.priceMinEUR === "number" && Number.isFinite(query.priceMinEUR)) {
    params.append("price_eur", `gte.${Math.round(query.priceMinEUR)}`);
  }

  if (typeof query.priceMaxEUR === "number" && Number.isFinite(query.priceMaxEUR)) {
    params.append("price_eur", `lte.${Math.round(query.priceMaxEUR)}`);
  }

  return params;
}

function buildPostgrestIlikePattern(value: string) {
  const trimmed = value.trim().replace(/\*/g, "");
  if (!trimmed) return "*";
  return `*${escapePostgrestValue(trimmed)}*`;
}

function escapePostgrestValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,");
}

function parseContentRangeTotal(value: string | null) {
  if (!value) return 0;
  const slash = value.lastIndexOf("/");
  if (slash === -1) return 0;
  const total = Number(value.slice(slash + 1));
  return Number.isFinite(total) ? total : 0;
}

function chunkArray<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}
