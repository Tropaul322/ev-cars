import type { Feature, Vehicle, VehicleCondition, VehicleSellerType } from "./types";
import { formatEUR, formatNumber } from "./utils.ts";

export type VehicleDetailItem = {
  label: string;
  value: string;
};

export type VehicleDetailSection = {
  heading: string;
  items: VehicleDetailItem[];
};

type DetailValue = string | number | boolean | null | undefined;

const featureLabels: Record<Feature, string> = {
  adaptive_cruise_control: "Adaptive cruise control",
  android_auto: "Android Auto",
  apple_carplay: "Apple CarPlay",
  awd: "All-wheel drive",
  blind_spot_detection: "Blind spot detection",
  cabin_storage: "Cabin storage",
  heat_pump: "Heat pump",
  heated_seats: "Heated seats",
  lane_keeping_assist: "Lane keeping assist",
  large_trunk: "Large trunk",
  premium_audio: "Premium audio",
  reliable_connectivity: "Reliable connectivity",
  voice_assistant: "Voice assistant",
  wireless_charging: "Wireless charging"
};

export function getVehicleDetailStats(vehicle: Vehicle, price = formatEUR(vehicle.priceEUR)): VehicleDetailItem[] {
  return [
    { label: "Price", value: price },
    { label: "Range", value: `${formatNumber(vehicle.rangeKm)} km` },
    { label: "Mileage", value: vehicle.mileageKm === null ? "Not provided" : `${formatNumber(vehicle.mileageKm)} km` },
    { label: "Battery", value: `${vehicle.batteryKwh} kWh` },
    { label: "Power", value: formatPower(vehicle.powerKw) },
    { label: "Cargo", value: `${formatNumber(vehicle.cargoLiters)} L` },
    { label: "Efficiency", value: `${vehicle.efficiencyKwhPer100Km} kWh/100 km` },
    { label: "SoH", value: vehicle.batterySoH === null ? "Not provided" : `${vehicle.batterySoH}%` }
  ];
}

export function getVehicleDescriptionForDisplay(vehicle: Vehicle): string | undefined {
  const notes = vehicle.notes?.trim();
  if (notes && !isMarketplaceListingAdText(notes, vehicle.source)) {
    return notes;
  }
  return buildModelDescription(vehicle);
}

export function isMarketplaceListingAdText(notes: string, source: Vehicle["source"]): boolean {
  const normalized = notes.trim();
  if (!normalized) return false;

  const marketplaceSources = new Set<Vehicle["source"]>(["willhaben", "autoscout24_at", "gebrauchtwagen_at"]);
  if (marketplaceSources.has(source)) {
    if (normalized.length > 180) return true;
    if (/inventory listing crawled|html hash:/i.test(normalized)) return true;
  }

  if (normalized.length > 320) return true;
  if (/Finanzierungsbeispiel|Bruttokreditbetrag|Fixzinssatz|Leasingbeispiel/i.test(normalized)) return true;
  if ((normalized.match(/€|\bEUR\b/gi)?.length ?? 0) >= 3) return true;

  return false;
}

export function buildModelDescription(vehicle: Vehicle): string {
  const identity = [vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ");
  const details = [
    formatCondition(vehicle.condition),
    String(vehicle.year),
    formatBodyType(vehicle.bodyType),
    vehicle.drivetrain,
    `${formatNumber(vehicle.rangeKm)} km range`,
    `${vehicle.batteryKwh} kWh battery`,
    vehicle.powerKw ? formatPower(vehicle.powerKw) : undefined
  ].filter(Boolean);

  return [identity, details.join(" · ")].filter(Boolean).join(" — ");
}

/** Compact listing metadata for match/chat listing details. */
export function getMatchListingDetailSections(vehicle: Vehicle): VehicleDetailSection[] {
  const sections: VehicleDetailSection[] = [
    {
      heading: "Seller and source",
      items: compactItems([
        detailItem("Source", formatSource(vehicle.source)),
        detailItem("Source ID", vehicle.sourceListingId),
        detailItem("Last updated", formatDateTime(vehicle.sourceUpdatedAt)),
        detailItem("Crawled", formatDateTime(vehicle.crawledAt))
      ])
    },
    buildFeaturesAndDescriptionSection(vehicle)
  ];

  return sections.filter((section) => section.items.length > 0);
}

export function getVehicleDetailSections(vehicle: Vehicle): VehicleDetailSection[] {
  const sections: VehicleDetailSection[] = [
    {
      heading: "Vehicle",
      items: compactItems([
        detailItem("Listing title", differentFromGeneratedTitle(vehicle.title, vehicle)),
        detailItem("Make", vehicle.make),
        detailItem("Model", vehicle.model),
        detailItem("Trim", vehicle.trim),
        detailItem("Year", vehicle.year),
        detailItem("Condition", formatCondition(vehicle.condition)),
        detailItem("Body", formatBodyType(vehicle.bodyType)),
        detailItem("Seats", vehicle.seats),
        detailItem("Doors", vehicle.doors),
        detailItem("Exterior", vehicle.exteriorColor),
        detailItem("First registration", formatLooseDate(vehicle.firstRegistration)),
        detailItem("Transmission", vehicle.transmission),
        detailItem("Description", getVehicleDescriptionForDisplay(vehicle))
      ])
    },
    {
      heading: "EV specs",
      items: compactItems([
        detailItem("Range", `${formatNumber(vehicle.rangeKm)} km`),
        detailItem("Battery capacity", `${vehicle.batteryKwh} kWh`),
        detailItem("Efficiency", `${vehicle.efficiencyKwhPer100Km} kWh/100 km`),
        detailItem("Battery SoH", vehicle.batterySoH === null ? undefined : `${vehicle.batterySoH}%`),
        detailItem(
          "Charging cycles",
          vehicle.chargingCycles === null ? undefined : formatNumber(vehicle.chargingCycles)
        ),
        detailItem("Drivetrain", vehicle.drivetrain),
        detailItem("Power", formatPower(vehicle.powerKw)),
        detailItem("Cargo", `${formatNumber(vehicle.cargoLiters)} L`),
        detailItem("Warranty", normalizeWarranty(vehicle.warranty))
      ])
    },
    {
      heading: "Price and ownership",
      items: compactItems([
        detailItem("Price", formatEUR(vehicle.priceEUR)),
        detailItem("Price label", vehicle.priceLabel),
        detailItem("Monthly lease", vehicle.monthlyLeaseEUR === null ? undefined : formatEUR(vehicle.monthlyLeaseEUR)),
        detailItem("Leasing eligible", formatBoolean(vehicle.leasingEligible)),
        detailItem(
          "Lease duration",
          vehicle.leaseDurationMonths ? `${vehicle.leaseDurationMonths} months` : undefined
        ),
        detailItem(
          "Advance payment",
          vehicle.leaseAdvancePaymentEUR === null || vehicle.leaseAdvancePaymentEUR === undefined
            ? undefined
            : formatEUR(vehicle.leaseAdvancePaymentEUR)
        ),
        detailItem(
          "Residual value",
          vehicle.leaseResidualValueEUR === null || vehicle.leaseResidualValueEUR === undefined
            ? undefined
            : formatEUR(vehicle.leaseResidualValueEUR)
        ),
        detailItem("Lease details", vehicle.leaseDetails),
        detailItem("VAT deductible", formatBoolean(vehicle.vatDeductible)),
        detailItem("Availability", vehicle.available ? "Available" : "Unavailable")
      ])
    },
    {
      heading: "Seller and source",
      items: compactItems([
        detailItem("Seller", vehicle.sellerName),
        detailItem("Seller type", formatSellerType(vehicle.sellerType)),
        detailItem("Location", vehicle.location),
        detailItem("Listing country", vehicle.listingCountry),
        detailItem("Market", vehicle.market),
        detailItem("Source", formatSource(vehicle.source)),
        detailItem("Source ID", vehicle.sourceListingId),
        detailItem("VIN", vehicle.vin),
        detailItem("Manufacturer country", vehicle.manufacturerCountry),
        detailItem("Last updated", formatDateTime(vehicle.sourceUpdatedAt)),
        detailItem("Crawled", formatDateTime(vehicle.crawledAt))
      ])
    },
    buildFeaturesAndDescriptionSection(vehicle, { includeDescription: false })
  ];

  return sections.filter((section) => section.items.length > 0);
}

function buildFeaturesAndDescriptionSection(
  vehicle: Vehicle,
  options: { includeDescription?: boolean } = {}
): VehicleDetailSection {
  const includeDescription = options.includeDescription ?? true;
  return {
    heading: "Features and notes",
    items: compactItems([
      detailItem("Driver assist", formatDriverAssist(vehicle.features)),
      detailItem("Equipment", formatFeatures(vehicle.features)),
      detailItem("Review tags", formatTextList(vehicle.reviewTags)),
      includeDescription ? detailItem("Description", getVehicleDescriptionForDisplay(vehicle)) : null
    ])
  };
}

export function vehicleDetailSectionId(prefix: string, heading: string) {
  return `${prefix}-${heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export function formatCondition(condition: VehicleCondition) {
  return condition === "new" ? "New" : "Used";
}

export function formatBodyType(bodyType: Vehicle["bodyType"]) {
  return bodyType.replace(/_/g, " ");
}

export function formatFeatures(features: Feature[]) {
  return formatTextList(features.map((feature) => featureLabels[feature] ?? feature.replace(/_/g, " ")));
}

export function formatDriverAssist(features: Feature[]) {
  const driverAssistFeatures = features.filter(
    (feature) =>
      feature === "adaptive_cruise_control" ||
      feature === "lane_keeping_assist" ||
      feature === "blind_spot_detection"
  );
  return formatFeatures(driverAssistFeatures);
}

function compactItems(items: Array<VehicleDetailItem | null>) {
  return items.filter((item): item is VehicleDetailItem => Boolean(item));
}

function detailItem(label: string, value: DetailValue): VehicleDetailItem | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  return { label, value: typeof value === "boolean" ? (value ? "Yes" : "No") : String(value) };
}

function differentFromGeneratedTitle(title: string | undefined, vehicle: Vehicle) {
  const generatedTitle = `${vehicle.make} ${vehicle.model}`.trim().toLowerCase();
  const cleanTitle = title?.trim();
  return cleanTitle && cleanTitle.toLowerCase() !== generatedTitle ? cleanTitle : undefined;
}

function formatPower(powerKw: number) {
  return `${formatNumber(powerKw)} kW`;
}

function formatBoolean(value: boolean | null | undefined) {
  if (value === null || value === undefined) return undefined;
  return value ? "Yes" : "No";
}

function formatSellerType(sellerType: VehicleSellerType | undefined) {
  if (!sellerType || sellerType === "unknown") return undefined;
  if (sellerType === "oem") return "OEM";
  return sellerType.charAt(0).toUpperCase() + sellerType.slice(1);
}

function formatSource(source: Vehicle["source"]) {
  const sourceLabels: Partial<Record<Vehicle["source"], string>> = {
    autoscout24_at: "AutoScout24 AT",
    bmw_boerse_at: "BMW Boerse AT",
    gebrauchtwagen_at: "Gebrauchtwagen AT",
    oem: "OEM",
    seed: "Curated inventory",
    vw_austria_ev_leasing: "VW Austria EV leasing",
    willhaben: "willhaben"
  };
  return sourceLabels[source] ?? source.replace(/_/g, " ");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatLooseDate(value: string | null | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-AT", {
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatTextList(values: string[]) {
  return values.length ? values.join(", ") : undefined;
}

function normalizeWarranty(warranty: string) {
  if (!warranty || warranty === "-1") return undefined;
  return warranty;
}
