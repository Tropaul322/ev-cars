import fs from "node:fs";
import path from "node:path";
import { createDocumentEmbedding, embeddingDimensions } from "../lib/embeddings.ts";
import { getSupabaseRestConfig } from "../lib/repositories/supabase-rest.ts";
import type { Vehicle } from "../lib/types.ts";
import { buildVehicleEmbeddingText, vehicleTitle } from "../lib/vehicle-embedding-text.ts";

type VehicleRow = {
  id: string;
  payload: Vehicle;
};

type BackfillOptions = {
  batchSize: number;
  limit: number | null;
  delayMs: number;
  retries: number;
  dryRun: boolean;
  source: string | null;
};

type EmbeddingResult = {
  embedding: number[] | null;
  error: string | null;
};

type BackfillFailure = {
  id: string;
  title: string;
  error: string;
};

const root = process.cwd();
const env = loadEnv(path.join(root, ".env.local"));
for (const [key, value] of Object.entries(env)) {
  if (typeof value === "string") process.env[key] = value;
}

const options = parseArgs(process.argv.slice(2));
const supabase = getSupabaseRestConfig();
if (!supabase) {
  throw new Error(
    "Missing Supabase credentials. Set SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local."
  );
}

if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
  throw new Error("Missing GEMINI_API_KEY or OPENAI_API_KEY for embedding generation.");
}

let attempted = 0;
let updated = 0;
let failed = 0;
const failures: BackfillFailure[] = [];

console.log(
  `Backfilling vehicle embeddings: batchSize=${options.batchSize}, limit=${options.limit ?? "all"}, source=${options.source ?? "all"}, dryRun=${options.dryRun}`
);

while (true) {
  if (options.limit !== null && attempted >= options.limit) break;

  const batchLimit =
    options.limit === null ? options.batchSize : Math.min(options.batchSize, options.limit - attempted);
  if (batchLimit <= 0) break;

  const rows = await fetchVehiclesMissingEmbeddings(batchLimit, options.source);
  if (!rows.length) break;

  for (const row of rows) {
    if (options.limit !== null && attempted >= options.limit) break;
    attempted += 1;

    const vehicle = row.payload;
    const title = vehicleTitle(vehicle);
    const text = buildVehicleEmbeddingText(vehicle);

    if (options.dryRun) {
      console.log(`[dry-run] would embed ${row.id} (${title})`);
      updated += 1;
      continue;
    }

    try {
      const result = await createDocumentEmbeddingWithRetry(text, title, options);
      if (!result.embedding) {
        failed += 1;
        const error = result.error ?? "unknown embedding failure";
        failures.push({ id: row.id, title, error });
        console.warn(`Failed to embed ${row.id} (${title}): ${error}`);
        continue;
      }

      await patchVehicleEmbedding(row.id, result.embedding);
      updated += 1;

      if (updated % 10 === 0) {
        console.log(`  Progress: ${updated} updated, ${failed} failed, ${attempted} attempted`);
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ id: row.id, title, error: message });
      console.warn(`Failed to embed ${row.id} (${title}): ${message}`);
    }
  }
}

console.table([
  {
    attempted,
    updated,
    failed,
    embeddingDimensions: embeddingDimensions()
  }
]);

if (failures.length) {
  console.warn(`\n${failures.length} failure(s):`);
  console.table(failures);
}

async function fetchVehiclesMissingEmbeddings(limit: number, source: string | null) {
  const params = new URLSearchParams({
    select: "id,payload",
    embedding: "is.null",
    order: "id.asc",
    limit: String(limit)
  });

  if (source) params.set("source", `eq.${source}`);

  const response = await fetch(`${supabase!.url}/rest/v1/vehicles?${params}`, {
    headers: supabase!.headers
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch vehicles without embeddings: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as VehicleRow[];
}

async function patchVehicleEmbedding(id: string, embedding: number[]) {
  const response = await fetch(`${supabase!.url}/rest/v1/vehicles?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      ...supabase!.headers,
      Prefer: "return=minimal"
    },
    body: JSON.stringify({
      embedding: `[${embedding.join(",")}]`
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to update embedding for ${id}: ${response.status} ${body}`);
  }
}

async function createDocumentEmbeddingWithRetry(
  content: string,
  title: string,
  opts: BackfillOptions
): Promise<EmbeddingResult> {
  const preflightError = preflightEmbeddingError(content);
  if (preflightError) {
    return { embedding: null, error: preflightError };
  }

  const attempts = Math.max(1, opts.retries + 1);
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const embedding = await createDocumentEmbedding(content, title);
      if (embedding) {
        if (opts.delayMs > 0) await sleep(opts.delayMs);
        return { embedding, error: null };
      }

      if (attempt === attempts) {
        lastError = await probeEmbeddingFailure(content, title);
      } else {
        lastError = "embedding API returned null";
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < attempts) await sleep(opts.delayMs * attempt);
  }

  return {
    embedding: null,
    error: lastError ?? `embedding API returned no result after ${attempts} attempt(s)`
  };
}

function preflightEmbeddingError(content: string) {
  if (process.env.FLOWRYD_DISABLE_EMBEDDINGS === "1") {
    return "embeddings disabled (FLOWRYD_DISABLE_EMBEDDINGS=1)";
  }

  if (!content.replace(/\s+/g, " ").trim()) {
    return "empty embedding text";
  }

  if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
    return "missing GEMINI_API_KEY and OPENAI_API_KEY";
  }

  return null;
}

function formatDocumentEmbeddingInput(content: string, title: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  const documentTitle = title.trim() || "none";
  return `title: ${documentTitle} | text: ${normalized}`;
}

async function probeEmbeddingFailure(content: string, title: string) {
  const input = formatDocumentEmbeddingInput(content, title);
  const errors: string[] = [];

  if (process.env.GEMINI_API_KEY) {
    const geminiError = await probeGeminiEmbeddingFailure(input);
    if (geminiError) errors.push(`Gemini: ${geminiError}`);
  }

  if (process.env.OPENAI_API_KEY) {
    const openAiError = await probeOpenAiEmbeddingFailure(input);
    if (openAiError) errors.push(`OpenAI: ${openAiError}`);
  }

  if (!errors.length) {
    return "embedding API returned null (no provider error details available)";
  }

  return errors.join("; ");
}

async function probeGeminiEmbeddingFailure(input: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";
  const model = process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2";
  const modelPath = model.startsWith("models/") ? model : `models/${model}`;

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/${modelPath}:embedContent?${new URLSearchParams({ key: apiKey })}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelPath,
          content: {
            parts: [{ text: input }]
          },
          output_dimensionality: embeddingDimensions()
        }),
        signal: AbortSignal.timeout(5000)
      }
    );

    if (response.ok) {
      return "response ok but embedding values missing or invalid dimensionality";
    }

    return await formatHttpError(response);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function probeOpenAiEmbeddingFailure(input: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        input,
        dimensions: embeddingDimensions()
      }),
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      return "response ok but embedding values missing or invalid dimensionality";
    }

    return await formatHttpError(response);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function formatHttpError(response: Response) {
  const body = await response.text();
  const trimmed = body.trim();

  if (!trimmed) {
    return `HTTP ${response.status} ${response.statusText}`.trim();
  }

  try {
    const payload = JSON.parse(trimmed) as {
      error?: { message?: string; code?: string | number };
      message?: string;
    };
    const message = payload.error?.message ?? payload.message;
    const code = payload.error?.code;
    if (message && code !== undefined) return `HTTP ${response.status}: ${message} (${code})`;
    if (message) return `HTTP ${response.status}: ${message}`;
  } catch {
    // fall through to raw body
  }

  return `HTTP ${response.status}: ${trimmed.slice(0, 300)}`;
}

function parseArgs(args: string[]): BackfillOptions {
  const optionsValue: BackfillOptions = {
    batchSize: 25,
    limit: null,
    delayMs: Number(process.env.FLOWRYD_EMBEDDING_DELAY_MS ?? 400),
    retries: Number(process.env.FLOWRYD_EMBEDDING_RETRIES ?? 3),
    dryRun: false,
    source: null
  };

  for (const arg of args) {
    if (arg === "--dry-run") optionsValue.dryRun = true;
    else if (arg.startsWith("--batch-size=")) optionsValue.batchSize = positiveInteger(arg, "--batch-size");
    else if (arg.startsWith("--limit=")) optionsValue.limit = positiveInteger(arg, "--limit");
    else if (arg.startsWith("--delay-ms=")) optionsValue.delayMs = positiveInteger(arg, "--delay-ms");
    else if (arg.startsWith("--retries=")) optionsValue.retries = positiveInteger(arg, "--retries");
    else if (arg.startsWith("--source=")) optionsValue.source = arg.slice("--source=".length) || null;
  }

  return optionsValue;
}

function positiveInteger(arg: string, name: string) {
  const value = Number(arg.slice(name.length + 1));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return process.env;
  const values: Record<string, string> = { ...process.env } as Record<string, string>;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    values[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }

  return values;
}
