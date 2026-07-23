import { matchDebugWarn } from "../match-debug.ts";
import { normalizeCriteriaShape } from "../criteria.ts";
import type { MatchResult, UserCriteria } from "../types.ts";
import { getSupabaseRestConfig } from "./supabase-rest.ts";

export type MatchSession = {
  id: string;
  testerRegistrationId?: string | null;
  criteria: UserCriteria;
  selectedVehicleIds: string[];
  cachedRecommendations: MatchResult[];
};

type SupabaseMatchSessionRow = {
  id: string;
  tester_registration_id?: string | null;
  criteria: UserCriteria;
  selected_vehicle_ids: string[] | null;
  cached_recommendations?: MatchResult[] | null;
};

const localSessions = new Map<string, MatchSession>();

export async function getMatchSession(id: string, testerRegistrationId?: string | null): Promise<MatchSession | null> {
  const local = localSessions.get(id);
  const localForTester = local && matchesTester(local, testerRegistrationId) ? local : null;
  const supabase = getSupabaseRestConfig();
  if (!supabase) return localForTester;

  const params = new URLSearchParams({
    select: "id,tester_registration_id,criteria,selected_vehicle_ids,cached_recommendations",
    id: `eq.${id}`,
    limit: "1"
  });
  if (testerRegistrationId) params.set("tester_registration_id", `eq.${testerRegistrationId}`);

  try {
    const response = await fetch(`${supabase.url}/rest/v1/match_sessions?${params}`, {
      headers: supabase.headers,
      next: { revalidate: 0 }
    });
    if (!response.ok) return localForTester;
    const rows = (await response.json()) as SupabaseMatchSessionRow[];
    const row = rows[0];
    if (!row) return localForTester;
    return {
      id: row.id,
      testerRegistrationId: row.tester_registration_id ?? null,
      criteria: normalizeCriteriaShape(row.criteria),
      selectedVehicleIds: row.selected_vehicle_ids ?? [],
      cachedRecommendations: Array.isArray(row.cached_recommendations) ? row.cached_recommendations : []
    };
  } catch {
    return localForTester;
  }
}

export async function saveMatchSession(session: MatchSession): Promise<void> {
  const normalizedSession = {
    ...session,
    criteria: normalizeCriteriaShape(session.criteria),
    cachedRecommendations: session.cachedRecommendations ?? []
  };
  localSessions.set(session.id, normalizedSession);

  const supabase = getSupabaseRestConfig();
  if (!supabase) return;

  try {
    const response = await fetch(`${supabase.url}/rest/v1/match_sessions?on_conflict=id`, {
      method: "POST",
      headers: {
        ...supabase.headers,
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify({
        id: session.id,
        tester_registration_id: session.testerRegistrationId ?? null,
        language: session.criteria.language,
        criteria: normalizedSession.criteria,
        selected_vehicle_ids: session.selectedVehicleIds,
        cached_recommendations: normalizedSession.cachedRecommendations
      })
    });
    if (!response.ok) {
      matchDebugWarn("match-session.save-failed", {
        sessionId: session.id,
        status: response.status,
        message: await response.text()
      });
    }
  } catch (error) {
    matchDebugWarn("match-session.save-error", {
      sessionId: session.id,
      reason: error instanceof Error ? error.message : "unknown"
    });
  }
}

function matchesTester(session: MatchSession, testerRegistrationId?: string | null) {
  return !testerRegistrationId || !session.testerRegistrationId || session.testerRegistrationId === testerRegistrationId;
}
