import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMatchDiagnostics,
  countPrimaryVehicleKeys,
  vehicleExclusionKeys,
  vehiclePrimaryMatchKey
} from "../lib/match-diagnostics.ts";
import { seedVehicles } from "../lib/data/seed-vehicles.ts";

test("vehicle exclusion keys include listing and dedupe aliases", () => {
  const vehicle = {
    ...seedVehicles[0],
    id: "listing-a",
    dedupeKey: "same-car",
    listingUrl: "https://example.com/listings/same-car?ref=1"
  };

  const keys = vehicleExclusionKeys(vehicle);
  assert.ok(keys.includes("listing-a"));
  assert.ok(keys.includes("dedupe:same-car"));
  assert.ok(keys.includes("listing:https://example.com/listings/same-car"));
});

test("primary match key prefers dedupe and listing aliases", () => {
  const vehicle = {
    ...seedVehicles[0],
    id: "listing-b",
    dedupeKey: "same-car",
    listingUrl: "https://example.com/listings/same-car"
  };

  assert.equal(vehiclePrimaryMatchKey(vehicle), "dedupe:same-car");
});

test("countPrimaryVehicleKeys ignores alias keys", () => {
  const keys = [
    "flowryd:willhaben:abc",
    "listing:https://example.com/car",
    "dedupe:same-car"
  ];
  assert.equal(countPrimaryVehicleKeys(keys), 1);
});

test("buildMatchDiagnostics explains missing embedding search", () => {
  const diagnostics = buildMatchDiagnostics({
    embeddingQueryStatus: "unavailable",
    embeddingHits: 0,
    structuredHits: 120,
    candidatePoolSize: 120,
    scoringPoolSize: 36,
    excludedShownKeys: [],
    isNextBatch: false,
    criteriaChanged: false,
    searchOffset: 0,
    recommendations: []
  });

  assert.match(diagnostics.selectionNotes.join(" "), /Semantic search was skipped/i);
});
