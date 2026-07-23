# Exact seat prioritization design

## Goal

When the user asks for an “N-seater” (e.g. sporty 2-seater), true N-seat vehicles must rank above larger cars. Larger cars may still appear as fallbacks with clearly lower scores when few/no exact matches exist.

## Non-goals

- No hard exclusive filter to `seats == N` (would empty results under thin inventory / budget).
- No hybrid SQL migration; keep `seats >= N` eligibility for hard passenger mins.

## Behavior

| Phrasing | Eligibility | Ranking |
| --- | --- | --- |
| “2-seater” / “zweisitzer” / “only 2 seats” | Soft: all vehicles still score; hard min still `seats >= N` when hard passenger applies | Exact `seats == N` boosted; `seats > N` penalized |
| “must seat 5” / “at least 5 seats” | Hard min `seats >= 5` | Unchanged min semantics |
| Family-inferred passengers | Soft | Unchanged |

## Implementation

1. Add `hasExactSeatPreference(criteria)` in `lib/criteria.ts` (N-seater / only-N patterns on constraint source text).
2. Update `scoreCargoPassengers` in `lib/scoring.ts` to boost exact match and penalize excess seats when that preference is active.
3. Unit test: 2-seater query ranks a 2-seat roadster above a 5-seat SUV; larger cars still eligible.
