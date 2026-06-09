import test from "node:test";
import assert from "node:assert/strict";
import { isPlausibleVin, normalizeVin, parseVinFromText } from "../inventory-scraping/vin.ts";

test("rejects willhaben UI false positives", () => {
  assert.equal(parseVinFromText("Fahrzeugbewertung Kundenbewertungen"), null);
  assert.equal(normalizeVin("FAHRZEUGBEWERTUNG"), null);
  assert.equal(normalizeVin("KUNDENBEWERTUNGEN"), null);
  assert.equal(normalizeVin("CKRAUMBELEUCHTUNG"), null);
});

test("accepts a valid checksum VIN", () => {
  const vin = "1HGCM82633A004352";
  assert.equal(isPlausibleVin(vin), true);
  assert.equal(parseVinFromText(`Fahrgestellnummer: ${vin}`), vin);
});

test("parses labeled VIN from text", () => {
  assert.equal(parseVinFromText("VIN: 1HGCM82633A004352"), "1HGCM82633A004352");
});
