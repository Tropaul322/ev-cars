# Semantic recall for hybrid vehicle search (A → B)

Date: 2026-07-23  
Status: Approved — implementation plan ready

## Goal

Raise hybrid vehicle recall so style, capacity, and bilingual cues (e.g. sporty, 2-seater, city car, DE synonyms) contribute through both full-text search and embeddings—without waiting on a full catalog re-embed for the first win.

Primary failure mode from live validation (2026-07-23):

- Vehicle ANN and knowledge RAG work.
- Hybrid `text_rank` was null on English style probes because `search_document` only indexes brand/make/model/trim/title/notes.
- Embedding query text is a long natural-language dump; `websearch_to_tsquery('simple', …)` rarely matches inventory tokens.
- Vehicle embedding documents under-encode seats/body/style synonyms, so vector neighbors skew toward abundant 5-seat family inventory.

## Scope

### In scope

**Phase A (ship first, no vehicle re-embed)**

- Widen `vehicles.search_document` with body type, seats phrases, drivetrain, location, and a small DE/EN style lexicon derived from existing fields.
- Split retrieval inputs: lexical `ftsQuery` vs natural-language `embeddingQuery`.
- Criteria → synonym expansion (EN+DE) for body, seats, qualitative/trip signals used by both query builders.
- Unit tests for expansion and document token coverage; integration/probe that style queries can produce non-null `text_rank`.

**Phase B (after A)**

- Richer `buildVehicleEmbeddingText` with structured bilingual capacity/style lines.
- Hash-based dirty detection via existing `embedding_input_hash`.
- Pilot re-embed (~500–1000 rows) → eval / live probes → full `npm run supabase:embed-vehicles` if metrics improve.

### Out of scope

- Hard seat upper-bounds or precision-only filter remapping (e.g. “2-seater” → `seats <= 2`) as the primary fix.
- LLM query rewrite / agentic retrieval.
- RRF weight redesign or IVFFlat parameter tuning beyond what A/B require.
- New catalog attributes not already on `Vehicle` / promoted columns.
- Knowledge-chunk RAG changes (already healthy in validation).

## Current state

| Piece | Behavior |
|---|---|
| `search_document` | Weighted tsvector over brand, make, model, trim, title, notes only |
| Hybrid RPC | ANN vector branch + GIN text branch + RRF; text uses `websearch_to_tsquery('simple', query_text)` |
| App query | Single `buildVehicleEmbeddingQuery(criteria, message)` fed to both embedding API and hybrid `query_text` |
| Vehicle embed text | Title, IDs, numeric facts, features, notes—weak style/capacity phrasing |
| Flag | `FLOWRYD_VEHICLE_EMBEDDING_SEARCH` still required for vector path; defaults off in README |

## Phase A design

### A1. Expand `search_document`

Migration replaces the generated column (or recreates it) so the document includes at least:

- Existing A/B weights: brand, make, model, trim, title
- Body type (and aliases where cheap to inline, e.g. `cabrio` ↔ convertible if represented)
- Seats as searchable phrases: `{n} seats`, plus fixed aliases for 1–2 seats (`zweisitzer`, `2-seater`, `two seater`)
- Drivetrain, location
- Notes / review-tag text already useful for style if present
- A compact DE/EN bag for common style cues derived from body_type + seats (not free LLM generation)

Keep `simple` config for predictability with mixed DE/EN tokens. Rebuild GIN index as needed.

### A2. Split FTS vs embedding query

In `searchVehicles` (vehicle-repository):

1. Build `embeddingQuery` from message + criteria + synonym expansion (natural language; good for OpenAI embeddings).
2. Build `ftsQuery` as a short token string: preferred brands/models, body types, seat phrases, expanded style synonyms, location—omit long prose and budget numbers that dilute `websearch_to_tsquery`.
3. Pass `ftsQuery` as hybrid `query_text`; pass the embedding vector from `embeddingQuery`.

Do not change hard-filter semantics in this phase.

### A3. Synonym expansion module

New small pure helper (e.g. `lib/vehicle-search-lexicon.ts`):

- Input: `UserCriteria` + raw message (optional).
- Output: token lists / joined strings for FTS and extra phrases for embedding query.
- Cover at minimum: performance/sporty, city/commute, family/highway, seat counts, body types, public charging—EN + DE.

Deterministic only; no network calls.

### A4. Tests & probes

- Unit: lexicon expands “sporty” / “2 seater” / DE equivalents; FTS query is shorter than embedding query and contains seat/body tokens.
- Unit or SQL fixture: generated document for a 2-seat coupe contains expected lexemes.
- Live/integration (when env available): style probe returns some rows with `text_rank` set; brand exact search still works.

## Phase B design

### B1. Richer embedding documents

Extend `buildVehicleEmbeddingText` with explicit bilingual lines, for example:

- Capacity: `"{n} seats"`, `zweisitzer` when `n <= 2`, family/passenger phrasing when `n >= 5`
- Body: body type plus DE/EN aliases
- Style: map review tags / notes lightly; avoid inventing attributes not on the vehicle

Hash changes automatically mark rows dirty for re-embed.

### B2. Pilot then full re-embed

1. Deploy Phase A (search_document + query split) independently.
2. Ship B1 code.
3. Run embed job with a limit/pilot subset; compare the same probes + `npm run eval` where applicable.
4. Full re-embed if recall/quality improves and latency remains acceptable.

## Success criteria

- Style probes (sporty 2-seater, city cheap, family SUV): after Phase A, at least ~30% of returned hybrid hits have `text_rank > 0` (baseline was ~0% on English style probes).
- Qualitative top-10 relevance improves vs 2026-07-23 baseline (fewer pure family crossovers dominating “sporty 2-seater” solely from vector mass).
- No regression on make/model exact FTS (e.g. query `Tesla Model 3` still returns Tesla Model 3 listings with strong text rank).
- p95 hybrid latency stays within existing anon/statement timeout envelope.
- Phase B: after full re-embed, embedding-neighbor probes for known style clusters improve vs pre-B baseline without breaking family/city probes.
- Pilot re-embed uses existing `scripts/embed_vehicles.ts --limit=N` before a full refresh.

## Rollout

1. Migration for `search_document` + deploy app query split / lexicon (Phase A).
2. Enable `FLOWRYD_VEHICLE_EMBEDDING_SEARCH=1` in environments where vectors are populated (ops, not blocked by this design).
3. Phase B template + pilot embed + eval gate + full embed.
4. Keep `FLOWRYD_MATCH_DEBUG=1` available for diagnosing `text_rank` / `semantic_similarity` / RRF.

## Risks

| Risk | Mitigation |
|---|---|
| Wider tsvector increases index size / write cost | Limit lexicon; weight carefully; monitor index size |
| Synonym over-expansion pollutes FTS | Keep ftsQuery short; prefer OR-friendly websearch tokens; test brand queries |
| Pilot embed inconclusive | Fix probe set before full re-embed; don’t full-refresh on vibes alone |
| Inventory lacks true sporty body types | Lexicon helps recall among what exists; precision filters remain a later project |

## Implementation order

1. Lexicon module + unit tests  
2. Query split in vehicle-repository + tests  
3. `search_document` migration + schema sync  
4. Probe / integration check for `text_rank`  
5. Embedding text rewrite + unit tests  
6. Pilot embed → eval → full embed  
