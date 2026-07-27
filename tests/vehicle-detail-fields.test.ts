import test from "node:test";
import assert from "node:assert/strict";
import {
  buildModelDescription,
  getMatchListingDetailSections,
  getVehicleDescriptionForDisplay,
  isMarketplaceListingAdText,
} from "../lib/vehicle-detail-fields.ts";
import type { Vehicle } from "../lib/types.ts";

const baseVehicle: Vehicle = {
  id: "demo-1",
  source: "willhaben",
  market: "AT",
  make: "Peugeot",
  model: "Traveller",
  trim: "Business",
  year: 2023,
  condition: "used",
  priceEUR: 33000,
  monthlyLeaseEUR: null,
  mileageKm: 12000,
  rangeKm: 329,
  efficiencyKwhPer100Km: 22,
  batteryKwh: 75,
  batterySoH: 96,
  chargingCycles: null,
  warranty: "",
  bodyType: "van",
  seats: 8,
  cargoLiters: 900,
  drivetrain: "FWD",
  powerKw: 100,
  available: true,
  features: ["apple_carplay", "heated_seats"],
  images: [],
  notes: "",
  brandOrigin: "europe",
  reviewTags: ["imported"],
};

test("isMarketplaceListingAdText detects scraped listing copy", () => {
  const ad =
    "Finanzierungsbeispiel: Fixzinssatz 4,99% p.a. Bruttokreditbetrag EUR 33.000 ...";
  assert.equal(isMarketplaceListingAdText(ad, "willhaben"), true);
  assert.equal(isMarketplaceListingAdText("Compact family EV with heat pump.", "seed"), false);
});

test("getVehicleDescriptionForDisplay prefers curated notes over ad text", () => {
  const curated = {
    ...baseVehicle,
    source: "seed" as const,
    notes: "Spacious electric MPV for families.",
  };
  assert.equal(getVehicleDescriptionForDisplay(curated), "Spacious electric MPV for families.");

  const scraped = {
    ...baseVehicle,
    notes: `${"A".repeat(200)} Finanzierungsbeispiel EUR 33000`,
  };
  assert.equal(getVehicleDescriptionForDisplay(scraped), buildModelDescription(scraped));
});

test("getMatchListingDetailSections omits raw notes and keeps source metadata", () => {
  const vehicle = {
    ...baseVehicle,
    sourceListingId: "1349954365",
    notes: `${"Long ad ".repeat(40)} Finanzierungsbeispiel`,
  };
  const sections = getMatchListingDetailSections(vehicle);
  assert.equal(sections.length, 2);
  const features = sections.find((section) => section.heading === "Features and notes");
  assert.ok(features);
  assert.ok(features.items.some((item) => item.label === "Description"));
  assert.equal(
    features.items.some((item) => item.label === "Notes"),
    false
  );
  assert.match(features.items.find((item) => item.label === "Description")?.value ?? "", /Peugeot Traveller/);
});
