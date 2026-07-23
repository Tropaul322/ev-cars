# Criteria pivot reset and brand-widen grounding

**Date:** 2026-07-23  
**Status:** Approved for planning  
**Related:** `2026-07-23-match-pipeline-v2-hardening-design.md` (partial pivot vs refinement)

## Problem

Across turns, sticky `brandPreferences` / models survive profile shifts and “other brands” asks:

1. User asks for Ford cars, then “any sporty 2-seater” — Ford still filters or ranks results.
2. User asks “What other car brands can you suggest?” — brand lock remains, and the LLM often answers with a generic brand encyclopedia (`ev_question` / conversational path) instead of rematching inventory and grounding the reply in real makes.

Today’s `isTopicPivot` / `hasTopicConflict` mainly cover cue words and family↔sport / body conflicts. A **brand-only** prior plus a new vehicle profile without “instead” does not clear brands. Brand-widen phrasing is not routed to rematch with an explicit brand clear.

## Goals

- Detect **profile pivots** vs **mild refinements**; genuine pivots reset prior topic hard filters (including brands/models when appropriate).
- **LLM primary** for pivot/brand-widen decisions via intent + criteria-normalizer prompts.
- **Deterministic fallback** when the LLM fails, times out, or omits the clear.
- “Other brands” clears brand/model filters, rematches on remaining criteria, and grounds the assistant reply in **distinct makes from those matches** (choice A).
- Preserve budget and charging on pivot (`buildPivotBase` behavior).

## Non-goals

- New DB schema or hybrid RPC changes.
- Redesigning alternatives cache beyond rematch after brand clear.
- Languages beyond EN/DE already used in the app.
- Changing general RAG / EV Q&A except brand-suggestion and post-pivot match intros.

## Decisions (from brainstorming)

| Topic | Choice |
| --- | --- |
| “What other brands?” | Clear brand, rematch, answer with brands present in new matches |
| When to clear brands on profile change | Profile pivots only — not mild refinements (“under 35k”, “add heated seats”) |
| Brand-only prior → sporty 2-seater | Counts as profile pivot; clear brands/models if the new turn does not restate the brand |
| LLM vs rules | Hybrid: LLM learns pivots; deterministic safety net |

## Architecture

Two layers, same outcome:

1. **LLM primary**
   - Intent classifier: brand-widen and profile pivots are shopping turns (`update_criteria` / rematch), not bare `ev_question`.
   - Criteria normalizer: on true pivot, emit only fields implied by the new request and/or `remove: ["brand","model"]`; do not re-merge old brands when the user did not restate them.
2. **Deterministic fallback**
   - Extend `isTopicPivot` / `hasTopicConflict` for brand-only prior + new seats/body/sport-family profile without restating prior brands (keep existing family↔sport and body conflicts).
   - `looksLikeBrandWidenRequest` (EN/DE) clears brands/models and forces rematch when ready.
   - Post-patch safety net: when deterministic profile-pivot or brand-widen conditions fire and the LLM left prior brands/models in place, force-clear them before scoring.

## Data flow

1. **Intent** (LLM → pattern fallback)  
   Brand-widen → shopping path with brand/model clear intent. Pattern: `looksLikeBrandWidenRequest` if misrouted to `ev_question`.

2. **Normalize**  
   - Before merge: deterministic pivot or brand-widen → `buildPivotBase` and/or clear brand+model.  
   - Apply LLM patch (taught the same rules).  
   - After patch: profile-pivot / brand-widen safety net as above.  
   - Mild refinements leave brands alone. Brand restated in the new turn keeps/sets that brand.

3. **Match**  
   Brand-widen and pivots that clear brands set `criteriaChanged` and use the normal rematch path when budget/readiness allows.

4. **Reply grounding**  
   On brand-widen rematch: collect distinct makes from recommendations (optionally top candidates). Pass that list into the match intro / grounded prompt: suggest only those brands; do not invent catalog brands. On `no_matches`, explain and suggest relaxing filters — still no free-form brand list.

## Pivot and brand-widen rules

### Profile pivot (clears topic filters via `buildPivotBase`)

Preserve: budget, charging.  
Clear: trip, body, passengers, cargo, features, brands, models, origins, qualitative, directive.

Triggers (any of):

- Existing cue words (`instead`, `forget that`, `actually`, DE equivalents).
- Existing family↔sport / body-set conflicts.
- **New:** prior topic included brands (and optionally little else) and the latest turn introduces a concrete vehicle profile (passengers / body / sport-family use signals) **without** restating those brands.

### Mild refinement (no brand clear)

Examples: budget tweaks, feature adds, charging tweaks, “preferably efficient” — keep compatible prior criteria including brands.

### Brand-widen (targeted clear)

Phrases like “what other brands”, “any brand”, “which brands can you suggest”, DE: *andere Marken*, *welche Marken*, *egal welche Marke*.

- Clear `brandPreferences` and `modelPreferences` (and stop hard brand constraints).
- Rematch on remaining criteria when ready.
- Ground reply in match makes only.

### Brand restated

“Sporty Ford 2-seater” after a Ford prior keeps/sets Ford; not a brand clear.

## Edge cases

- Brand-widen with no budget yet: clear brands, continue clarification; do not invent brands in chat.
- LLM empty/wrong patch or timeout: deterministic path still applies.
- After clear: empty `brandPreferences` → no hard brand filter; scoring does not prefer the old brand.

## Testing

1. Ford-only prior + “any sporty 2-seater” → pivot; brands cleared; passengers/performance set; budget kept.
2. Family SUV + Ford + “under 45k” → not a pivot; Ford kept.
3. “What other car brands can you suggest?” with Ford locked → brands cleared; rematch when ready.
4. Brand-widen reply uses only makes from mock match results.
5. Existing cue / family↔sport pivot tests still pass.
6. Intent: brand-widen not pure `ev_question` when brands are active (pattern fallback).

Manual: Ford → sporty 2-seater → other brands; logs show cleared `brandPreferences` and grounded reply.

## Primary files

- `lib/criteria-normalizer.ts` — pivot detection, post-patch safety net, normalizer prompt
- `lib/criteria.ts` — `looksLikeBrandWidenRequest` (and helpers)
- `lib/conversational-intent.ts` — trigger + prompt rules
- `lib/match-service.ts` / `lib/assistant-messages.ts` — ground brand-suggestion intros
- `tests/matching.test.ts`, `tests/conversational-intent.test.ts`

## Success criteria

- Ford → sporty 2-seater no longer returns brand-locked Ford-only sets when the user did not restate Ford.
- “What other brands?” rematches without Ford filter and names only brands present in results (or honestly reports no matches).
- Mild budget/feature refinements still preserve brand focus.
- LLM failure still yields correct clears via deterministic fallback.
