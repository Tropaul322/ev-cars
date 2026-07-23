# Match pipeline v2 hardening design

Date: 2026-07-23  
Status: Approved for implementation

## Context

Live PoC testing produced a v2 requirements document for FlowRyd’s Understand → Decide → Retrieve → Filter+Score → Select+Explain → Respond pipeline. Most of that document is already implemented in the codebase. A quality review found several “shipped but incomplete” gaps relative to the live-test goals, plus a few places where the implementation already exceeds the document.

This design closes the remaining quality gaps without reworking the overall pipeline shape.

## Quality scorecard (document vs implementation)

| # | Requirement | Verdict | Action |
|---|---|---|---|
| 1 | Single best match + “Show other options” | Implementation better | Keep dual path (button local reveal + typed cache API) |
| 2 | Never match on first turn | Partial | Tighten: chip patch alone must not bypass first-turn gate |
| 3 | No unlimited budget; real range or default | Equivalent | Keep |
| 4 | Fallback/timeout across Retrieve→Score→Explain | Partial | Force match when ready; wrap pre-pipeline; non-empty score fallback; client abort |
| 5 | Optimization directive → scoring weights | Partial | Complete chips (7/7); document proxy weight mappings |
| 6 | Pivot vs refinement; reset hard flags | Partial | Topic-conflict pivots without cue words; latest-turn hard flags |
| 7 | Cache 2nd/3rd; alternatives without re-search | Equivalent | Keep DB session cache |
| 8 | Hard vs soft filters (seats/cargo) | Partial | Soften body/condition/brand/origin unless exclusive |
| 9 | Numeric sanity checks | Implementation better | Keep broader checks |
| 10 | One visible + runner-up justification | Partial | Improve comparative copy; singular recommendation tone |

### Keep (implementation exceedances)

- Button reveals alternatives from client state with no round-trip; typed “show other options” serves session-cached runner-ups
- `match_sessions.cached_recommendations` persistence across serverless invocations
- Sanity checks beyond price/range (efficiency, battery kWh, seats, cargo, power, SoH)
- Default budget notice when user says “price doesn’t matter”
- Distinct `show_alternatives` vs `next_batch` intents

### Fix (risky divergences)

- Ready copy (“Let me search now”) can be spoken without Retrieve
- Pipeline deadline excludes Understand/Decide LLM steps
- `filter_score` timeout can return an empty set → false `no_matches`
- Body type, condition, brand, and brand origin are always hard when set
- Accumulated `rawPrompt` can re-arm old exclusive seat/range language after a soft pivot
- Optimization chips cover only 4 of 7 directives

## Paralect confirmations

### 1. Fallback/timeout coverage

**Current:** `withPipelineFallback` wraps retrieve, knowledge, filter_score, llm_score, and select_explain under a shared ~10s deadline (`FLOWRYD_MATCH_PIPELINE_TIMEOUT_MS`).

**After this work:** The same deadline starts at the beginning of `runMatchRequest` and also wraps intent resolution + criteria normalization (fallback: regex/pattern-only paths). Ready-search copy is never returned without matching in the same turn. Score-stage timeout falls back to deterministic scoring of already-retrieved candidates, not an empty list.

**Still out of scope:** Cancelling in-flight OpenAI/DB work when a `Promise.race` timeout wins.

### 2. Optimization directive detection and weight mapping

**Detection (hybrid, keep):**

1. Regex via `extractOptimizationDirective`
2. Optional LLM normalizer field
3. Clarification chips (expanded to all 7)

**Weight mapping (`deriveWeights`):**

| Directive | Weight effect |
|---|---|
| `best_value` | +priceFit, +efficiencyFit, +reliabilityFit |
| `maximum_range` | +rangeFit, +efficiencyFit, −priceFit |
| `most_reliable` | +reliabilityFit, +efficiencyFit |
| `fastest_charging` | +featureFit, +rangeFit (proxy; no dedicated charge-power score) |
| `lowest_running_cost` | +efficiencyFit, +priceFit |
| `best_family_fit` | +cargoPassengerFit, +rangeFit, +reliabilityFit |
| `performance` | +featureFit, +brandFit, +rangeFit (proxy; no dedicated 0–100 score) |

Proxy mappings for charging and performance are intentional this pass; do not invent new scoring dimensions without vehicle fields to back them.

### 3. Hard vs soft attribute list

See the policy table below. Seats and cargo already follow the document. Body, condition, brand, and origin move to soft-by-default with exclusive-language hard mode.

## Hard vs soft filter policy

**Rule of thumb:** Hard = reject outright. Soft = keep in the pool and rank down. Casual preferences must not empty inventory. Exclusive language (`only` / `must` / `nur` / equivalent) may hard-reject.

### Always hard

| Attribute | Notes |
|---|---|
| Market (AT), availability | Inventory boundary |
| Budget min/max, monthly budget | Required for precise scoring |
| Explicit mileage cap | Concrete ceiling |
| Required battery SoH | Concrete ceiling |
| Exact model preference | Inventory lookup |
| Avoided brands | Explicit exclusion |
| Must-have features | Explicit requirement |

### Hard only with exclusive language (or model inventory lookup)

| Attribute | Soft when | Hard when |
|---|---|---|
| Passengers / seats | Family-inferred or casual seat count | `must seat 5`, `2-seater`, etc. |
| Range floor | Qualitative / inferred | `at least 400 km`, etc. |
| Body type | “looking for an SUV”, body chip | `only SUV`, `must be a wagon` |
| Condition | “preferably used” | `only used`, `must be new` |
| Brand | “something like VW” | `only Tesla`, or model preference set |
| Brand origin | “European brands” | `only European brands` |

### Always soft

| Attribute | Behavior |
|---|---|
| Family-inferred cargo | Penalize in `cargoPassengerFit` |
| Cargo needs (default) | Soft; optional hard only for explicit “must have large boot / need X liters” if added later |
| Optimization directive | Reweight factors only |
| Reliability / qualitative signals | Existing reliability scoring |
| Trip needs | Affinity / RAG; never hard-reject |

### Soft scoring when not hard

- Body preference folds into `cargoPassengerFit` (match preferred types; near-misses lower)
- Condition preference folds into `reliabilityFit`
- Brand/origin keep existing `scoreBrand` gap (~100 vs ~52) but must reach scoring (no hard reject unless exclusive)
- Retrieve SQL filters for body/condition/brand/origin apply **only** when the matching `hasHard*` helper is true

### Not softening

- Budget stretch above max
- Model mismatches (no Model 3 for Model Y)
- Avoided brands and must-have features

## Stall / timeout behavior

### Invariants

1. **Ready → match:** If the next clarification key would be `ready`, force `wantsMatch` in the same turn. Never return ready-search copy as a clarification-only reply.
2. **Shared deadline:** Create deadline at start of `runMatchRequest`. Wrap pre-pipeline LLM with regex fallback; keep stage wrappers for retrieve → explain.
3. **Non-empty score fallback:** If filter/score times out after retrieve succeeded, run deterministic `matchVehicles` on the sanity-filtered retrieved list.
4. **Client guardrail:** `AbortController` ~15s on `/api/match` with recoverable “Search took too long — try again.”

### First-turn gate

A brand-new session must clarify at least once before matching, including when the first input is only a chip `criteriaPatch`. Gate on absence of prior conversation clarification / prior criteria context, not on “patch present ⇒ skip.”

## Pivot and hard-flag rules

### Pivot detection

Keep cue-based pivots (`instead`, `forget that`, `actually`, DE equivalents).

Add topic-conflict pivots without cue words when the new turn introduces a conflicting vehicle profile, for example:

- Family / high cargo / 5+ seats ↔ sports / 2-seater / coupe
- SUV-heavy body set ↔ sedan/coupe sports signals

`buildPivotBase` continues to clear topic filters (trip, body, passengers, cargo, features, brands, models, origins, qualitative, directive) while preserving budget and charging.

### Hard-constraint text scope

`hasHardPassengerConstraint`, `hasHardRangeConstraint`, and new body/condition/brand/origin helpers evaluate exclusive language against the **latest user turn**, not the full accumulated `rawPrompt`. This prevents an earlier “must seat 5” from re-arming after a later soft pivot.

## Select + explain

- Always surface exactly one visible recommendation; cache and pre-explain top 3
- Primary explanation ends with a comparative coda naming runner-ups and citing 1–2 concrete facts (price, range, seats, body)
- Assistant / LLM intro language refers to a single recommendation, not plural “ranked listings”
- Alternatives: button = local reveal; typed request = cached API path (`responseMode: "alternatives"`) with no new search when criteria unchanged

## Testing

- Ready path never returns search copy without `matches` or `no_matches`
- Pre-pipeline timeout falls back to regex/pattern path
- Filter/score timeout still returns scored candidates from retrieved inventory
- Soft body/condition/brand keep near-misses; exclusive language hard-rejects
- Topic conflict without cue words resets topic filters
- Latest-turn hard flags: old “must seat 5” does not survive a soft pivot
- First-turn chip-only request asks clarification instead of matching
- Existing: single visible + alts, first-turn optimization, budget default, sanity checks, alternatives cache

## Out of scope

- Aborting in-flight provider/DB calls on timeout race loss
- New scoring dimensions for charging power or 0–100 acceleration
- Changing default pipeline timeout beyond existing env override
- Redesigning the chat UI beyond timeout UX and existing alternatives affordance
