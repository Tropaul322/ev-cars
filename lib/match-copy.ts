/** User-facing inventory copy — avoid the word "listing". */

export function formatMatchInventoryLabel(_modelCount: number, _matchCount: number) {
  return "Perfect matching for you";
}

export function formatSeeMatchesLabel(matchCount: number) {
  return `See ${matchCount} matching`;
}
