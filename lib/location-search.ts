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
