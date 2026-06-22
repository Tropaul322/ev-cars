import type { Vehicle } from "../types.ts";

const ARRAY_COLUMNS = new Set(["features", "images", "reviewTags"]);
const INTEGER_COLUMNS = new Set([
  "year",
  "priceEUR",
  "monthlyLeaseEUR",
  "mileageKm",
  "rangeKm",
  "batteryKwh",
  "seats",
  "cargoLiters",
  "powerKw",
  "leaseDurationMonths",
  "doors"
]);
const FLOAT_COLUMNS = new Set(["efficiencyKwhPer100Km", "batterySoH"]);
const BOOLEAN_COLUMNS = new Set(["available", "leasingEligible", "vatDeductible"]);

export function parseVehicleSheetCsv(content: string): Vehicle[] {
  const rows = parseCsv(content.trim());
  if (rows.length === 0) return [];

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((header) => header.trim());

  return dataRows
    .filter((row) => row.some((value) => value.trim().length > 0))
    .map((row, index) => {
      const record = Object.fromEntries(headers.map((header, columnIndex) => [header, row[columnIndex] ?? ""]));
      const id = record.id?.trim();
      if (!id) throw new Error(`Row ${index + 2} is missing id.`);

      const payload = sheetRecordToVehicle(record);
      return { ...payload, id };
    });
}

export function vehiclesToSupabaseCsv(vehicles: Vehicle[]): string {
  const lines = ["id,payload"];
  for (const vehicle of vehicles) {
    const payload = JSON.stringify(vehicle);
    lines.push(`${csvEscape(vehicle.id)},${csvEscape(payload)}`);
  }
  return `${lines.join("\n")}\n`;
}

function sheetRecordToVehicle(record: Record<string, string>): Vehicle {
  const payload: Record<string, unknown> = {};

  for (const [key, rawValue] of Object.entries(record)) {
    if (key === "id") continue;
    const value = rawValue.trim();
    if (!value) continue;

    if (ARRAY_COLUMNS.has(key)) {
      payload[key] = value
        .split("|")
        .map((item) => item.trim())
        .filter(Boolean);
      continue;
    }

    if (BOOLEAN_COLUMNS.has(key)) {
      payload[key] = value.toLowerCase() === "true";
      continue;
    }

    if (INTEGER_COLUMNS.has(key)) {
      payload[key] = Number.parseInt(value, 10);
      continue;
    }

    if (FLOAT_COLUMNS.has(key)) {
      payload[key] = Number.parseFloat(value);
      continue;
    }

    payload[key] = value;
  }

  if (!payload.warranty) {
    payload.warranty =
      payload.condition === "new"
        ? "New listing; verify factory and battery warranty with seller."
        : "Used listing; verify remaining battery warranty and battery state-of-health with seller.";
  }

  if (!payload.notes) payload.notes = "Imported from spreadsheet.";
  if (!payload.reviewTags) payload.reviewTags = ["imported"];
  if (!payload.features) payload.features = [];
  if (!payload.images) payload.images = [];
  if (payload.chargingCycles === undefined) payload.chargingCycles = null;

  return payload as Vehicle;
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (char === "\r") continue;
    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function csvEscape(value: string) {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
