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
- Python marketplace scraper (`inventory-scraping/`) for willhaben and AutoScout24.

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
Set `FLOWRYD_MATCH_DEBUG=1` to attach match diagnostics to API responses and
server logs. Set `FLOWRYD_SHOW_SEARCH_CRITERIA=1` to attach a searchable
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

Marketplace inventory crawling is a standalone Python package under
`inventory-scraping/` (`ev-cars-scraper`). It scrapes Austrian EV listings from
**willhaben** and **AutoScout24**, writes per-source JSON/CSV, optionally
downloads compressed listing photos, and does **not** write to Supabase
directly. Upload into the app DB is a separate Node step.

More detail lives in [`inventory-scraping/README.md`](inventory-scraping/README.md).

### Setup

Requires Python >= 3.10:

```bash
npm run inventory:setup
cp inventory-scraping/.env.example inventory-scraping/.env
```

Optional: if you crawl with `--backend crawl4ai`, install Playwright browsers:

```bash
cd inventory-scraping && source .venv/bin/activate && crawl4ai-setup
```

Configure rate limits, search URLs, image download, and optional Groq enrichment
in `inventory-scraping/.env` (see `.env.example`). Common knobs:

- `REQUEST_DELAY_SEC`, `CONCURRENCY`, `BATCH_SIZE`, `BATCH_DELAY_SEC`
- `WILLHABEN_SEARCH_URL`, `AUTOSCOUT24_SEARCH_URL`
- `DOWNLOAD_IMAGES`, `IMAGES_DIR`, `OUTPUT_DIR` (default `./output`)
- `GROQ_API_KEY` + `ENABLE_GROQ_FALLBACK` for LLM fill-in of missing fields

Run crawls from `inventory-scraping/` so relative `OUTPUT_DIR=./output` resolves
correctly, or set an absolute `OUTPUT_DIR`.

### Crawl

Smoke test:

```bash
cd inventory-scraping
source .venv/bin/activate
python -m ev_cars_scraper crawl --source willhaben --max-pages 1 --limit 3
```

From the repo root (after `npm run inventory:setup`):

```bash
npm run inventory:crawl -- --source willhaben --max-pages 1 --limit 3
npm run inventory:crawl:willhaben
npm run inventory:crawl:autoscout24
```

Useful flags:

- `--concurrency 5` — parallel listing fetches (recommended for full runs)
- `--max-pages` / `--limit` — cap search pages / detail fetches for development
- `--no-resume` — ignore checkpoint and start search from page 1
- `--resume-search` — continue from `last_search_page` in the checkpoint
- `--backend httpx` (default) or `--backend crawl4ai`
- `--enable-groq-fallback` — enrich null fields via Groq (`GROQ_API_KEY` required)
- `--no-download-images` — keep remote image URLs only
- `--no-batch` — disable batch pauses between listing groups

Full fresh re-crawl of both sources (clears checkpoints + refreshes local images):

```bash
npm run inventory:refresh
```

Unit tests for the scraper:

```bash
npm run inventory:test
```

### Output

Per source under `inventory-scraping/output/` (gitignored):

- `willhaben.json` / `willhaben.csv` / `willhaben.jsonl`
- `autoscout24.json` / `autoscout24.csv` / `autoscout24.jsonl`
- checkpoints: `*.checkpoint.json`
- crawl logs: `*-crawl.log`
- listing photos: `images/<source>/<listingId>.jpg`

The JSON `images` field stores local relative paths (for example
`images/willhaben/2062053964.jpg`) instead of short-lived CDN URLs.

Checked-in snapshot folders such as `inventory-scraping/willhaben/` and
`inventory-scraping/autoscaut24/` are historical crawl artifacts; new runs write
to `output/` by default.

### Upload to Supabase

Apply `supabase/migrations/202606090001_add_inventory_scraping_metadata.sql`
before DB uploads. Scraped vehicles include listing URL, seller type, VIN when
visible, images, and deterministic dedupe keys. The `vehicles_dedupe_key_unique`
index prevents duplicate scraped cars when the same listing is rediscovered.

Point the upload scripts at the scraper JSON. Defaults are
`inventory-scraping/output/willhaben.json` and
`inventory-scraping/output/autoscout24.json`:

```bash
npm run supabase:upload-willhaben -- --dry-run
npm run supabase:upload-willhaben

npm run supabase:upload-autoscout24 -- --dry-run
npm run supabase:upload-autoscout24
```

For a historical snapshot folder, pass `--file=` explicitly, for example
`--file=inventory-scraping/willhaben/willhaben.json`.

Uploads write vehicle payload rows only. When vehicle vector search is enabled,
run embeddings afterwards:

```bash
npm run supabase:embed-vehicles
```
