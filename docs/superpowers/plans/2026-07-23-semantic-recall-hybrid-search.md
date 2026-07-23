# Semantic Recall Hybrid Search (A → B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise hybrid vehicle recall so style, capacity, and bilingual cues contribute via FTS and embeddings—Phase A (query + `search_document`) first, then Phase B (richer embed text + pilot/full re-embed).

**Architecture:** Add a deterministic EN/DE lexicon that expands criteria into short FTS tokens and richer embedding-query phrases. Feed `ftsQuery` to hybrid `query_text` and embed `embeddingQuery` separately. Widen Postgres `search_document` so seats/body/style tokens are indexed. Then upgrade `buildVehicleEmbeddingText` and re-embed via existing hash dirtying.

**Tech Stack:** TypeScript, Node test runner (`node --experimental-strip-types --test`), Supabase Postgres + pgvector, OpenAI embeddings (`text-embedding-3-small`, 1536 dims).

**Spec:** [docs/superpowers/specs/2026-07-23-semantic-recall-hybrid-search-design.md](../specs/2026-07-23-semantic-recall-hybrid-search-design.md)

## Global Constraints

- Do **not** `git commit` (or push) unless the user explicitly asks in that turn
- Phase A must ship and be probeable **without** re-embedding vehicles
- Do **not** change hard-filter semantics (no `seats <= 2` as the primary fix)
- No LLM query rewrite; lexicon is deterministic only
- Preserve existing hybrid RPC shape (`query_text`, `query_embedding`, `filters`, …)
- EN + DE synonym coverage for sporty / seats / city / family / body cues
- Keep p95 hybrid latency inside existing anon/statement timeout envelope

---

## File map

| File | Responsibility |
| --- | --- |
| `lib/vehicle-search-lexicon.ts` | Deterministic EN/DE token expansion from criteria + message |
| `lib/repositories/vehicle-repository.ts` | Split `ftsQuery` vs `embeddingQuery`; export builders for tests |
| `lib/vehicle-embedding-text.ts` | Richer bilingual capacity/style document text (Phase B) |
| `supabase/migrations/20260723200000_expand_vehicle_search_document.sql` | Widen generated `search_document` + GIN index |
| `supabase/schema.sql` | Keep in sync with migration |
| `scripts/verify-embeddings.ts` | Optional: add a vehicle hybrid style probe helper section, or leave knowledge-only and use Task 4 script |
| `scripts/probe_hybrid_semantic_recall.ts` | Live probe for `text_rank` / style recall (Phase A gate) |
| `tests/vehicle-search-lexicon.test.ts` | Lexicon unit tests |
| `tests/vehicle-repository.test.ts` | FTS vs embedding query split + RPC payload assertions |
| `tests/vehicle-embeddings.test.ts` | Embedding document bilingual phrases |

---

### Task 1: Vehicle search lexicon

**Files:**
- Create: `lib/vehicle-search-lexicon.ts`
- Create: `tests/vehicle-search-lexicon.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type VehicleSearchLexicon = {
    ftsTokens: string[];
    embeddingPhrases: string[];
  };

  export function expandVehicleSearchLexicon(
    criteria: UserCriteria,
    message?: string
  ): VehicleSearchLexicon;

  export function seatsLexiconTokens(seats: number): string[];
  export function bodyTypeLexiconTokens(bodyType: string): string[];
  ```
- Consumes: `UserCriteria` from `lib/types.ts` / `emptyCriteria` patterns

- [ ] **Step 1: Write the failing tests**

Create `tests/vehicle-search-lexicon.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { emptyCriteria } from "../lib/criteria.ts";
import {
  bodyTypeLexiconTokens,
  expandVehicleSearchLexicon,
  seatsLexiconTokens
} from "../lib/vehicle-search-lexicon.ts";

test("seatsLexiconTokens includes bilingual 2-seater aliases", () => {
  const tokens = seatsLexiconTokens(2);
  assert.ok(tokens.includes("2 seats"));
  assert.ok(tokens.includes("2-seater"));
  assert.ok(tokens.includes("zweisitzer"));
});

test("bodyTypeLexiconTokens expands suv and coupe-like other", () => {
  assert.ok(bodyTypeLexiconTokens("suv").includes("suv"));
  assert.ok(bodyTypeLexiconTokens("suv").some((t) => /geländewagen|gelaendewagen/i.test(t)));
});

test("expandVehicleSearchLexicon expands sporty + 2-seater message", () => {
  const criteria = {
    ...emptyCriteria("any sporty 2 seater car"),
    optimizationDirective: "performance" as const,
    passengers: 2,
    qualitativeSignals: [],
    tripNeeds: [],
    bodyTypes: []
  };
  const { ftsTokens, embeddingPhrases } = expandVehicleSearchLexicon(
    criteria,
    "any sporty 2 seater car"
  );
  const fts = ftsTokens.join(" ").toLowerCase();
  const emb = embeddingPhrases.join(" ").toLowerCase();
  assert.ok(/sporty|sportlich|performance/.test(fts));
  assert.ok(/2-seater|zweisitzer|2 seats/.test(fts));
  assert.ok(/sporty|sportlich/.test(emb));
  assert.ok(ftsTokens.length < 40, "FTS token list should stay short");
});

test("expandVehicleSearchLexicon expands city commute DE/EN", () => {
  const criteria = {
    ...emptyCriteria("Stadtpendeln"),
    tripNeeds: ["city", "commute"] as const,
    chargingAccess: "public" as const
  };
  const { ftsTokens } = expandVehicleSearchLexicon(criteria, "small city car Vienna");
  const fts = ftsTokens.join(" ").toLowerCase();
  assert.ok(/city|stadt|commute|pendel/.test(fts));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --experimental-strip-types --test tests/vehicle-search-lexicon.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement lexicon**

Create `lib/vehicle-search-lexicon.ts`:

```ts
import type { BodyType, TripNeed, UserCriteria } from "./types.ts";

export type VehicleSearchLexicon = {
  ftsTokens: string[];
  embeddingPhrases: string[];
};

const PERFORMANCE_TOKENS = [
  "sporty",
  "sportlich",
  "performance",
  "fahrspass",
  "fahrspaß",
  "roadster",
  "coupe",
  "cabrio",
  "convertible"
];

const CITY_TOKENS = ["city", "stadt", "commute", "pendeln", "urban", "compact", "kleinwagen"];
const FAMILY_TOKENS = ["family", "familie", "highway", "autobahn", "road trip", "langstrecke"];
const PUBLIC_CHARGING_TOKENS = [
  "public charging",
  "oeffentlich laden",
  "öffentlich laden",
  "wallbox"
];

export function seatsLexiconTokens(seats: number): string[] {
  const n = Math.max(0, Math.floor(seats));
  const tokens = [`${n} seats`, `${n} sitze`];
  if (n > 0 && n <= 2) {
    tokens.push("2-seater", "two seater", "zweisitzer", "2 sitzer");
  }
  if (n >= 5) {
    tokens.push("family seats", "familienauto");
  }
  return tokens;
}

export function bodyTypeLexiconTokens(bodyType: string): string[] {
  const key = bodyType.trim().toLowerCase();
  const map: Record<string, string[]> = {
    suv: ["suv", "geländewagen", "gelaendewagen"],
    crossover: ["crossover", "suv"],
    sedan: ["sedan", "limousine"],
    hatchback: ["hatchback", "schrägheck", "schraegheck"],
    compact: ["compact", "kleinwagen"],
    wagon: ["wagon", "kombi"],
    van: ["van", "kleinbus"],
    minibus: ["minibus"],
    other: ["other"]
  };
  return map[key] ?? (key ? [key] : []);
}

function uniqueTokens(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const token = value?.trim();
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

function messageSeatHints(message: string): string[] {
  if (/\b(2[-\s]?seater|two[-\s]?seater|zweisitzer|2[-\s]?sitzer)\b/i.test(message)) {
    return seatsLexiconTokens(2);
  }
  if (/\b(4[-\s]?seater|vier[-\s]?sitzer)\b/i.test(message)) {
    return seatsLexiconTokens(4);
  }
  return [];
}

export function expandVehicleSearchLexicon(
  criteria: UserCriteria,
  message = ""
): VehicleSearchLexicon {
  const text = `${message} ${criteria.latestUserMessage ?? ""} ${criteria.rawPrompt ?? ""}`;
  const fts: string[] = [];
  const phrases: string[] = [];

  for (const brand of criteria.brandPreferences) fts.push(brand);
  for (const model of criteria.modelPreferences) fts.push(model);
  for (const body of criteria.bodyTypes) {
    const tokens = bodyTypeLexiconTokens(body);
    fts.push(...tokens);
    phrases.push(...tokens);
  }

  if (criteria.passengers != null) {
    const seatTokens = seatsLexiconTokens(criteria.passengers);
    fts.push(...seatTokens);
    phrases.push(...seatTokens);
  }
  fts.push(...messageSeatHints(text));

  if (criteria.optimizationDirective === "performance" || /\b(sporty|sportlich|performance)\b/i.test(text)) {
    fts.push(...PERFORMANCE_TOKENS);
    phrases.push("sporty performance coupe cabrio roadster sportlich fahrspaß");
  }

  for (const trip of criteria.tripNeeds as TripNeed[]) {
    if (trip === "city" || trip === "commute") {
      fts.push(...CITY_TOKENS);
      phrases.push("city commute stadt pendeln kleinwagen");
    }
    if (trip === "family" || trip === "road_trip") {
      fts.push(...FAMILY_TOKENS);
      phrases.push("family highway autobahn langstrecke");
    }
    if (trip === "winter") {
      fts.push("winter", "awd", "allrad");
      phrases.push("winter awd allrad");
    }
  }

  if (criteria.chargingAccess === "public" || criteria.qualitativeSignals.includes("public_charging_fit")) {
    fts.push(...PUBLIC_CHARGING_TOKENS);
    phrases.push("public charging ohne wallbox apartment");
  }

  if (criteria.location) fts.push(criteria.location);

  return {
    ftsTokens: uniqueTokens(fts).slice(0, 36),
    embeddingPhrases: uniqueTokens(phrases)
  };
}
```

(Adjust imports if `BodyType` unused—keep YAGNI.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test tests/vehicle-search-lexicon.test.ts`

Expected: PASS (all 4)

---

### Task 2: Split FTS vs embedding query in vehicle search

**Files:**
- Modify: `lib/repositories/vehicle-repository.ts` (`buildVehicleEmbeddingQuery`, `searchVehicles`)
- Modify: `tests/vehicle-repository.test.ts`

**Interfaces:**
- Consumes: `expandVehicleSearchLexicon` from Task 1
- Produces (export for tests):
  ```ts
  export function buildVehicleEmbeddingQuery(criteria: UserCriteria, message: string): string;
  export function buildVehicleFtsQuery(criteria: UserCriteria, message: string): string;
  ```
- `searchVehicles` must POST `query_text: ftsQuery` and embed `embeddingQuery`

- [ ] **Step 1: Write the failing tests**

Add to `tests/vehicle-repository.test.ts`:

```ts
import {
  buildHybridSearchFilters,
  buildVehicleEmbeddingQuery,
  buildVehicleFtsQuery,
  buildVehicleSearchParams,
  filterVehiclesForSearch,
  searchVehicles
} from "../lib/repositories/vehicle-repository.ts";

test("FTS query is lexical and shorter than embedding query for style asks", () => {
  const criteria = {
    ...emptyCriteria("any sporty 2 seater car"),
    optimizationDirective: "performance" as const,
    passengers: 2,
    budgetMaxEUR: 80000
  };
  const message = "any sporty 2 seater car";
  const fts = buildVehicleFtsQuery(criteria, message);
  const emb = buildVehicleEmbeddingQuery(criteria, message);
  assert.ok(fts.length > 0);
  assert.ok(emb.length > fts.length);
  assert.ok(/sporty|sportlich|2-seater|zweisitzer/i.test(fts));
  assert.ok(!/80000/.test(fts), "budget numbers should not dilute FTS");
  assert.ok(/80000|budget/i.test(emb));
});

test("hybrid RPC receives ftsQuery as query_text", async () => {
  const criteria = {
    ...emptyCriteria("sporty 2 seater"),
    optimizationDirective: "performance" as const,
    passengers: 2
  };
  let posted: Record<string, unknown> | null = null;
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  process.env.FLOWRYD_VEHICLE_STRUCTURED_SEARCH = "1";
  process.env.FLOWRYD_DISABLE_EMBEDDINGS = "1";

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/rest/v1/rpc/search_vehicles_hybrid") && init?.method === "POST") {
      posted = JSON.parse(String(init.body));
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return originalFetch(input, init);
  };

  try {
    await searchVehicles(criteria, "sporty 2 seater");
    assert.ok(posted);
    const expectedFts = buildVehicleFtsQuery(criteria, "sporty 2 seater");
    assert.equal(posted.query_text, expectedFts);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = originalKey;
    delete process.env.FLOWRYD_VEHICLE_STRUCTURED_SEARCH;
    delete process.env.FLOWRYD_DISABLE_EMBEDDINGS;
  }
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --experimental-strip-types --test --test-name-pattern='FTS query is lexical|hybrid RPC receives ftsQuery' tests/vehicle-repository.test.ts`

Expected: FAIL (`buildVehicleFtsQuery` not exported / query_text still embedding dump)

- [ ] **Step 3: Implement query split**

In `lib/repositories/vehicle-repository.ts`:

1. Import `expandVehicleSearchLexicon`.
2. Export and update builders:

```ts
export function buildVehicleFtsQuery(criteria: UserCriteria, message: string) {
  const lexicon = expandVehicleSearchLexicon(criteria, message);
  return lexicon.ftsTokens.join(" ").trim();
}

export function buildVehicleEmbeddingQuery(criteria: UserCriteria, message: string) {
  const lexicon = expandVehicleSearchLexicon(criteria, message);
  return [
    message,
    criteria.rawPrompt,
    ...lexicon.embeddingPhrases,
    criteria.bodyTypes.join(" "),
    criteria.tripNeeds.join(" "),
    criteria.mustHaveFeatures.join(" "),
    criteria.qualitativeSignals.join(" "),
    criteria.brandPreferences.join(" "),
    criteria.modelPreferences.join(" "),
    criteria.chargingAccess,
    resolveInventoryLocationFilter(criteria.location),
    criteria.cargoNeeds,
    criteria.preferredCondition,
    criteria.rangeFloorKm ? `${criteria.rangeFloorKm} km range reichweite` : null,
    criteria.mileageMaxKm ? `${criteria.mileageMaxKm} km mileage kilometerstand` : null,
    criteria.batterySoHMin ? `battery health soh batteriegesundheit ${criteria.batterySoHMin}` : null,
    criteria.budgetMaxEUR ? `${criteria.budgetMaxEUR} eur budget` : null,
    criteria.monthlyBudgetEUR ? `${criteria.monthlyBudgetEUR} eur monthly leasing` : null
  ]
    .filter(Boolean)
    .join(" ");
}
```

3. In `searchVehicles`, replace single `queryText` usage:

```ts
const embeddingQuery = buildVehicleEmbeddingQuery(criteria, message);
const ftsQuery = buildVehicleFtsQuery(criteria, message);
// ... createEmbeddingWithProvider(embeddingQuery, "query") ...
body: JSON.stringify({
  query_text: ftsQuery,
  query_embedding: queryEmbedding,
  filters: buildHybridSearchFilters(criteria),
  match_count: vehicleEmbeddingSearchLimit(),
  min_similarity: vehicleEmbeddingMinSimilarity()
})
```

Update debug logs to include `ftsQueryPreview` / `embeddingQueryPreview` (first 160 chars) when `FLOWRYD_MATCH_DEBUG=1`.

- [ ] **Step 4: Run vehicle-repository tests**

Run: `node --experimental-strip-types --test tests/vehicle-repository.test.ts`

Expected: PASS

---

### Task 3: Expand `search_document` migration

**Files:**
- Create: `supabase/migrations/20260723200000_expand_vehicle_search_document.sql`
- Modify: `supabase/schema.sql` (same generated-column expression)

**Interfaces:**
- Produces: generated `search_document` that includes `body_type`, seats phrases, drivetrain, location, `review_tags`, plus fixed aliases for 1–2 seats and common body DE/EN tokens via SQL `case` expressions
- Does not change `search_vehicles_hybrid` signature

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260723200000_expand_vehicle_search_document.sql`:

```sql
-- Widen vehicles.search_document so hybrid FTS can match style/capacity tokens.
-- Drop + recreate generated column (Postgres cannot ALTER generated expression in place).

drop index if exists public.vehicles_search_document_idx;

alter table public.vehicles
  drop column if exists search_document;

alter table public.vehicles
  add column search_document tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(brand, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(make, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(model, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(trim, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(title, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(body_type, '')), 'B') ||
    setweight(
      to_tsvector(
        'simple',
        trim(
          both ' ' from concat_ws(
            ' ',
            case when seats is not null then seats::text || ' seats' else '' end,
            case when seats is not null then seats::text || ' sitze' else '' end,
            case when seats is not null and seats <= 2 then '2-seater two seater zweisitzer 2 sitzer' else '' end,
            case when seats is not null and seats >= 5 then 'family seats familienauto' else '' end,
            case
              when body_type = 'suv' then 'suv geländewagen gelaendewagen'
              when body_type = 'sedan' then 'sedan limousine'
              when body_type = 'hatchback' then 'hatchback schrägheck schraegheck'
              when body_type = 'compact' then 'compact kleinwagen'
              when body_type = 'wagon' then 'wagon kombi'
              when body_type = 'crossover' then 'crossover suv'
              when body_type = 'van' then 'van kleinbus'
              when body_type = 'minibus' then 'minibus'
              else coalesce(body_type, '')
            end
          )
        )
      ),
      'B'
    ) ||
    setweight(to_tsvector('simple', coalesce(drivetrain, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(location, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(review_tags, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(notes, '')), 'C')
  ) stored;

create index if not exists vehicles_search_document_idx
  on public.vehicles using gin (search_document);
```

- [ ] **Step 2: Sync `supabase/schema.sql`**

Replace the existing `search_document` generated expression (lines ~52–59) with the same expression as the migration so local schema dumps match.

- [ ] **Step 3: Apply migration to remote**

Prefer Supabase MCP `apply_migration` on project `xkbrqsycdzvtugzgcadg` (ev-app) with the migration SQL, **or** `supabase db push` if that is the team workflow.

Then verify with SQL:

```sql
select id, seats, body_type,
  search_document @@ websearch_to_tsquery('simple', 'zweisitzer') as hits_zweisitzer
from public.vehicles
where available and market = 'AT' and seats <= 2
limit 5;
```

Expected: at least one `hits_zweisitzer = true` among 2-seat rows.

---

### Task 4: Live Phase A probe script

**Files:**
- Create: `scripts/probe_hybrid_semantic_recall.ts`
- Optional package script in `package.json`: `"probe:hybrid-recall": "node --experimental-strip-types scripts/probe_hybrid_semantic_recall.ts"`

**Interfaces:**
- Consumes: `emptyCriteria`, `searchVehicles`, env from `.env.local`
- Forces `FLOWRYD_VEHICLE_EMBEDDING_SEARCH=1` for the process
- Prints per-query: returned count, share with `text_rank > 0`, top 5 titles + semantic + text_rank

- [ ] **Step 1: Implement probe script**

```ts
import fs from "node:fs";
import path from "node:path";
import { emptyCriteria } from "../lib/criteria.ts";
import { searchVehicles } from "../lib/repositories/vehicle-repository.ts";

for (const [key, value] of Object.entries(loadEnv(path.join(process.cwd(), ".env.local")))) {
  if (typeof value === "string") process.env[key] = value;
}
process.env.FLOWRYD_VEHICLE_EMBEDDING_SEARCH = "1";

const probes = [
  {
    label: "sporty-2-seater",
    message: "sporty 2 seater convertible electric car",
    patch: { optimizationDirective: "performance" as const, passengers: 2, budgetMaxEUR: 80000 }
  },
  {
    label: "city-cheap",
    message: "small cheap city car for Vienna commuting",
    patch: { tripNeeds: ["city", "commute"] as const, budgetMaxEUR: 25000, chargingAccess: "public" as const }
  },
  {
    label: "family-suv",
    message: "family SUV with long range for highway trips Austria",
    patch: { tripNeeds: ["family", "road_trip"] as const, bodyTypes: ["suv"] as const, budgetMaxEUR: 60000 }
  },
  {
    label: "brand-exact",
    message: "Tesla Model 3",
    patch: { brandPreferences: ["Tesla"], modelPreferences: ["Model 3"] }
  }
];

for (const probe of probes) {
  const criteria = { ...emptyCriteria(probe.message), ...probe.patch };
  const started = Date.now();
  const vehicles = await searchVehicles(criteria, probe.message);
  const withText = vehicles.filter((v) => (v.textRank ?? 0) > 0);
  const share = vehicles.length ? withText.length / vehicles.length : 0;
  console.log(
    JSON.stringify(
      {
        label: probe.label,
        ms: Date.now() - started,
        returned: vehicles.length,
        textRankShare: Number(share.toFixed(3)),
        top: vehicles.slice(0, 5).map((v) => ({
          title: `${v.make} ${v.model}`,
          seats: v.seats,
          semantic: v.embeddingSimilarity ?? null,
          textRank: v.textRank ?? null
        }))
      },
      null,
      2
    )
  );
}

function loadEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return process.env;
  const values = { ...process.env } as Record<string, string | undefined>;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf("=");
    if (sep === -1) continue;
    values[trimmed.slice(0, sep)] = trimmed.slice(sep + 1);
  }
  return values;
}
```

- [ ] **Step 2: Run probe after Task 3 migration**

Run: `node --experimental-strip-types scripts/probe_hybrid_semantic_recall.ts`

Expected (Phase A gate):
- `sporty-2-seater` / `city-cheap` / `family-suv`: `textRankShare` ≳ **0.30**
- `brand-exact`: Tesla Model 3 still in top results with strong `textRank`

If share stays near 0, debug `ftsQuery` contents and a sample `search_document @@ websearch_to_tsquery(...)` before proceeding to Phase B.

---

### Task 5: Richer vehicle embedding documents (Phase B code)

**Files:**
- Modify: `lib/vehicle-embedding-text.ts`
- Modify: `tests/vehicle-embeddings.test.ts`
- Optionally reuse `bodyTypeLexiconTokens` / `seatsLexiconTokens` from Task 1 (prefer import to stay DRY)

**Interfaces:**
- Produces: `buildVehicleEmbeddingText(vehicle)` includes bilingual capacity/style phrases
- Hash dirtying: existing `embedding_input_hash` changes automatically when text changes

- [ ] **Step 1: Write failing tests**

Extend `tests/vehicle-embeddings.test.ts`:

```ts
import { buildVehicleEmbeddingText } from "../lib/vehicle-embedding-text.ts";

test("buildVehicleEmbeddingText includes bilingual 2-seat and body aliases", () => {
  const vehicle = buildDefaultVehicle({
    make: "Mazda",
    model: "MX-30",
    seats: 2,
    bodyType: "other",
    notes: "Fun city EV"
  });
  // buildDefaultVehicle may not accept seats/bodyType — set on returned object if needed:
  const text = buildVehicleEmbeddingText({ ...vehicle, seats: 2, bodyType: "other" });
  assert.match(text, /2 seats/);
  assert.match(text, /zweisitzer/i);
});

test("buildVehicleEmbeddingText marks family capacity for 5+ seats", () => {
  const vehicle = buildDefaultVehicle({ make: "Skoda", model: "Enyaq" });
  const text = buildVehicleEmbeddingText({ ...vehicle, seats: 5, bodyType: "suv" });
  assert.match(text, /5 seats/);
  assert.match(text, /familienauto|family/i);
  assert.match(text, /suv/i);
  assert.match(text, /geländewagen|gelaendewagen/i);
});
```

(If `buildDefaultVehicle` typing rejects fields, cast or assign after clone.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --experimental-strip-types --test --test-name-pattern='bilingual 2-seat|family capacity' tests/vehicle-embeddings.test.ts`

Expected: FAIL (missing zweisitzer / familienauto)

- [ ] **Step 3: Implement richer embedding text**

Update `buildVehicleEmbeddingText` in `lib/vehicle-embedding-text.ts`:

```ts
import { bodyTypeLexiconTokens, seatsLexiconTokens } from "./vehicle-search-lexicon.ts";

export function buildVehicleEmbeddingText(vehicle: Vehicle) {
  const seatPhrases = seatsLexiconTokens(vehicle.seats).join(" ");
  const bodyPhrases = bodyTypeLexiconTokens(vehicle.bodyType).join(" ");
  return [
    vehicleTitle(vehicle),
    vehicle.brand,
    vehicle.make,
    vehicle.model,
    vehicle.trim,
    vehicle.year,
    vehicle.condition,
    bodyPhrases,
    seatPhrases,
    vehicle.drivetrain,
    vehicle.location,
    vehicle.listingCountry,
    vehicle.sellerType,
    vehicle.manufacturerCountry,
    vehicle.manufacturerCountryCode,
    `${vehicle.priceEUR} eur price`,
    `${vehicle.rangeKm} km range reichweite`,
    `${vehicle.efficiencyKwhPer100Km} kwh per 100 km efficiency`,
    `${vehicle.cargoLiters} cargo trunk kofferraum`,
    vehicle.mileageKm ? `${vehicle.mileageKm} km mileage` : null,
    vehicle.batterySoH ? `${vehicle.batterySoH}% battery health` : null,
    vehicle.features.map((feature) => featureLabels[feature]).join(" "),
    vehicle.notes,
    vehicle.warranty,
    vehicle.reviewTags.join(" "),
    vehicle.brandOrigin
  ]
    .filter(Boolean)
    .join(" ");
}
```

- [ ] **Step 4: Run embedding unit tests**

Run: `node --experimental-strip-types --test tests/vehicle-embeddings.test.ts`

Expected: PASS

---

### Task 6: Pilot then full re-embed (ops gate)

**Files:**
- Uses existing: `scripts/embed_vehicles.ts` (`--limit`, `--force`, `--from-supabase`)
- No new code required unless dry-run logging is unclear

**Interfaces:**
- Consumes: dirty hashes from Task 5 text change
- Produces: updated `vehicles.embedding` / `embedding_input_hash`

- [ ] **Step 1: Dry-run pilot**

Run:

```bash
node --experimental-strip-types scripts/embed_vehicles.ts --from-supabase --limit=500 --dry-run
```

Expected: reports how many of 500 would update because `embedding_input_hash` mismatches (should be most/all after Task 5).

- [ ] **Step 2: Execute pilot embed**

Run:

```bash
node --experimental-strip-types scripts/embed_vehicles.ts --from-supabase --limit=500
```

Expected: `updated` ≈ eligible dirty rows; no provider errors.

- [ ] **Step 3: Re-run Phase A probe + compare**

Run: `node --experimental-strip-types scripts/probe_hybrid_semantic_recall.ts`

Compare top-10 qualitative relevance for `sporty-2-seater` / `city-cheap` / `family-suv` vs pre-B notes. Keep `textRankShare` gate from Task 4.

- [ ] **Step 4: Full re-embed only if pilot looks better**

Run:

```bash
node --experimental-strip-types scripts/embed_vehicles.ts --from-supabase
```

Then re-run probe once more. If quality regresses, stop and investigate before enabling broadly in production.

- [ ] **Step 5: Ops note for embedding flag**

Ensure environments with populated vectors set `FLOWRYD_VEHICLE_EMBEDDING_SEARCH=1` (still required for vector path). Document in PR description; do not silently change README defaults unless asked.

---

## Self-review (plan vs spec)

| Spec requirement | Task |
| --- | --- |
| Widen `search_document` | Task 3 |
| Split `ftsQuery` / `embeddingQuery` | Task 2 |
| Synonym expansion module EN+DE | Task 1 |
| Phase A tests + live `text_rank` probe (~30%) | Tasks 1–2 unit, Task 4 live |
| Richer `buildVehicleEmbeddingText` | Task 5 |
| Hash dirty + pilot `--limit` then full embed | Task 6 |
| No hard seat upper-bound / no LLM rewrite | Global constraints |
| Brand FTS regression check | Task 4 `brand-exact` probe |

Placeholder scan: none intentional. Types: `VehicleSearchLexicon`, `expandVehicleSearchLexicon`, `buildVehicleFtsQuery`, `buildVehicleEmbeddingQuery` used consistently across tasks.
