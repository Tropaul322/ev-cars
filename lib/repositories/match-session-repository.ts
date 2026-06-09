import { normalizeCriteriaShape } from "../criteria.ts";
import type { UserCriteria } from "../types.ts";
import { getSupabaseRestConfig } from "./supabase-rest.ts";

export type MatchSession = {
  id: string;
  criteria: UserCriteria;
  selectedVehicleIds: string[];
};

type SupabaseMatchSessionRow = {
  id: string;
  criteria: UserCriteria;
  selected_vehicle_ids: string[] | null;
};

const localSessions = new Map<string, MatchSession>();

export async function getMatchSession(id: string): Promise<MatchSession | null> {
  const local = localSessions.get(id);
  const supabase = getSupabaseRestConfig();
  if (!supabase) return local ?? null;

  const params = new URLSearchParams({
    select: "id,criteria,selected_vehicle_ids",
    id: `eq.${id}`,
    limit: "1"
  });

  try {
    const response = await fetch(`${supabase.url}/rest/v1/match_sessions?${params}`, {
      headers: supabase.headers,
      next: { revalidate: 0 }
    });
    if (!response.ok) return local ?? null;
    const rows = (await response.json()) as SupabaseMatchSessionRow[];
    const row = rows[0];
    if (!row) return local ?? null;
    return {
      id: row.id,
      criteria: normalizeCriteriaShape(row.criteria),
      selectedVehicleIds: row.selected_vehicle_ids ?? []
    };
  } catch {
    return local ?? null;
  }
}

export async function saveMatchSession(session: MatchSession): Promise<void> {
  const normalizedSession = {
    ...session,
    criteria: normalizeCriteriaShape(session.criteria)
  };
  localSessions.set(session.id, normalizedSession);

  const supabase = getSupabaseRestConfig();
  if (!supabase) return;

  try {
    await fetch(`${supabase.url}/rest/v1/match_sessions?on_conflict=id`, {
      method: "POST",
      headers: {
        ...supabase.headers,
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify({
        id: session.id,
        language: session.criteria.language,
        criteria: normalizedSession.criteria,
        selected_vehicle_ids: session.selectedVehicleIds
      })
    });
  } catch {
    // Local session state is enough for the current request path.
  }
}
