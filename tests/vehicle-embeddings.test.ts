import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVehicleEmbeddingInput,
  hashVehicleEmbeddingInput
} from "../lib/vehicle-embeddings.ts";
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
