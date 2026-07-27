import assert from "node:assert/strict";
import test from "node:test";
import { emptyCriteria } from "../lib/criteria.ts";
import type { UserCriteria } from "../lib/types.ts";
import { seedVehicles } from "../lib/data/seed-vehicles.ts";
import {
  buildHybridSearchFilters,
  buildVehicleEmbeddingQuery,
  buildVehicleFtsQuery,
  buildVehicleSearchParams,
  filterVehiclesForSearch,
  searchVehicles
} from "../lib/repositories/vehicle-repository.ts";

function minimalVehicle(overrides: Partial<(typeof seedVehicles)[number]> & { id: string }) {
  const template = seedVehicles[0];
  assert.ok(template);
  return { ...template, ...overrides };
}

test("hybrid response keeps retrieval signals and deterministic filters", async () => {
  const template = seedVehicles[0];
  assert.ok(template);
  const criteria = {
    ...emptyCriteria("winter family EV under 50000 EUR"),
    budgetMaxEUR: 50000,
    latestUserMessage: "winter family EV under 50000 EUR"
  };
  const hybridVehicle = {
    ...template,
    id: "hybrid-winter-ev",
    priceEUR: 42000,
    images: ["https://example.com/listing.jpg"]
  };

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
      return new Response(
        JSON.stringify([
          {
            id: hybridVehicle.id,
            payload: hybridVehicle,
            semantic_similarity: 0.84,
            text_rank: 0.12,
            rrf_score: 0.031
          }
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return originalFetch(input, init);
  };

  try {
    const vehicles = await searchVehicles(criteria, "winter family EV");
    assert.equal(vehicles.length, 1);
    assert.equal(vehicles[0]!.embeddingSimilarity, 0.84);
    assert.equal(vehicles[0]!.textRank, 0.12);
    assert.equal(vehicles[0]!.retrievalScore, 0.031);
    assert.equal(vehicles[0]!.priceEUR, 42000);
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

test("post-RPC validation rejects an over-budget returned vehicle", () => {
  const template = seedVehicles[0];
  assert.ok(template);
  const criteria = {
    ...emptyCriteria("EV under 35000 EUR"),
    budgetMaxEUR: 35000
  };
  const overBudgetVehicle = {
    ...template,
    id: "rpc-over-budget",
    priceEUR: 48000
  };

  assert.deepEqual(filterVehiclesForSearch([overBudgetVehicle], criteria), []);
});

test("hybrid search passes explicit hard filters to RPC", () => {
  const filters = buildHybridSearchFilters({
    ...emptyCriteria("Only Korean Kia EV6 under 45000 EUR with max 30000 km"),
    budgetMaxEUR: 45000,
    modelPreferences: ["EV6"],
    preferredBrandOrigins: ["korea"],
    mileageMaxKm: 30000,
    latestUserMessage: "Only Korean Kia EV6 under 45000 EUR with max 30000 km"
  });

  assert.equal(filters.market, "AT");
  assert.equal(filters.available, true);
  assert.equal(filters.budgetMaxEUR, 45000);
  assert.deepEqual(filters.modelPreferences, ["EV6"]);
  assert.deepEqual(filters.hardBrandOrigins, ["korea"]);
  assert.deepEqual(filters.hardBrandOriginCountryCodes, ["KR"]);
  assert.equal(filters.mileageMaxKm, 30000);
});

test("vehicle search pushes generated-column criteria into the Supabase request", () => {
  const params = buildVehicleSearchParams({
    ...emptyCriteria(
      "Only used Korean Kia SUV under 50000 EUR with at least 450 km range that must seat 5"
    ),
    budgetMaxEUR: 50000,
    monthlyBudgetEUR: 650,
    rangeFloorKm: 450,
    mileageMaxKm: 30000,
    preferredCondition: "used",
    bodyTypes: ["suv", "crossover"],
    brandPreferences: ["Kia"],
    modelPreferences: ["EV6"],
    preferredBrandOrigins: ["korea"],
    passengers: 5,
    latestUserMessage:
      "Only used Korean Kia SUV under 50000 EUR with at least 450 km range that must seat 5"
  });

  assert.equal(params.get("market"), "eq.AT");
  assert.equal(params.get("available"), "eq.true");
  assert.equal(params.get("price_eur"), "lte.50000");
  assert.equal(params.get("condition"), "eq.used");
  assert.equal(params.get("range_km"), "gte.450");
  assert.equal(params.get("body_type"), "in.(suv,crossover)");
  assert.equal(params.get("brand"), "in.(Kia)");
  assert.equal(params.get("seats"), "gte.5");
  assert.equal(params.get("mileage_km"), "lte.30000");
  assert.equal(params.get("limit"), "120");
  assert.equal(
    params.get("and"),
    "(or(brand_origin.in.(korea),manufacturer_country_code.in.(KR)),or(monthly_lease_eur.is.null,monthly_lease_eur.lte.650),or(model.ilike.*EV6*,title.ilike.*EV6*))"
  );
  assert.equal(params.get("order"), "range_km.desc,price_eur.asc");
  assert.equal(params.has("or"), false);
  assert.equal(params.has("brand_origin"), false);
});

test("vehicle search expands brand aliases for preferred brands when hard", () => {
  const params = buildVehicleSearchParams({
    ...emptyCriteria("Only VW or Mercedes"),
    brandPreferences: ["VW", "Mercedes-Benz"],
    latestUserMessage: "Only VW or Mercedes"
  });

  assert.equal(params.get("brand"), "in.(VW,Volkswagen,Mercedes-Benz,Mercedes)");
});

test("vehicle search keeps soft brand preferences out of SQL filters", () => {
  const params = buildVehicleSearchParams({
    ...emptyCriteria("Looking for a VW or Mercedes"),
    brandPreferences: ["VW", "Mercedes-Benz"],
    latestUserMessage: "Looking for a VW or Mercedes"
  });

  assert.equal(params.get("brand"), null);
});

test("vehicle search applies avoided brands", () => {
  const params = buildVehicleSearchParams({
    ...emptyCriteria("No Tesla"),
    avoidedBrands: ["Tesla"]
  });

  assert.equal(params.get("brand"), "not.in.(Tesla)");
});

test("vehicle search expands Vienna to Wien for location lookup", () => {
  const params = buildVehicleSearchParams({
    ...emptyCriteria("Tesla in Vienna"),
    location: "Vienna"
  });

  assert.equal(params.get("location"), "ilike.*Wien*");
});

test("vehicle search ignores postal codes as hard location filters", () => {
  const params = buildVehicleSearchParams({
    ...emptyCriteria("Budget EV near me with at least 400 km range"),
    location: "1010",
    budgetMaxEUR: 30000,
    rangeFloorKm: 400
  });

  assert.equal(params.get("location"), null);
  assert.equal(params.get("price_eur"), "lte.30000");
  assert.equal(params.get("range_km"), "gte.400");
});

test("vehicle search applies location and origin fallbacks", () => {
  const params = buildVehicleSearchParams({
    ...emptyCriteria("Only Korean EV in Wien"),
    preferredBrandOrigins: ["korea"],
    location: "Wien",
    latestUserMessage: "Only Korean EV in Wien"
  });

  assert.equal(params.get("location"), "ilike.*Wien*");
  assert.equal(
    params.get("or"),
    "(brand_origin.in.(korea),manufacturer_country_code.in.(KR))"
  );
});

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
  assert.ok(/ or /i.test(fts), "lexicon tokens must use websearch OR semantics");
  assert.ok(/2-seater|zweisitzer/i.test(fts));
  assert.ok(/sporty|sportlich/i.test(emb), "embedding keeps style phrases");
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
    assert.equal((posted as Record<string, unknown>).query_text, expectedFts);
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

test("light-hard retrieve filters omit body/range/model/must-haves", async () => {
  process.env.FLOWRYD_MATCHING_PIPELINE = "light_hard";
  try {
    const criteria: UserCriteria = {
      ...emptyCriteria("must have heat pump SUV at least 400km", "en"),
      budgetMaxEUR: 40000,
      bodyTypes: ["suv"],
      rangeFloorKm: 400,
      modelPreferences: ["Model Y"],
      mustHaveFeatures: ["heat_pump"],
      avoidedBrands: ["Tesla"],
      brandPreferences: ["Ford"]
    };
    criteria.latestUserMessage = "I must have an SUV with at least 400 km range and heat pump, no Tesla";

    const filters = buildHybridSearchFilters(criteria);
    assert.equal(filters.market, "AT");
    assert.equal(filters.available, true);
    assert.equal(filters.budgetMaxEUR, 40000);
    assert.ok(filters.avoidedBrands.length > 0);
    assert.equal(filters.hardRangeFloorKm, null);
    assert.deepEqual(filters.hardBodyTypes, []);
    assert.deepEqual(filters.hardBrandPreferences, []);
    assert.deepEqual(filters.modelPreferences, []);
    assert.deepEqual(filters.mustHaveFeatures, []);
    assert.equal(filters.mileageMaxKm, null);
    assert.equal(filters.batterySoHMin, null);
    assert.equal(filters.hardPassengers, null);
    assert.equal(filters.hardCondition, null);
  } finally {
    delete process.env.FLOWRYD_MATCHING_PIPELINE;
  }
});

test("classic pipeline keeps full hard retrieve filters (toggle OFF)", () => {
  process.env.FLOWRYD_MATCHING_PIPELINE = "classic";
  try {
    const criteria: UserCriteria = {
      ...emptyCriteria("I must have an SUV with at least 400 km range", "en"),
      budgetMaxEUR: 40000,
      bodyTypes: ["suv"],
      rangeFloorKm: 400,
      latestUserMessage: "I must have an SUV with at least 400 km range"
    };
    const filters = buildHybridSearchFilters(criteria);
    assert.ok(filters.hardRangeFloorKm === 400 || (filters.hardBodyTypes?.length ?? 0) > 0);
  } finally {
    delete process.env.FLOWRYD_MATCHING_PIPELINE;
  }
});

test("light-hard filterVehiclesForSearch keeps over-range SUV in pool when only budget/avoid apply", () => {
  process.env.FLOWRYD_MATCHING_PIPELINE = "light_hard";
  try {
    const criteria: UserCriteria = {
      ...emptyCriteria("SUV preferably 400km", "en"),
      budgetMaxEUR: 50000,
      rangeFloorKm: 400,
      bodyTypes: ["suv"],
      avoidedBrands: [] as string[]
    };
    const lowRangeSuv = minimalVehicle({
      id: "low-range",
      bodyType: "suv",
      rangeKm: 280,
      priceEUR: 35000
    });
    const kept = filterVehiclesForSearch([lowRangeSuv], criteria);
    assert.equal(kept.length, 1);
  } finally {
    delete process.env.FLOWRYD_MATCHING_PIPELINE;
  }
});

test("light-hard buildVehicleSearchParams omits body/range/model hard filters", () => {
  process.env.FLOWRYD_MATCHING_PIPELINE = "light_hard";
  try {
    const params = buildVehicleSearchParams({
      ...emptyCriteria("must have heat pump SUV at least 400km", "en"),
      budgetMaxEUR: 40000,
      monthlyBudgetEUR: 650,
      bodyTypes: ["suv"],
      rangeFloorKm: 400,
      mileageMaxKm: 30000,
      preferredCondition: "used",
      brandPreferences: ["Ford"],
      modelPreferences: ["Model Y"],
      preferredBrandOrigins: ["korea"],
      passengers: 5,
      avoidedBrands: ["Tesla"],
      location: "Wien",
      latestUserMessage: "I must have an SUV with at least 400 km range and heat pump, no Tesla"
    });

    assert.equal(params.get("market"), "eq.AT");
    assert.equal(params.get("available"), "eq.true");
    assert.equal(params.get("price_eur"), "lte.40000");
    assert.equal(params.get("brand"), "not.in.(Tesla)");
    assert.equal(params.get("or"), "(monthly_lease_eur.is.null,monthly_lease_eur.lte.650)");
    assert.equal(params.get("condition"), null);
    assert.equal(params.get("range_km"), null);
    assert.equal(params.get("body_type"), null);
    assert.equal(params.get("seats"), null);
    assert.equal(params.get("mileage_km"), null);
    assert.equal(params.get("location"), null);
    assert.equal(params.get("and"), null);
  } finally {
    delete process.env.FLOWRYD_MATCHING_PIPELINE;
  }
});

test("light-hard filterVehiclesForSearch still drops over-budget and avoided brands", () => {
  process.env.FLOWRYD_MATCHING_PIPELINE = "light_hard";
  try {
    const criteria: UserCriteria = {
      ...emptyCriteria("no Tesla under 40k", "en"),
      budgetMaxEUR: 40000,
      rangeFloorKm: 400,
      bodyTypes: ["suv"],
      avoidedBrands: ["Tesla"]
    };
    const overBudget = minimalVehicle({ id: "over", priceEUR: 55000, make: "Ford" });
    const avoided = minimalVehicle({ id: "tesla", priceEUR: 35000, make: "Tesla" });
    assert.deepEqual(filterVehiclesForSearch([overBudget, avoided], criteria), []);
  } finally {
    delete process.env.FLOWRYD_MATCHING_PIPELINE;
  }
});
