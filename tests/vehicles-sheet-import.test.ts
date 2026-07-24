import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  parseVehicleSheetCsv,
  vehiclesToSupabaseCsv
} from "../lib/inventory/vehicles-sheet-import.ts";

const root = process.cwd();

test("parseVehicleSheetCsv reads flat sheet columns", () => {
  const csv = fs.readFileSync(path.join(root, "data/templates/vehicles-sheet-template.csv"), "utf8");
  const vehicles = parseVehicleSheetCsv(csv);

  assert.equal(vehicles.length, 2);
  assert.equal(vehicles[0]?.id, "vw-id3-pro-2023");
  assert.equal(vehicles[0]?.make, "Volkswagen");
  assert.deepEqual(vehicles[0]?.features?.slice(0, 2), ["apple_carplay", "android_auto"]);
});

test("vehiclesToSupabaseCsv produces id,payload headers", () => {
  const csv = fs.readFileSync(path.join(root, "data/templates/vehicles-sheet-template.csv"), "utf8");
  const vehicles = parseVehicleSheetCsv(csv);
  const output = vehiclesToSupabaseCsv(vehicles);

  assert.match(output, /^id,payload\n/);
  assert.match(output, /vw-id3-pro-2023/);
});

test("parseVehicleSheetCsv applies defaults for omitted technical fields", () => {
  const csv = [
    "id,make,model,trim,year,condition,price_eur,range_km,efficiency_kwh_per_100_km,battery_kwh,body_type,seats,cargo_liters,drivetrain,power_kw",
    "mini-ev-2024,Mini,Cooper,SE,2024,new,28900,400,15,40,hatchback,4,200,FWD,120"
  ].join("\n");

  const [vehicle] = parseVehicleSheetCsv(csv);

  assert.equal(vehicle?.source, "seed");
  assert.equal(vehicle?.market, "AT");
  assert.equal(vehicle?.available, true);
  assert.equal(vehicle?.brandOrigin, "other");
  assert.equal(vehicle?.dedupeKey, "mini-ev-2024");
  assert.equal(vehicle?.title, "Mini Cooper SE");
});
