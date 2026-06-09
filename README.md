# FlowRyd EV Alpha

A focused alpha for the FlowRyd Austria PoC: natural-language EV discovery,
explainable recommendations, and side-by-side comparison.

## What is included

- Next.js App Router + TypeScript frontend.
- shadcn-style UI components in `components/ui`.
- Deterministic EV criteria extraction, filtering, scoring, and TCO calculation.
- Optional OpenAI-compatible explanation generation with deterministic fallback.
- Supabase EU-ready REST repository, with seed-data fallback for local demos.
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

The app works with local seed data without environment variables.

Optional:

```bash
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.1-flash-lite
GEMINI_EMBEDDING_MODEL=gemini-embedding-2
GEMINI_EMBEDDING_DIMENSIONS=1536
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
INGEST_ADMIN_TOKEN=...
AUSTRIA_BEV_INCENTIVE_EUR=0
FIRECRAWL_API_KEY=...
```

Gemini is preferred for generated explanations when `GEMINI_API_KEY` is set.
Gemini Embedding 2 is preferred for RAG embeddings when `GEMINI_API_KEY` is set;
vectors are stored in Supabase `knowledge_chunks.embedding` (pgvector, 1536 dims).
OpenAI-compatible explanations remain available when only `OPENAI_API_KEY` is
configured. Both paths fall back to deterministic local explanations if the
model call is unavailable.

`AUSTRIA_BEV_INCENTIVE_EUR` defaults to `0` until the incentive source is
verified before a staging demo.

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
enabled and configure `GEMINI_API_KEY` or `OPENAI_API_KEY`.

## Austrian Inventory Scraping

Inventory crawling lives in `inventory-scraping/` and uses Firecrawl for URL
mapping plus page scraping. It covers willhaben.at, AutoScout24.at,
gebrauchtwagen.at, selected Austrian OEM EV pages, and the requested context
sources:

- `https://eletric-vehicles.com/`
- `https://www.umweltfoerderung.at/privatpersonen`
- `https://nearcharger.sk/`

List configured sources:

```bash
npm run inventory:list-sources
```

Dry-run a small Firecrawl crawl without DB writes:

```bash
npm run inventory:crawl -- --dry-run --skip-embeddings --max-listings-per-source=10
```

Run a subset:

```bash
npm run inventory:crawl -- --source=willhaben_ev_used,autoscout24_at_ev_all --skip-embeddings
```

The crawler requires:

```bash
FIRECRAWL_API_KEY=fc-...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

Use `--skip-db` for local-only crawling. Audit files are written to
`inventory-scraping/output/`:

- `raw-listings.json`
- `vehicles.json`
- `context-pages.json`
- `latest.json`

Apply `supabase/migrations/202606090001_add_inventory_scraping_metadata.sql`
before DB uploads. Scraped vehicles include listing URL, seller type, VIN when
visible, high-resolution image URLs, manufacturer country, and deterministic
dedupe keys. The `vehicles_dedupe_key_unique` index prevents duplicate scraped
cars from being inserted when the same listing is rediscovered.
