import assert from "node:assert/strict";
import test from "node:test";
import { buildVehicleImageCandidates, normalizeVehicleImageUrl, sanitizeVehicleImages, VEHICLE_IMAGE_PLACEHOLDER } from "../lib/vehicle-images.ts";
import type { Vehicle } from "../lib/types.ts";

const baseVehicle: Vehicle = {
  id: "test-vehicle",
  source: "willhaben",
  market: "AT",
  make: "BYD",
  model: "Atto 3",
  trim: "Design",
  year: 2024,
  priceEUR: 38990,
  monthlyLeaseEUR: null,
  condition: "new",
  mileageKm: null,
  rangeKm: 420,
  efficiencyKwhPer100Km: 16,
  batteryKwh: 60,
  batterySoH: null,
  chargingCycles: null,
  warranty: "Factory warranty",
  bodyType: "suv",
  seats: 5,
  cargoLiters: 440,
  drivetrain: "FWD",
  powerKw: 150,
  available: true,
  features: ["apple_carplay"],
  images: [],
  notes: "Test vehicle fixture.",
  brandOrigin: "china",
  reviewTags: []
};

test("normalizeVehicleImageUrl strips _hoved before extension", () => {
  assert.equal(
    normalizeVehicleImageUrl("https://cache.willhaben.at/mmo/1/816/337/111_440598434_hoved.jpg"),
    "https://cache.willhaben.at/mmo/1/816/337/111_440598434.jpg"
  );
  assert.equal(
    normalizeVehicleImageUrl("https://cache.willhaben.at/mmo/5/108/713/4355_1965489212_n_hoved.jpg"),
    "https://cache.willhaben.at/mmo/5/108/713/4355_1965489212_n.jpg"
  );
});

test("sanitizeVehicleImages dedupes hoved variants and prefers og:image", () => {
  const vehicle = sanitizeVehicleImages({
    ...baseVehicle,
    images: [
      "https://cache.willhaben.at/mmo/5/108/713/4355_1965489212_n_hoved.jpg",
      "https://cache.willhaben.at/mmo/5/108/713/4355_1965489212_n.jpg",
      "https://cache.willhaben.at/mmo/5/108/713/4355_1965489212_n_thumb.jpg"
    ],
    imageDetails: [
      {
        url: "https://cache.willhaben.at/mmo/5/108/713/4355_1965489212_n.jpg",
        source: "og:image"
      },
      {
        url: "https://cache.willhaben.at/mmo/5/108/713/4355_1965489212_n_hoved.jpg",
        source: "inline"
      }
    ]
  });

  assert.deepEqual(vehicle.images, [
    "https://cache.willhaben.at/mmo/5/108/713/4355_1965489212_n.jpg"
  ]);
  assert.equal(vehicle.imageDetails?.length, 1);
  assert.equal(vehicle.imageDetails?.[0]?.source, "og:image");
});

test("buildVehicleImageCandidates falls back to the local placeholder", () => {
  assert.deepEqual(buildVehicleImageCandidates([]), [VEHICLE_IMAGE_PLACEHOLDER]);
  assert.deepEqual(buildVehicleImageCandidates(["not-a-url"]), [VEHICLE_IMAGE_PLACEHOLDER]);
});

test("buildVehicleImageCandidates keeps valid urls before the placeholder", () => {
  assert.deepEqual(
    buildVehicleImageCandidates([
      "https://cache.willhaben.at/mmo/1/816/337/111_440598434_hoved.jpg",
      "https://cache.willhaben.at/mmo/1/816/337/111_440598434_hoved.jpg"
    ]),
    [
      "https://cache.willhaben.at/mmo/1/816/337/111_440598434.jpg",
      VEHICLE_IMAGE_PLACEHOLDER
    ]
  );
});

test("sanitizeVehicleImages drops willhaben campaign placeholders", () => {
  const vehicle = sanitizeVehicleImages({
    ...baseVehicle,
    images: [
      "https://cache.willhaben.at/campaigns-v2/psb_fcb53964-4570-4a27-8244-8029f629f75e.png",
      "https://cache.willhaben.at/mmo/1/816/337/111_440598434_hoved.jpg"
    ]
  });

  assert.deepEqual(vehicle.images, [
    "https://cache.willhaben.at/mmo/1/816/337/111_440598434.jpg"
  ]);
});
