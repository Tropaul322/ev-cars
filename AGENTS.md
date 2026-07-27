# AGENTS.md

## Cursor Cloud specific instructions

FlowRyd EV Alpha is a single Next.js 15 (App Router) + TypeScript app. It serves
a natural-language EV discovery/matching UI plus API routes. Runtime inventory
comes from Supabase (`SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` + service or
anon key). Bundled seed JSON under `data/` / `lib/data/` is for ingest, offline
evals, and fallback only — PoC and matching QA must use live Supabase data.

Standard commands live in `package.json` (`dev`, `build`, `start`, `lint`,
`typecheck`, `test`, `eval`, `ci`) and setup details are in `README.md`.

Requires Node >= 22.6 (the test/eval/script commands use
`node --experimental-strip-types` to run `.ts` files directly). Node 22 is
already installed in this environment.

### Running the dev server

The Next.js middleware (`utils/supabase/middleware.ts`) constructs a Supabase
client with non-null assertions on `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. If those two vars are unset, EVERY
request 500s with "Your project's URL and Key are required to create a Supabase
client!" — so `npm run dev` with no env is NOT usable in the browser. At
minimum, those two `NEXT_PUBLIC_*` vars must be set for the app to serve pages.

### Live Supabase matching

When pointed at live Supabase, `/api/match` uses marketplace inventory
(Willhaben / Autoscout24 / etc.). Unknown feature keys are normalized on ingest
and safely labeled in RAG / embedding text paths (`featureLabels[feature] ?? …`).

PoC regression coverage lives in `tests/poc-test-summary.test.ts` and **requires**
live Supabase credentials — it refuses to run on seed-only fallback.

Offline ranking evals (`npm run eval`) intentionally use the bundled catalog and
bypass conversational readiness gates beyond budget so ranking metrics stay
stable.

The `embeddings.integration.test.ts` suite auto-skips unless `GEMINI_API_KEY` is
set; the LLM explanation and RAG-embedding paths are optional with deterministic
fallbacks.
