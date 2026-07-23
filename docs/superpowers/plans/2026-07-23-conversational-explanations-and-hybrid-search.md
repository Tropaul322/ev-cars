# Conversational Explanations and Hybrid Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer recommendation-explanation follow-ups from cached evidence without searching again, and make vehicle candidate retrieval filter-aware, hybrid, and measurable.

**Architecture:** The match service receives a new `explain_recommendations` trigger which reads only the persisted match session and turns its deterministic reason ledgers into a localized response. A Postgres RPC retrieves hard-filter-eligible structured, full-text, and vector candidates, fuses their ranks with RRF, and the existing deterministic scorer produces the final explanation evidence.

**Tech Stack:** Next.js 15 App Router, TypeScript, Node test runner, OpenAI chat completions, Supabase PostgREST/Postgres, pgvector, PostgreSQL full-text search.

## Global Constraints

- `Vehicle.payload` remains the canonical full vehicle record; stored database columns are derived search fields.
- Explicit hard constraints determine eligibility; soft preferences only influence order.
- Explanation requests must never call criteria normalization, retrieval, scoring, or LLM reranking.
- LLM prompts may use only cached vehicle facts, deterministic reason ledgers, and permitted RAG evidence.
- No numeric score breakdown is shown unless a future explicit deep-breakdown request is added.
- LLM failure, timeout, or invalid JSON must return a localized deterministic response.
- Do not write full user messages, registration names, emails, or locations to diagnostics.
- Add migrations with the Supabase CLI when executing; do not invent migration filenames manually.

---

## Planned File Structure

| File | Responsibility |
| --- | --- |
| `lib/types.ts` | Reason-ledger and hybrid-retrieval types persisted with `MatchResult`. |
| `lib/recommendation-reasons.ts` | Pure construction and localized rendering of factual reason ledgers. |
| `lib/conversational-intent.ts` | Pattern and LLM routing for explanation follow-ups. |
| `lib/recommendation-explanations.ts` | Grounded LLM explanation prompt, parsing, and deterministic fallback. |
| `lib/match-service.ts` | Isolated explanation handler before criteria normalization and search. |
| `lib/repositories/vehicle-repository.ts` | Calls the hybrid RPC and maps retrieval signals. |
| `supabase/migrations/<generated>_add_hybrid_vehicle_search.sql` | Search vector, indexes, and typed hybrid RPC. |
| `tests/conversational-intent.test.ts` | Intent and no-rematch behavior. |
| `tests/matching.test.ts` | Reason ledgers, fallback, hard filters, and LLM rerank safety. |
| `tests/vehicle-repository.test.ts` | RPC input/output mapping and filter-aware retrieval. |
| `lib/data/eval-scenarios.ts` / `scripts/run-evals.ts` | Labeled top-K and explanation-factuality evaluations. |

### Task 1: Persist deterministic recommendation reasons

**Files:**
- Create: `lib/recommendation-reasons.ts`
- Modify: `lib/types.ts:207-263`
- Modify: `lib/scoring.ts:95-117`
- Test: `tests/matching.test.ts`

**Interfaces:**
- Produces `RecommendationReasonLedger` and `buildRecommendationReasonLedger(match, criteria)`.
- `MatchResult.reasonLedger` is available to cached sessions and the later explanation handler.

- [ ] **Step 1: Write failing tests for factual reason ledgers**

```ts
import { buildRecommendationReasonLedger } from "../lib/recommendation-reasons.ts";

test("reason ledger uses vehicle fields and exposes one trade-off", () => {
  const match = matchVehicles(seedVehicles, extractCriteria(
    "SUV under 50000 EUR for family trips, at least 400 km range"
  )).recommendations[0]!;
  const ledger = buildRecommendationReasonLedger(match, extractCriteria(
    "SUV under 50000 EUR for family trips, at least 400 km range"
  ));

  assert.ok(ledger.positiveReasons.every((reason) => reason.field in match.vehicle));
  assert.ok(ledger.passedHardFilters.includes("budget"));
  assert.deepEqual(ledger.tradeoffs, match.ruledOutReasons.slice(0, 2));
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- --test-name-pattern="reason ledger"`  
Expected: FAIL because `recommendation-reasons.ts` and `reasonLedger` do not exist.

- [ ] **Step 3: Add stable ledger types and pure builder**

```ts
// lib/types.ts
export type RecommendationReason = {
  field: keyof Vehicle;
  label: string;
  value: string | number | boolean;
};

export type RecommendationReasonLedger = {
  positiveReasons: RecommendationReason[];
  tradeoffs: string[];
  passedHardFilters: string[];
  factorContributions: Partial<ScoringBreakdown>;
  evidenceIds: string[];
};

// add to MatchResult
reasonLedger: RecommendationReasonLedger;
```

```ts
// lib/recommendation-reasons.ts
export function buildRecommendationReasonLedger(
  match: Omit<MatchResult, "reasonLedger">,
  criteria: UserCriteria
): RecommendationReasonLedger {
  const reasons: RecommendationReason[] = [];
  if (criteria.budgetMaxEUR !== null) {
    reasons.push({ field: "priceEUR", label: "price", value: match.vehicle.priceEUR });
  }
  if (criteria.rangeFloorKm !== null || criteria.tripNeeds.length) {
    reasons.push({ field: "rangeKm", label: "range", value: match.vehicle.rangeKm });
  }
  if (criteria.passengers !== null || criteria.cargoNeeds !== null || criteria.tripNeeds.includes("family")) {
    reasons.push({ field: "seats", label: "seats", value: match.vehicle.seats });
    reasons.push({ field: "cargoLiters", label: "cargo", value: match.vehicle.cargoLiters });
  }
  return {
    positiveReasons: reasons,
    tradeoffs: match.ruledOutReasons.slice(0, 2),
    passedHardFilters: passedHardFilterKeys(criteria),
    factorContributions: match.scoringBreakdown,
    evidenceIds: match.ragEvidence.map((evidence) => evidence.sourceId)
  };
}
```

Update `matchVehicles` to build the ledger immediately after `scoringBreakdown` and before pushing each `MatchResult`. Update every test fixture and mock `MatchResult` to include `reasonLedger`.

- [ ] **Step 4: Run unit tests and static checks**

Run: `npm test -- --test-name-pattern="reason ledger|hard filter|scoring"`  
Expected: PASS.  
Run: `npm run typecheck`  
Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/recommendation-reasons.ts lib/scoring.ts tests/matching.test.ts
git commit -m "feat: persist deterministic recommendation reasons"
```

### Task 2: Route and answer explanation follow-ups without rematching

**Files:**
- Create: `lib/recommendation-explanations.ts`
- Modify: `lib/conversational-intent.ts:7-70,104-219,433-475`
- Modify: `lib/match-service.ts:107-236`
- Test: `tests/conversational-intent.test.ts`
- Test: `tests/matching.test.ts`

**Interfaces:**
- Produces `generateRecommendationExplanation(input): Promise<string>`.
- `ConversationTrigger` includes `explain_recommendations`.
- `runMatchRequest()` returns `type: "chat"` without executing match stages for this trigger.

- [ ] **Step 1: Add failing intent and no-rematch tests**

```ts
test("routes English and German why-recommendation follow-ups to explanation", () => {
  assert.ok(detectPatternTriggers("Why are you suggesting these cars?").includes("explain_recommendations"));
  assert.ok(detectPatternTriggers("Warum schlägst du mir diese Autos vor?").includes("explain_recommendations"));
});

test("cached explanation returns chat without matching again", async () => {
  const criteria = extractCriteria("family SUV under 50000 EUR with 450 km range");
  const cachedRecommendations = matchVehicles(seedVehicles, criteria).recommendations.slice(0, 1);
  await saveMatchSession({ id: "explain-cache", criteria, selectedVehicleIds: [], cachedRecommendations });
  const response = await runMatchRequest({
    message: "Why are you suggesting this car?",
    sessionId: "explain-cache",
    previousCriteria: criteria
  });
  assert.equal(response.type, "chat");
  assert.match(response.assistantMessage, new RegExp(cachedRecommendations[0]!.vehicle.model));
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- --test-name-pattern="why-recommendation|cached explanation"`  
Expected: FAIL because the trigger and handler do not exist.

- [ ] **Step 3: Add deterministic fallback and grounded LLM generator**

```ts
// lib/recommendation-explanations.ts
export type RecommendationExplanationInput = {
  question: string;
  criteria: UserCriteria;
  recommendations: MatchResult[];
};

export function fallbackRecommendationExplanation(input: RecommendationExplanationInput) {
  const first = input.recommendations[0];
  if (!first) {
    return input.criteria.language === "de"
      ? "Ich kann die vorherigen Empfehlungen in diesem Chat nicht mehr sehen. Soll ich erneut suchen?"
      : "I can no longer see the earlier recommendations in this chat. Would you like me to search again?";
  }
  const reasons = first.reasonLedger.positiveReasons
    .slice(0, 3)
    .map((reason) => `${reason.label}: ${reason.value}`)
    .join(", ");
  const tradeoff = first.reasonLedger.tradeoffs[0];
  return `${first.vehicle.make} ${first.vehicle.model} fits because of ${reasons}.${tradeoff ? ` The trade-off is ${tradeoff}.` : ""}`;
}
```

Use `createOpenAiChatCompletion` only when configured. Send the latest question, `criteriaSummary(criteria)`, `vehicle` facts, `reasonLedger`, and `ragEvidence`; parse a JSON object `{ "answer": string }`. Reject blank/invalid output and use `fallbackRecommendationExplanation`. The system prompt must state “do not search, do not add vehicles, and use only supplied facts.”

- [ ] **Step 4: Add handler before criteria normalization**

```ts
// lib/match-service.ts, directly after resolvedTurn is available
if (resolvedTurn.trigger === "explain_recommendations") {
  const criteria = previousCriteria ?? emptyCriteria(body.message, detectLanguage(body.message, "en"));
  const assistantMessage = await generateRecommendationExplanation({
    question: body.message,
    criteria,
    recommendations: storedSession?.cachedRecommendations ?? []
  });
  return {
    type: "chat",
    sessionId,
    assistantMessage,
    message: assistantMessage,
    criteria,
    missingCriteria: getMissingCriteria(criteria),
    recommendations: [],
    ragCitations: [],
    rejectedSummary: []
  };
}
```

Extend classifier prompt allowed values, pattern detection, `isConversationTrigger`, and trigger-to-turn-kind conversion. Pattern matching must precede `looksLikeEvQuestion` so a “why” question about shown cars is not classified as generic EV knowledge.

- [ ] **Step 5: Run tests, typecheck, and commit**

Run: `npm test -- --test-name-pattern="explanation|why-recommendation|cached explanation"`  
Expected: PASS.  
Run: `npm run typecheck`  
Expected: exit code 0.

```bash
git add lib/conversational-intent.ts lib/recommendation-explanations.ts lib/match-service.ts tests/conversational-intent.test.ts tests/matching.test.ts
git commit -m "feat: explain cached recommendations conversationally"
```

### Task 3: Create a filter-aware hybrid retrieval migration

**Files:**
- Create: `supabase/migrations/<generated>_add_hybrid_vehicle_search.sql`
- Modify: `supabase/schema.sql`
- Test: `tests/vehicle-repository.test.ts`

**Interfaces:**
- Produces `public.search_vehicles_hybrid(query_text text, query_embedding vector, filters jsonb, match_count integer, min_similarity double precision)`.
- Returns `id`, `payload`, `semantic_similarity`, `text_rank`, `rrf_score`.

- [ ] **Step 1: Write repository mapping tests**

```ts
test("hybrid search passes explicit hard filters to RPC", async () => {
  // mock fetch and call searchVehicles with a criteria that has a hard budget and exact model
  // assert JSON body filters equals:
  assert.deepEqual(rpcBody.filters, {
    budgetMaxEUR: 45000,
    modelPreferences: ["EV6"],
    market: "AT",
    available: true
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="hybrid search passes"`  
Expected: FAIL because no hybrid RPC client exists.

- [ ] **Step 3: Generate and implement the migration**

Run: `supabase migration new add_hybrid_vehicle_search`  
Expected: a new timestamped SQL file under `supabase/migrations/`.

Put this core SQL in the generated file, adapting the extension schema to the project’s current schema:

```sql
alter table public.vehicles
  add column if not exists search_document tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(brand, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(make, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(model, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(trim, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(title, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(notes, '')), 'C')
  ) stored;

create index if not exists vehicles_search_document_idx
  on public.vehicles using gin (search_document);

create index if not exists vehicles_active_at_price_range_idx
  on public.vehicles (price_eur, range_km)
  where market = 'AT' and available = true;
```

Implement `search_vehicles_hybrid` as `language sql stable` with CTEs named `eligible`, `text_candidates`, and `vector_candidates`. `eligible` must apply `market`, `available`, budget, monthly budget, exact model, avoided brands, required features, and all hard flags from the validated filter JSON. Rank text candidates with `ts_rank_cd(search_document, websearch_to_tsquery('simple', query_text))`; rank vectors by `embedding <=> query_embedding`; combine `row_number()` ranks as:

```sql
coalesce(1.0 / (50 + text_rank_position), 0) +
coalesce(1.0 / (50 + vector_rank_position), 0) as rrf_score
```

Return a structured-only eligible candidate when neither ranked list contains it, with `rrf_score = 0`; order by `rrf_score desc`, then `price_eur asc`; and limit by `match_count`.

- [ ] **Step 4: Inspect query plans on representative filters**

Run: `supabase db query --help` then use the supported local command, or MCP `execute_sql`, to run `EXPLAIN ANALYZE` for:
1. Budget + range + availability;
2. Exact model;
3. Text-only natural-language query;
4. Vector query with a selective hard filter.

Expected: filtered index scan or bitmap scan precedes semantic ranking; no full table scan attributable to an outer PostgREST filter.

- [ ] **Step 5: Update checked-in schema and commit**

Run: `supabase db pull hybrid_vehicle_search --local --yes`  
Expected: `supabase/schema.sql` contains the generated search document, index, and function.

```bash
git add supabase/migrations supabase/schema.sql tests/vehicle-repository.test.ts
git commit -m "feat: add filter-aware hybrid vehicle retrieval"
```

### Task 4: Use hybrid candidates without weakening deterministic eligibility

**Files:**
- Modify: `lib/repositories/vehicle-repository.ts:60-183,309-403`
- Modify: `lib/types.ts:85-146`
- Test: `tests/vehicle-repository.test.ts`
- Test: `tests/matching.test.ts`

**Interfaces:**
- Produces `searchVehicles(criteria, message, options)` results with optional `textRank` and `retrievalScore`.
- Consumes `buildHybridSearchFilters(criteria)` and `search_vehicles_hybrid`.

- [ ] **Step 1: Write failing client mapping and safety tests**

```ts
test("hybrid response keeps retrieval signals and deterministic filters", async () => {
  // mock RPC response with a valid vehicle plus semantic_similarity/text_rank/rrf_score
  const vehicles = await searchVehicles(criteria, "winter family EV");
  assert.equal(vehicles[0]!.embeddingSimilarity, 0.84);
  assert.equal(vehicles[0]!.retrievalScore, 0.031);
});

test("post-RPC validation rejects an over-budget returned vehicle", () => {
  assert.deepEqual(filterVehiclesForSearch([overBudgetVehicle], criteria), []);
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm test -- --test-name-pattern="hybrid response|post-RPC validation"`  
Expected: FAIL because `retrievalScore` and the hybrid RPC mapping are absent.

- [ ] **Step 3: Replace parallel structured/vector requests with one RPC request**

```ts
// lib/repositories/vehicle-repository.ts
type SupabaseVehicleRow = {
  id: string;
  payload: Vehicle;
  semantic_similarity?: number;
  text_rank?: number;
  rrf_score?: number;
};

export function buildHybridSearchFilters(criteria: UserCriteria) {
  return {
    market: "AT",
    available: true,
    budgetMinEUR: criteria.budgetMinEUR,
    budgetMaxEUR: criteria.budgetMaxEUR,
    monthlyBudgetEUR: criteria.monthlyBudgetEUR,
    modelPreferences: criteria.modelPreferences,
    avoidedBrands: criteria.avoidedBrands,
    mustHaveFeatures: criteria.mustHaveFeatures,
    hardRangeFloorKm: hasHardRangeConstraint(criteria) ? inferSearchRangeFloorKm(criteria) : null,
    hardBodyTypes: hasHardBodyTypeConstraint(criteria) ? criteria.bodyTypes : [],
    hardPassengers: hasHardPassengerConstraint(criteria) ? criteria.passengers : null
  };
}
```

Call `/rest/v1/rpc/search_vehicles_hybrid` once, passing the text query, embedding (or `null` when embeddings are disabled), `filters`, `match_count`, and the configured similarity threshold. Keep `filterVehiclesForSearch` as defense-in-depth. Map `semantic_similarity` to `embeddingSimilarity` and `rrf_score` to `retrievalScore`.

Add `textRank?: number` and `retrievalScore?: number` to `Vehicle`; keep final ordering in `matchVehicles` based on deterministic `score`, then `retrievalScore`, then existing semantic/RAG tie-breakers.

- [ ] **Step 4: Run repository, matching, and type checks**

Run: `npm test -- --test-name-pattern="hybrid|hard filter|model"`  
Expected: PASS.  
Run: `npm run typecheck`  
Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/vehicle-repository.ts lib/types.ts lib/scoring.ts tests/vehicle-repository.test.ts tests/matching.test.ts
git commit -m "feat: rank filtered hybrid vehicle candidates"
```

### Task 5: Add ranking and explanation-quality evaluations

**Files:**
- Modify: `lib/data/eval-scenarios.ts`
- Modify: `scripts/run-evals.ts`
- Create: `tests/recommendation-evals.test.ts`

**Interfaces:**
- `EvalScenario` gains `expectedEligibleIds`, `acceptableTopKIds`, and `requiredExplanationFacts`.
- `run-evals.ts` reports Recall@K, NDCG@K, constraint-violation count, and explanation factuality.

- [ ] **Step 1: Write failing metric tests**

```ts
import { calculateNdcgAtK, calculateRecallAtK, explanationIsGrounded } from "../scripts/run-evals.ts";

test("ranking metrics reward a relevant first result", () => {
  assert.equal(calculateRecallAtK(["a", "b"], ["a", "c"], 2), 0.5);
  assert.ok(calculateNdcgAtK(["a", "b"], ["a"], 2) > calculateNdcgAtK(["b", "a"], ["a"], 2));
});

test("grounding check rejects missing explanation facts", () => {
  assert.equal(explanationIsGrounded("This has 900 km range", vehicleWith400KmRange), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="ranking metrics|grounding check"`  
Expected: FAIL because metric and grounding helpers are absent.

- [ ] **Step 3: Add deterministic evaluation metadata and metrics**

```ts
export type EvalScenario = {
  id: string;
  prompt: string;
  kind: "happy" | "adversarial";
  expectedMinMatches: number;
  expectedEligibleIds?: string[];
  acceptableTopKIds?: string[];
  requiredExplanationFacts?: Array<keyof Vehicle>;
};
```

Implement Recall@K as intersection of expected eligible IDs and returned IDs divided by expected eligible ID count. Implement binary relevance NDCG@K with `1 / Math.log2(position + 2)` gain and normalization by the ideal ordering. For explanation factuality, generate the deterministic fallback and assert that each selected ledger value occurs in the answer; separately reject numeric facts not present in the vehicle’s permitted ledger values.

Make `npm run eval` fail when a scenario violates a hard constraint, has an expected eligible ID outside the candidate top K, misses all acceptable top-K IDs, or produces an ungrounded deterministic explanation.

- [ ] **Step 4: Run full verification**

Run: `npm run test && npm run eval && npm run typecheck`  
Expected: all commands exit 0 and evaluation output includes Recall@K, NDCG@K, constraint violations, and factuality.

- [ ] **Step 5: Commit**

```bash
git add lib/data/eval-scenarios.ts scripts/run-evals.ts tests/recommendation-evals.test.ts
git commit -m "test: evaluate recommendation ranking and grounding"
```

### Task 6: Validate production behavior and document operating thresholds

**Files:**
- Modify: `README.md`
- Test: full repository suite

**Interfaces:**
- Documents required environment settings and the metrics to inspect after rollout.

- [ ] **Step 1: Add rollout guidance**

Add a “Conversational explanations and hybrid search” README section containing:

```md
- `FLOWRYD_ENABLE_LLM_EXPLANATIONS=1` enables grounded LLM wording; deterministic explanations remain the fallback.
- Keep `FLOWRYD_VEHICLE_EMBEDDING_SEARCH=1` only after vehicle embeddings and the hybrid migration are deployed.
- Inspect explanation fallback rate, hard-constraint violations (must be zero), p95 match latency, Recall@K, NDCG@K, and catalog coverage after each ranking change.
- Run `npm run eval` before deploying ranking or prompt changes.
```

- [ ] **Step 2: Run schema advisors and all checks**

Run: `supabase db advisors`  
Expected: no new security or performance warning caused by the migration.  
Run: `npm run ci`  
Expected: typecheck, tests, evals, and production build exit 0.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: describe conversational search operations"
```

## Self-Review

- Spec coverage: Task 1 supplies persisted evidence; Task 2 implements the conversational handler and failure behavior; Tasks 3–4 implement filter-aware structured/text/vector retrieval and bounded ranking; Task 5 adds the required ranking and factuality measurements; Task 6 provides operational verification and monitoring guidance.
- Placeholder scan: no incomplete marker, deferred implementation, or unspecified test behavior is present. The migration filename is intentionally generated by the Supabase CLI, as required by project database practice.
- Type consistency: `RecommendationReasonLedger` is added to `MatchResult` in Task 1 before Task 2 consumes it; `retrievalScore` is added to `Vehicle` in Task 4 before scorer tie-breaking uses it; evaluation types are defined before metric functions consume them.
