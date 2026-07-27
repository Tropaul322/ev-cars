import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { readNewBrandsListingUrlsFromXlsx, vehicleToBildquelleModelLabel } from "../lib/inventory/new-brands-xlsx.ts";
import {
  extractFirstListingUrl,
  mergeListingUrlsIntoSheetCsv,
  parseVehicleSheetCsv
} from "../lib/inventory/vehicles-sheet-import.ts";

const root = process.cwd();

test("extractFirstListingUrl keeps only the first http URL", () => {
  assert.equal(
    extractFirstListingUrl("https://xpeng-schmidt.at/g6/; https://www.vogl-auto.at/g6/"),
    "https://xpeng-schmidt.at/g6/"
  );
  assert.equal(extractFirstListingUrl("  "), undefined);
});

test("mergeListingUrlsIntoSheetCsv adds listing_url without changing row count", () => {
  const csv = [
    "id,make,model",
    "byd-dolphin-2026,BYD,DOLPHIN",
    "missing-id-2026,BYD,Seal"
  ].join("\n");
  const urls = new Map([["byd-dolphin-2026", "https://www.bydauto.at/modelle/dolphin"]]);
  const updated = mergeListingUrlsIntoSheetCsv(csv, urls);
  const vehicles = parseVehicleSheetCsv(updated);

  assert.equal(vehicles.length, 2);
  assert.equal(vehicles[0]?.listingUrl, "https://www.bydauto.at/modelle/dolphin");
  assert.equal(vehicles[1]?.listingUrl, undefined);
  assert.match(updated, /listing_url/);
});

test("vehicleToBildquelleModelLabel maps inventory rows to sheet model names", () => {
  assert.equal(vehicleToBildquelleModelLabel("AION", "V", "Premium"), "AION V");
  assert.equal(vehicleToBildquelleModelLabel("Lucid", "Air", "Sapphire"), "Lucid Air Sapphire");
  assert.equal(vehicleToBildquelleModelLabel("Polestar", "4", "Dual Motor"), "Polestar 4");
  assert.equal(vehicleToBildquelleModelLabel("BYD", "DOLPHIN", "BEV"), "DOLPHIN");
});

test("readNewBrandsListingUrlsFromXlsx reads column Z from the new brands workbook", () => {
  const xlsxPath = path.join(root, "data", "1", "vehicles-sheet_new brands .xlsx");
  if (!fs.existsSync(xlsxPath)) {
    return;
  }

  const listingUrls = readNewBrandsListingUrlsFromXlsx(xlsxPath);
  assert.ok(listingUrls.size >= 40);
  assert.equal(listingUrls.get("byd-dolphin-surf-2026"), "https://www.bydauto.at/");
  assert.equal(listingUrls.get("xpeng-g6-standard-range-2026"), "https://xpeng-schmidt.at/g6/");
  assert.equal(
    listingUrls.get("aion-v-premium-2026"),
    "https://www.zigwheels.my/new-cars/gac/aion-v/videos"
  );
  assert.equal(listingUrls.get("kgm-musso-ev-4wd-2026"), "https://ev-database.org/de/pkw/3448/KGM-Musso-EV-4WD");
});
