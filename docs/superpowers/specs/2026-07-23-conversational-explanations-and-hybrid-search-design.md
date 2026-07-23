# Conversational explanations and hybrid vehicle search design

Date: 2026-07-23  
Status: Approved design — awaiting written-spec review

## Goal

Make FlowRyd behave like a grounded conversational EV adviser when a user follows up on recommendations. A question such as “Why are you suggesting these cars?” must receive a friendly, detailed explanation of the already-returned cars rather than starting another matching run.

Strengthen vehicle retrieval and ranking using the current catalog schema so exact constraints remain reliable, natural-language preferences improve relevance, and every result has auditable reasons.

## Scope

### In scope

- A dedicated conversational intent for explanation follow-ups.
- Friendly LLM explanations grounded in cached recommendation evidence, with a deterministic fallback.
- A persisted per-result reason ledger to make explanations factual and debuggable.
- Filter-aware hybrid retrieval for structured, exact-text, and embedding candidates.
- Deterministic, explainable ranking and optional bounded LLM reranking.
- Retrieval, ranking, explanation, and failure-mode evaluations.

### Out of scope

- A general-purpose agent that can take arbitrary external actions.
- Collaborative filtering or personalization from other users’ behavior.
- Replacing the existing JSON `payload` as the canonical vehicle record.
- Adding new vehicle attributes such as charge-power or 0–100 acceleration when the catalog does not provide reliable values.
- Showing raw numeric score components by default.

## Current-state findings

### Conversation flow

The app preserves recent LLM conversation history and persists `match_sessions.cached_recommendations`. It supports matching, alternatives, next batch, criteria changes, EV questions, small talk, and metadata questions.

It does not have an `explain_recommendations` trigger. A “why these cars?” question can therefore fall into criteria normalization and invoke the matching pipeline again.

### Vehicle data

The canonical `Vehicle` payload has the fields needed for grounded matching and explanations:

- Identity and listing: make, brand, model, trim, year, source, listing URL, availability, location, freshness.
- Price: purchase price, monthly lease, lease details.
- Technical fit: range, efficiency, battery size/SoH, mileage, warranty, body type, seats, cargo, drivetrain, power, features.
- Provenance and preference signals: seller type, manufacturer country/origin, notes, review tags, embeddings.

`public.vehicles` promotes frequently queried fields to stored columns and indexes many of them. The JSON payload remains the canonical full record.

### Search and ranking

Current behavior correctly distinguishes hard constraints from soft preferences and uses a deterministic score breakdown:

- `priceFit`
- `rangeFit`
- `efficiencyFit`
- `brandFit`
- `cargoPassengerFit`
- `reliabilityFit`
- `featureFit`

It has deterministic trade-off reasons and stores cached `MatchResult` values. Structured retrieval applies hard constraints. The embedding RPC currently applies only `market` and `available`, then client code filters the returned top-N set. This can omit eligible vehicles when constraints are selective.

The present eval script checks that scenarios produce a minimum number of matches, but it does not validate candidate recall, ordering quality, or explanation factuality.

## Architecture

### Conversation intent and handler

Add `explain_recommendations` to the conversation trigger union and LLM router schema.

Examples:

- “Why are you suggesting these cars?”
- “Why this one?”
- “Why did this rank above the other?”
- German equivalents such as “Warum schlägst du mir diese Autos vor?”

When the trigger is selected:

1. Load the current chat’s stored `match_session`.
2. Read the displayed and cached recommendations, criteria, reason ledgers, and admissible RAG evidence.
3. Do not call criteria normalization, inventory retrieval, embedding search, scoring, or reranking.
4. Generate an explanation from the constrained evidence payload.
5. Save the assistant reply to chat history.

The handler has no search tool or search-like service path. Its response cannot silently mutate criteria or start a new match.

### Explanation evidence contract

Persist a compact `reasonLedger` for every cached recommendation. It is deterministic and contains:

- The user criteria that the vehicle satisfies.
- Positive factual reasons, each with a field key and display-ready value.
- Trade-offs or unknowns from `ruledOutReasons`.
- Passed hard-filter categories.
- Score-factor contributions and score source.
- RAG evidence IDs only where the fact or claim requires external knowledge.

The explanation prompt receives only:

- The latest user question and output language.
- A concise criteria summary.
- The cached vehicle facts.
- The reason ledger.
- The allowed RAG excerpts and citations, when present.

Prompt rules require a warm, direct answer; a concise explanation for each shown vehicle; concrete facts; and an honest trade-off. It must not invent vehicles, facts, comparison claims, or source material.

Responses do not show numeric scores by default. If a later deep-breakdown intent is added, it may display factor scores from the stored ledger.

### Missing cache and provider failure

If the session has no cached results, return a localized response that FlowRyd cannot see the prior recommendations and offer a deliberate new search. It must not perform one automatically.

If the LLM is unavailable, invalid, or times out, compose a localized deterministic reply from the same reason ledger. This keeps the explanation turn useful without provider availability.

## Retrieval and ranking

### Criteria policy

Keep `UserCriteria` and the existing hard-versus-soft policy:

- Hard: market, availability, explicit budget or monthly budget, exact model, avoided brands, must-have features, explicit mileage cap, required battery SoH, and attributes stated with exclusive language such as “must” or “only.”
- Soft: ordinary body, brand, origin, and condition preferences; family/cargo needs; qualitative needs; trip type; and optimization directive.

Hard criteria determine eligibility. Soft criteria influence order and can never cause a no-results answer by themselves.

### Filter-aware hybrid candidate retrieval

Replace separate post-filtered paths with one typed PostgreSQL RPC that accepts:

- A query embedding and text query.
- Typed hard-filter parameters (or a validated typed filter object).
- Candidate limit and similarity threshold.

Inside the RPC:

1. Apply market, availability, and all active hard filters before semantic ranking.
2. Produce an exact-text candidate list from weighted `tsvector` search over make, brand, model, trim, title, and notes.
3. Produce a vector candidate list using the same filter predicate.
4. Include the structured eligibility set where it is needed to preserve candidates without keyword/vector signals.
5. Fuse independent ranked lists with Reciprocal Rank Fusion (RRF).
6. Return a bounded, deduplicated candidate set with its retrieval signals.

This approach preserves exact make/model lookup, keeps constraints authoritative, and lets semantic retrieval capture natural-language needs such as “a good winter family EV.”

### Database indexes

Add only derived search fields and indexes:

- A stored/generated or maintained weighted `tsvector` search column and GIN index for catalog text.
- A composite partial index optimized for active Austrian inventory and common range/price access patterns, selected from query-plan evidence.
- HNSW vector indexing only after measuring catalog size, recall, RAM availability, and update frequency; retain IVFFlat initially if the catalog remains small and write-friendly.

Use `EXPLAIN ANALYZE` and realistic filter combinations before adding composite indexes. Do not add indexes merely because a column exists.

### Ranking

Run the deterministic scorer after candidate retrieval. Retain the current seven factor scores and directive-based weights. Generate the reason ledger from the same score and trade-off functions so what the assistant says is traceable to what ranked the vehicle.

An optional LLM reranker may reorder only the deterministic, hard-filter-passing candidate set. It cannot introduce an unseen vehicle, override eligibility, or replace score reasons. Its output must be validated against the candidate IDs and stored separately as `llmScore` / `llmFitSummary`.

## Observability and evaluation

### Privacy-aware diagnostics

For every turn, record:

- Resolved intent and router source.
- Whether a match search ran.
- Whether cached recommendations were used.
- Candidate counts at structured, text, vector, fused, and final stages.
- Returned and ranked vehicle IDs.
- Explanation evidence IDs and fallback status.
- Stage latency and error category.

Do not put full free-text user messages, email addresses, names, or registration location into diagnostics.

### Tests

Add unit and integration coverage for:

- “Why these cars?” and German equivalents route to `explain_recommendations`.
- Explanation turns never invoke normalization, retrieval, scoring, or reranking.
- No-cache explanation behavior offers, but does not execute, a new search.
- Every cited vehicle fact appears in the cached vehicle/evidence contract.
- Deterministic explanation fallback is localized and includes a reason plus trade-off.
- Active hard filters are honored by structured, text, and vector retrieval.
- Exact model matches, semantic need matches, and RRF fusion preserve expected candidate IDs.
- LLM reranking cannot add or make ineligible vehicles visible.

### Evaluation

Extend the labeled scenario data with:

- Required hard-filter behavior.
- Expected eligible vehicle IDs.
- Expected primary vehicle or acceptable top-K IDs.
- Expected explanation facts and prohibited claims.

Measure:

- Candidate Recall@K.
- NDCG@K for rank order.
- Exact-model retrieval rate.
- Constraint-violation rate.
- Explanation factuality rate.
- Explanation fallback rate and latency.
- Catalog coverage/diversity as a guardrail against repetitive outputs.

Use offline evaluations to prevent regressions, then compare ranking variants using a controlled online test when there is sufficient traffic.

## Delivery sequence

1. Add explanation intent, evidence contract, handler, fallback, and tests.
2. Upgrade eval scenarios to validate rank quality and grounded answers.
3. Build filter-aware hybrid RPC and full-text retrieval, with query-plan checks.
4. Compare structured-only, hybrid, and hybrid-plus-optional-rerank variants using the evaluation suite.
5. Release with privacy-safe diagnostics and monitor fallback, constraint violations, latency, and user engagement.
