import { getVehicleById } from "./vehicle-repository.ts";
import { getSupabaseRestConfig } from "./supabase-rest.ts";
import type { Vehicle, VehicleCondition } from "../types.ts";

export type SavedCarSnapshot = {
  id: string;
  name: string;
  make?: string;
  model?: string;
  year?: number;
  price: string;
  condition: string;
  location?: string | null;
  image?: string | null;
  match?: number | null;
  range?: string | null;
  mileage?: string | null;
};

export type SavedCar = {
  id: string;
  testerRegistrationId: string;
  vehicleId: string;
  snapshot: SavedCarSnapshot | null;
  vehicle: Vehicle | null;
  createdAt: string;
  updatedAt: string;
};

type SavedCarRow = {
  id: string;
  tester_registration_id: string;
  vehicle_id: string;
  snapshot: SavedCarSnapshot | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
};

const localSavedCars = new Map<string, SavedCarRow>();

export async function listSavedCars(testerRegistrationId: string): Promise<SavedCar[]> {
  const rows = await listSavedCarRows(testerRegistrationId);
  const cars = await Promise.all(rows.map(rowToSavedCar));
  return cars.filter((car) => car.vehicle || car.snapshot);
}

export async function getSavedVehicleIds(testerRegistrationId: string): Promise<Set<string>> {
  const rows = await listSavedCarRows(testerRegistrationId);
  return new Set(rows.map((row) => row.vehicle_id));
}

export async function isCarSaved(testerRegistrationId: string, vehicleId: string): Promise<boolean> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) {
    const row = getLocalSavedRow(testerRegistrationId, vehicleId);
    return Boolean(row && !row.deleted_at);
  }

  const params = new URLSearchParams({
    select: "id",
    tester_registration_id: `eq.${testerRegistrationId}`,
    vehicle_id: `eq.${vehicleId}`,
    deleted_at: "is.null",
    limit: "1"
  });

  try {
    const response = await fetch(`${supabase.url}/rest/v1/saved_cars?${params}`, {
      headers: supabase.headers,
      next: { revalidate: 0 }
    });
    if (!response.ok) return false;
    const rows = (await response.json()) as Array<{ id: string }>;
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function saveCar(
  testerRegistrationId: string,
  vehicleId: string,
  snapshot: SavedCarSnapshot | null
): Promise<{ saved: true } | { saved: false; error: string }> {
  const cleanVehicleId = vehicleId.trim();
  if (!cleanVehicleId) return { saved: false, error: "vehicleId is required" };

  const cleanSnapshot = snapshot ? sanitizeSnapshot({ ...snapshot, id: cleanVehicleId }) : null;
  const supabase = getSupabaseRestConfig();

  if (!supabase) {
    const now = new Date().toISOString();
    const key = savedCarKey(testerRegistrationId, cleanVehicleId);
    const existing = localSavedCars.get(key);
    localSavedCars.set(key, {
      id: existing?.id ?? crypto.randomUUID(),
      tester_registration_id: testerRegistrationId,
      vehicle_id: cleanVehicleId,
      snapshot: cleanSnapshot,
      created_at: existing?.created_at ?? now,
      updated_at: now
    });
    return { saved: true };
  }

  const existing = await findSavedCarRow(testerRegistrationId, cleanVehicleId);
  if (existing) {
    const response = await fetch(`${supabase.url}/rest/v1/saved_cars?id=eq.${existing.id}`, {
      method: "PATCH",
      headers: {
        ...supabase.headers,
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        snapshot: cleanSnapshot,
        deleted_at: null
      })
    });
    return response.ok ? { saved: true } : { saved: false, error: await response.text() };
  }

  const response = await fetch(`${supabase.url}/rest/v1/saved_cars`, {
    method: "POST",
    headers: {
      ...supabase.headers,
      Prefer: "return=minimal"
    },
    body: JSON.stringify({
      tester_registration_id: testerRegistrationId,
      vehicle_id: cleanVehicleId,
      snapshot: cleanSnapshot
    })
  });

  return response.ok ? { saved: true } : { saved: false, error: await response.text() };
}

export async function unsaveCar(
  testerRegistrationId: string,
  vehicleId: string
): Promise<{ saved: false } | { saved: true; error: string }> {
  const cleanVehicleId = vehicleId.trim();
  if (!cleanVehicleId) return { saved: true, error: "vehicleId is required" };

  const supabase = getSupabaseRestConfig();
  const deletedAt = new Date().toISOString();

  if (!supabase) {
    const row = getLocalSavedRow(testerRegistrationId, cleanVehicleId);
    if (row) {
      localSavedCars.set(savedCarKey(testerRegistrationId, cleanVehicleId), {
        ...row,
        updated_at: deletedAt,
        deleted_at: deletedAt
      });
    }
    return { saved: false };
  }

  const params = new URLSearchParams({
    tester_registration_id: `eq.${testerRegistrationId}`,
    vehicle_id: `eq.${cleanVehicleId}`,
    deleted_at: "is.null"
  });

  const response = await fetch(`${supabase.url}/rest/v1/saved_cars?${params}`, {
    method: "PATCH",
    headers: {
      ...supabase.headers,
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ deleted_at: deletedAt })
  });

  return response.ok ? { saved: false } : { saved: true, error: await response.text() };
}

function sanitizeSnapshot(snapshot: SavedCarSnapshot): SavedCarSnapshot {
  return {
    id: snapshot.id,
    name: normalizeSnapshotString(snapshot.name) || snapshot.id,
    make: normalizeSnapshotString(snapshot.make),
    model: normalizeSnapshotString(snapshot.model),
    year: typeof snapshot.year === "number" ? snapshot.year : undefined,
    price: normalizeSnapshotString(snapshot.price) || "Price on request",
    condition: normalizeSnapshotString(snapshot.condition) || "EV",
    location: normalizeSnapshotString(snapshot.location),
    image: normalizeSnapshotString(snapshot.image),
    match: typeof snapshot.match === "number" ? snapshot.match : null,
    range: normalizeSnapshotString(snapshot.range),
    mileage: normalizeSnapshotString(snapshot.mileage)
  };
}

function normalizeSnapshotString(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 500) || undefined : undefined;
}

async function listSavedCarRows(testerRegistrationId: string): Promise<SavedCarRow[]> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) {
    return [...localSavedCars.values()]
      .filter((row) => row.tester_registration_id === testerRegistrationId && !row.deleted_at)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  const params = new URLSearchParams({
    select: "id,tester_registration_id,vehicle_id,snapshot,created_at,updated_at",
    tester_registration_id: `eq.${testerRegistrationId}`,
    deleted_at: "is.null",
    order: "updated_at.desc"
  });

  try {
    const response = await fetch(`${supabase.url}/rest/v1/saved_cars?${params}`, {
      headers: supabase.headers,
      next: { revalidate: 0 }
    });
    if (!response.ok) return [];
    return (await response.json()) as SavedCarRow[];
  } catch {
    return [];
  }
}

async function findSavedCarRow(testerRegistrationId: string, vehicleId: string): Promise<SavedCarRow | null> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return getLocalSavedRow(testerRegistrationId, vehicleId);

  const params = new URLSearchParams({
    select: "id,tester_registration_id,vehicle_id,snapshot,created_at,updated_at",
    tester_registration_id: `eq.${testerRegistrationId}`,
    vehicle_id: `eq.${vehicleId}`,
    limit: "1"
  });

  try {
    const response = await fetch(`${supabase.url}/rest/v1/saved_cars?${params}`, {
      headers: supabase.headers,
      next: { revalidate: 0 }
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as SavedCarRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function rowToSavedCar(row: SavedCarRow): Promise<SavedCar> {
  return {
    id: row.id,
    testerRegistrationId: row.tester_registration_id,
    vehicleId: row.vehicle_id,
    snapshot: row.snapshot,
    vehicle: await getVehicleById(row.vehicle_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getLocalSavedRow(testerRegistrationId: string, vehicleId: string) {
  return localSavedCars.get(savedCarKey(testerRegistrationId, vehicleId)) ?? null;
}

function savedCarKey(testerRegistrationId: string, vehicleId: string) {
  return `${testerRegistrationId}:${vehicleId}`;
}

export function snapshotFromVehicle(vehicle: Vehicle, match?: number | null): SavedCarSnapshot {
  return {
    id: vehicle.id,
    name: `${vehicle.make} ${vehicle.model}`,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    price: formatEUR(vehicle.priceEUR),
    condition: formatCondition(vehicle.condition),
    location: vehicle.location ?? null,
    image: vehicle.images[0] ?? null,
    match: match ?? null,
    range: `${vehicle.rangeKm.toLocaleString("de-AT")} km`,
    mileage: vehicle.mileageKm === null ? null : `${vehicle.mileageKm.toLocaleString("de-AT")} km`
  };
}

function formatCondition(condition: VehicleCondition) {
  return condition === "new" ? "New" : "Used";
}

function formatEUR(value: number) {
  return new Intl.NumberFormat("de-AT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0
  }).format(value);
}
