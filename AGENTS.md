# AGENTS.md

## Cursor Cloud specific instructions

FlowRyd EV Alpha is a single Next.js 15 (App Router) + TypeScript app. It serves
a natural-language EV discovery/matching UI plus API routes, and is designed to
run fully on checked-in seed data (219 vehicles) with no external services.
Standard commands live in `package.json` (`dev`, `build`, `start`, `lint`,
`typecheck`, `test`, `eval`, `ci`) and setup details are in `README.md`.

Requires Node >= 22.6 (the test/eval/script commands use
`node --experimental-strip-types` to run `.ts` files directly). Node 22 is
already installed in this environment.

### Running the dev server (important gotcha)

The Next.js middleware (`utils/supabase/middleware.ts`) constructs a Supabase
client with non-null assertions on `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. If those two vars are unset, EVERY
request 500s with "Your project's URL and Key are required to create a Supabase
client!" — so `npm run dev` with no env is NOT usable in the browser despite the
README claiming env-free operation. At minimum, those two `NEXT_PUBLIC_*` vars
must be set for the app to serve pages.

### Live Supabase data triggers a latent crash on `/api/match`

When the data layer points at the injected live Supabase project (via
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, or the `NEXT_PUBLIC_*` fallbacks),
some stored vehicles have a `feature` key that is missing from the
`featureLabels` map in `lib/rag.ts`. This makes `vehicleExcerpt` throw
`Cannot read properties of undefined (reading 'split')`, so the core
`/api/match` endpoint (and the chat UI) returns 500, and 14 tests in
`tests/conversation.test.ts` + match-route tests fail. This is a pre-existing
application bug, not an environment problem.

With pure seed data (data layer NOT pointed at the live Supabase) the bug does
not occur: `npm run lint`, `npm run typecheck`, `npm run test` (53 pass / 2
skip), `npm run eval` (100%) and `npm run build` all succeed, and the match
feature works end to end.

To run/test the fully-working app against seed data while still satisfying the
middleware, point the data layer away from the live Supabase but give the
middleware a dummy endpoint, e.g.:

```bash
env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_ANON_KEY \
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 \
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy-anon-key \
  npm run dev
```

The data layer (`lib/repositories/vehicle-repository.ts`) catches fetch failures
and falls back to the bundled seed data, so the dummy endpoint yields the full
seed experience without the `featureLabels` crash.

The `embeddings.integration.test.ts` suite auto-skips unless `GEMINI_API_KEY` is
set; the LLM explanation and RAG-embedding paths are optional with deterministic
fallbacks.
