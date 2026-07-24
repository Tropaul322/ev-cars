const locationAliases: Record<string, string> = {
  vienna: "Wien"
};

export function normalizeLocationSearchTerm(location: string) {
  const trimmed = location.trim();
  if (!trimmed) return trimmed;

  const normalized = trimmed
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

  return locationAliases[normalized] ?? trimmed;
}

export function expandLocationSearchPatterns(location: string) {
  const normalized = normalizeLocationSearchTerm(location);
  return normalized ? [normalized] : [];
}

/** Austrian (and similar) postal codes are too narrow for inventory `location` filters. */
export function isPostalLocationCode(location: string) {
  return /^\d{4,5}$/.test(location.trim());
}

/**
 * Locations used as hard Supabase filters. Postal codes are excluded so
 * registration ZIP codes (e.g. "1010") do not zero the candidate pool.
 */
export function resolveInventoryLocationFilter(location: string | null | undefined) {
  if (!location?.trim()) return null;
  if (isPostalLocationCode(location)) return null;
  const normalized = normalizeLocationSearchTerm(location);
  return normalized || null;
}
