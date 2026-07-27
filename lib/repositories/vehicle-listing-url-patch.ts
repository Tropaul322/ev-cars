import type { Vehicle } from "../types.ts";
import { getSupabaseRestConfig } from "./supabase-rest.ts";

export type PatchVehicleListingUrlsResult = {
  requested: number;
  updated: number;
  missing: string[];
  skipped: string[];
  errors: string[];
};

type VehicleRow = {
  id: string;
  payload: Vehicle;
};

export async function patchVehicleListingUrls(
  listingUrlsById: Map<string, string>,
  options: { dryRun?: boolean; batchSize?: number } = {}
): Promise<PatchVehicleListingUrlsResult> {
  const dryRun = options.dryRun ?? false;
  const batchSize = options.batchSize ?? 50;
  const requestedIds = [...listingUrlsById.keys()];
  const missing: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const rowsToUpsert: VehicleRow[] = [];

  const supabase = getSupabaseRestConfig();
  if (!supabase) {
    return {
      requested: requestedIds.length,
      updated: 0,
      missing: dryRun ? [] : requestedIds,
      skipped: [],
      errors: dryRun ? [] : ["Supabase is not configured."]
    };
  }

  for (const idChunk of chunk(requestedIds, batchSize)) {
    let existingRows: VehicleRow[] = [];
    try {
      existingRows = await fetchVehiclesByIds(idChunk);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Failed to fetch vehicles.");
      continue;
    }

    const existingById = new Map(existingRows.map((row) => [row.id, row]));

    for (const id of idChunk) {
      const listingUrl = listingUrlsById.get(id);
      if (!listingUrl) {
        skipped.push(id);
        continue;
      }

      const existing = existingById.get(id);
      if (!existing) {
        missing.push(id);
        continue;
      }

      if (existing.payload.listingUrl === listingUrl) {
        skipped.push(id);
        continue;
      }

      rowsToUpsert.push({
        id,
        payload: {
          ...existing.payload,
          id,
          listingUrl
        }
      });
    }
  }

  if (dryRun || rowsToUpsert.length === 0) {
    return {
      requested: requestedIds.length,
      updated: rowsToUpsert.length,
      missing,
      skipped,
      errors
    };
  }

  for (const rowChunk of chunk(rowsToUpsert, batchSize)) {
    try {
      const response = await fetch(`${supabase.url}/rest/v1/vehicles?on_conflict=id`, {
        method: "POST",
        headers: {
          ...supabase.headers,
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(rowChunk)
      });

      if (!response.ok) {
        errors.push(await response.text());
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Listing URL patch batch failed.");
    }
  }

  const updated = errors.length === 0 ? rowsToUpsert.length : 0;

  return {
    requested: requestedIds.length,
    updated,
    missing,
    skipped,
    errors
  };
}

async function fetchVehiclesByIds(ids: string[]): Promise<VehicleRow[]> {
  const supabase = getSupabaseRestConfig();
  if (!supabase || ids.length === 0) return [];

  const params = new URLSearchParams({
    select: "id,payload",
    id: `in.(${ids.join(",")})`
  });

  const response = await fetch(`${supabase.url}/rest/v1/vehicles?${params}`, {
    headers: supabase.headers,
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch vehicles: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as VehicleRow[];
}

function chunk<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}
