# FlowRyd EV Alpha

A focused alpha for the FlowRyd Austria PoC: natural-language EV discovery,
explainable recommendations, and side-by-side comparison.

## What is included

- Next.js App Router + TypeScript frontend.
- shadcn-style UI components in `components/ui`.
- Deterministic EV criteria extraction, filtering, scoring, and TCO calculation.
- Optional OpenAI explanation generation with deterministic fallback.
- Supabase EU-ready REST repository (runtime source of truth).
- API routes for matching, vehicle lookup, comparison, and seed ingestion.
- Node test runner coverage for parser, matching, TCO, and eval scenarios.
- Repeatable scraper for the public FlowRyd static dashboard.

## Local setup

The system Homebrew Node on this machine is currently broken, so use the working
nvm Node binary directly if needed:

```bash
/Users/paul/.nvm/versions/node/v22.12.0/bin/node \
  /Users/paul/.nvm/versions/node/v22.12.0/lib/node_modules/npm/bin/npm-cli.js install
```

Then run:

```bash
npm run dev
```

## Environment

Supabase is required at runtime. Seed JSON under `data/` and `lib/data/seed-vehicles.ts`
are ingest/test fixtures only — they are not used as a live data store.

Required:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

Optional:

```bash
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1536
FLOWRYD_MATCHING_PIPELINE=classic
FLOWRYD_LIGHT_HARD_MATCHING=0
FLOWRYD_SOFTEN_MATCH_PREFERENCES=0
FLOWRYD_VEHICLE_STRUCTURED_SEARCH=1
FLOWRYD_VEHICLE_EMBEDDING_SEARCH=0
FLOWRYD_VEHICLE_EMBEDDING_SEARCH_LIMIT=200
FLOWRYD_VEHICLE_EMBEDDING_MIN_SIMILARITY=0.1
FLOWRYD_MATCH_DEBUG=0
FLOWRYD_SHOW_SEARCH_CRITERIA=0
INGEST_ADMIN_TOKEN=...
ADMIN_SESSION_SECRET=... # at least 32 random characters for signing admin sessions
AUSTRIA_BEV_INCENTIVE_EUR=0
FIRECRAWL_API_KEY=...
```

OpenAI is used for generated explanations, chat planning, criteria normalization,
and embeddings when `OPENAI_API_KEY` is set; trusted knowledge vectors are
stored in Supabase `knowledge_chunks.embedding` and optional vehicle vectors are
stored in `vehicles.embedding` (pgvector, 1536 dims by default).
Vehicle matching uses structured filters plus keyword/topic scoring by default.
Set `FLOWRYD_VEHICLE_EMBEDDING_SEARCH=1` after populating vehicle embeddings to
augment candidate retrieval with vector search, or set
`FLOWRYD_VEHICLE_STRUCTURED_SEARCH=0` to disable structured Supabase filters.

**Matching pipeline (master toggle):**

- **Master OFF:** `FLOWRYD_MATCHING_PIPELINE=classic` or unset — full hard retrieve (today’s default).
- **Master ON:** `FLOWRYD_MATCHING_PIPELINE=light_hard` — light hard filters, then embeddings, then remaining filters. Alias: `FLOWRYD_LIGHT_HARD_MATCHING=1` when the pipeline var is unset. If both are set, `FLOWRYD_MATCHING_PIPELINE` wins (e.g. `classic` disables light-hard even when the alias is `1`). Pair light-hard with `FLOWRYD_VEHICLE_EMBEDDING_SEARCH=1` after vehicle embeddings are deployed.
- **Sub-flag:** `FLOWRYD_SOFTEN_MATCH_PREFERENCES=1` — non-exclusive body type, range, and condition become score tradeoffs instead of hard excludes. Ignored unless the master pipeline is `light_hard`. Trust constraints (e.g. must-have features, brand exclusions) are never softened.

Set `FLOWRYD_MATCH_DEBUG=1` to attach match diagnostics to API responses and
server logs (`matchingPipeline`, `embeddingHits`, `rejectedSummary`, etc.).
Set `FLOWRYD_SHOW_SEARCH_CRITERIA=1` to attach a searchable
criteria debug panel showing extracted criteria and the filters applied during
inventory search.
LLM paths fall back to deterministic local behavior if the model call is
unavailable.

`AUSTRIA_BEV_INCENTIVE_EUR` defaults to `0` until the incentive source is
verified before a staging demo.

## Conversational explanations and hybrid search

- `FLOWRYD_ENABLE_LLM_EXPLANATIONS=1` enables grounded LLM wording; deterministic explanations remain the fallback.
- Keep `FLOWRYD_VEHICLE_EMBEDDING_SEARCH=1` only after vehicle embeddings and the hybrid migration are deployed.
- Inspect explanation fallback rate, hard-constraint violations (must be zero), p95 match latency, Recall@K, NDCG@K, and catalog coverage after each ranking change.
- Run `npm run eval` before deploying ranking or prompt changes.

## Demo Registration Gate

The alpha uses a lightweight capture gate before matching. Testers provide only
name, email, and an Austrian PLZ or Bundesland, plus explicit consent. The app
does not create passwords, SSO accounts, or saved-vehicle persistence from this
flow.

- `POST /api/demo-registration` validates and stores the tester record, then
  sets an HTTP-only `flowryd_demo_registration` cookie.
- `GET /api/demo-registration` returns the active tester status for the UI.
- `DELETE /api/demo-registration` records `deletion_requested_at` and clears the
  cookie, giving testers a documented deletion path from the demo access panel.
- `POST /api/match` requires an active demo registration and uses the captured
  location as the default matching location unless the chat turn supplies a
  different location.

For demos, use a Supabase project in an EU region and a server-side
`SUPABASE_SERVICE_ROLE_KEY` so writes to `tester_registrations` stay in the
configured EU data store.

## Admin Panel

The admin panel lives at `/admin` and is separate from the public demo UI.

### Setup

1. Apply the `admin_users` migration in `supabase/migrations/202606250001_add_admin_users.sql`.
2. Set `ADMIN_SESSION_SECRET` in `.env.local` (32+ random characters).
3. Create the first admin user:

```bash
npm run admin:create -- --email admin@example.com --password 'your-strong-password' --name 'Admin'
```

- `POST /api/admin/login` validates credentials against `admin_users` and sets an HTTP-only
  `flowryd_admin_session` cookie (8-hour TTL).
- `POST /api/admin/logout` clears the admin session.
- Protected `/admin/*` pages and `/api/admin/*` routes require a valid admin session.

Admin capabilities:

- Browse all `tester_registrations` and open full chat histories.
- Add vehicles via a multi-step wizard, edit existing vehicles, and soft-delete
  by setting `available=false`.
- Import vehicles from CSV (`public/templates/vehicles-sheet-template.csv`) and
  generate embeddings for saved vehicles automatically.

## Scrape FlowRyd Dashboard

```bash
/Users/paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  scripts/scrape_flowryd_site.py
```

Outputs are written to `data/flowryd_site/`:

- `inventory.json` / `inventory.csv`
- `rag.json` / `rag.csv`
- `summary.json`

## Supabase Migrations And Data

Migrations live in `supabase/migrations/`:

- `202606050001_create_app_schema.sql` creates the app tables.
- `202606050002_seed_all_vehicles.sql` upserts all 219 vehicles: 16 curated
  alpha vehicles plus 203 scraped FlowRyd inventory listings.

Apply the migrations to the Supabase project first. If you are using the SQL
editor, run the schema migration and then the seed migration in order. After the
schema exists, this command can refresh vehicles and knowledge documents from
the checked-in data files:

```bash
PATH=/Users/paul/.nvm/versions/node/v22.12.0/bin:$PATH npm run supabase:upload-all
```

For production-safe writes, set `SUPABASE_SERVICE_ROLE_KEY` locally. The
publishable key can only upload if table policies explicitly allow inserts and
upserts.

## Trusted EV Knowledge Corpus

The trusted corpus ingests Austrian/EU EV context into `knowledge_documents` and
`knowledge_chunks`, then stores chunk embeddings for RAG retrieval during
matching. It covers a curated allowlist of official or independent sources:
ADAC winter/range tests, Austrian incentive pages, eMove Austria, E-Control
charging-network pages, EAFO Austria infrastructure pages, and selected OEM
technical-spec pages.

List the configured source ids:

```bash
npm run supabase:ingest-trusted-knowledge -- --list-sources
```

Dry-run scrape without DB writes:

```bash
npm run supabase:ingest-trusted-knowledge -- --dry-run
```

Ingest a subset:

```bash
npm run supabase:ingest-trusted-knowledge -- --source=adac_winter_range_2026,eafo_austria_infrastructure
```

If `FIRECRAWL_API_KEY` is set, the script uses Firecrawl first and falls back to
plain `fetch` unless `--firecrawl-only` is passed. Without Firecrawl it uses
direct `fetch`, which works for many static pages but can be less clean on
JavaScript-heavy sites.

Outputs are also written locally for audit/review:

- `data/trusted_ev_knowledge/documents.json`
- `data/trusted_ev_knowledge/chunks.json`
- `data/trusted_ev_knowledge/latest.json`

Set `FLOWRYD_SKIP_EMBEDDINGS=1` or pass `--skip-embeddings` to upload text
without vector embeddings. For usable semantic retrieval, keep embeddings
enabled and configure `OPENAI_API_KEY`.

## Vehicle Embeddings

Apply `supabase/migrations/202606230001_add_vehicle_embeddings.sql`, then run:

```bash
npm run supabase:embed-vehicles -- --dry-run
npm run supabase:embed-vehicles
```

The script uses `text-embedding-3-small` with 1536 dimensions by default,
batches 64 vehicles per API call, and stores an input hash so unchanged vehicles
are skipped on later runs. Pass `--force` to refresh every row, `--limit=100` to
test a subset, `--from-supabase` for a DB-backed dry-run, or override `--model=`
/ `--dimensions=` if you also update the Supabase vector dimension.

## Austrian Inventory Scraping

Inventory crawling lives in `inventory-scraping/` and uses source-specific
parsers (AutoScout24, willhaben, Tesla API, bmw-boerse, generic OEM cards, RAG
context pages). Fetching is pluggable via `--fetcher=scrapingbee` (default) or
`--fetcher=crawl4ai` (Python + headless Chromium). It covers willhaben.at, AutoScout24.at,
gebrauchtwagen.at, selected Austrian OEM EV pages, and context sources such as
umweltfoerderung.at and e-control.at.

List configured sources:

```bash
npm run inventory:list-sources
```

Dry-run without DB writes:

```bash
npm run inventory:crawl -- --dry-run --max-listings-per-source=10
```

Run a subset:

```bash
npm run inventory:crawl -- --source=willhaben_at_ev,autoscout24_at_ev_all
```

Re-parse cached HTML without network access:

```bash
npm run inventory:crawl:offline -- --source=autoscout24_at_ev_all
```

**ScrapingBee (default):**

```bash
SCRAPINGBEE_API_KEY=...
```

**Crawl4AI (local Python browser):**

```bash
npm run inventory:crawl4ai:setup
export FLOWRYD_PYTHON=inventory-scraping/crawl4ai/.venv/bin/python
npm run inventory:crawl:crawl4ai -- --source=willhaben_at_ev --skip-db
```

**Supabase upload (optional):**

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

Use `--skip-db` for local-only crawling. Per-source audit files are written to
`inventory-scraping/output/json/` and `inventory-scraping/output/csv/`, plus
combined `vehicles.json`, `context-pages.json`, and `summary.json`.

Apply `supabase/migrations/202606090001_add_inventory_scraping_metadata.sql`
before DB uploads. Scraped vehicles include listing URL, seller type, VIN when
visible, high-resolution image URLs, manufacturer country, and deterministic
dedupe keys. The `vehicles_dedupe_key_unique` index prevents duplicate scraped
cars from being inserted when the same listing is rediscovered. Vehicle uploads
write payload rows only; run `npm run supabase:embed-vehicles` after inventory
uploads when vehicle vector search is enabled.
