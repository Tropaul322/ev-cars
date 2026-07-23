import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVehicleEmbeddingInput,
  hashVehicleEmbeddingInput
} from "../lib/vehicle-embeddings.ts";
import { buildVehicleEmbeddingText } from "../lib/vehicle-embedding-text.ts";
import { buildDefaultVehicle } from "../lib/repositories/admin-vehicle-repository.ts";

test("buildVehicleEmbeddingInput formats title and vehicle text", () => {
  const vehicle = buildDefaultVehicle({
    make: "Volkswagen",
    model: "ID.3",
    year: 2023,
    trim: "Pro",
    notes: "Efficient city hatchback."
  });

  const input = buildVehicleEmbeddingInput(vehicle);
  assert.match(input, /^title: /);
  assert.match(input, /Volkswagen ID\.3/);
  assert.match(input, /Efficient city hatchback/);
});

test("hashVehicleEmbeddingInput is stable for the same input", () => {
  const value = "title: VW ID.3 | text: efficient hatchback";
  assert.equal(hashVehicleEmbeddingInput(value), hashVehicleEmbeddingInput(value));
  assert.notEqual(hashVehicleEmbeddingInput(value), hashVehicleEmbeddingInput(`${value} `));
});

test("buildVehicleEmbeddingText includes bilingual 2-seat and body aliases", () => {
  const vehicle = buildDefaultVehicle({
    make: "Mazda",
    model: "MX-30",
    notes: "Fun city EV"
  });
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
