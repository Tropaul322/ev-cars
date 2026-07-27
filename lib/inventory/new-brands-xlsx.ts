import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { Cheerio } from "cheerio";
import { load } from "cheerio";
import type { Element } from "domhandler";

import { extractFirstListingUrl } from "./vehicles-sheet-import.ts";

const OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const VEHICLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

export const NEW_BRANDS_SHEET_TO_CSV: Record<string, string> = {
  AION: "aion.csv",
  KGM: "kgm.csv",
  NIO: "nio.csv",
  Polestar: "polestar.csv",
  Lucid: "lucid.csv",
  Leapmotor: "leapmotor.csv",
  XPENG: "xpeng.csv",
  BYD: "byd.csv"
};

export type ListingUrlByVehicleId = Map<string, string>;

type SheetRowValues = Record<string, string>;
type SheetRows = Map<number, SheetRowValues>;

export function readNewBrandsListingUrlsFromXlsx(xlsxPath: string): ListingUrlByVehicleId {
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`XLSX file not found: ${xlsxPath}`);
  }

  const sharedStrings = readSharedStrings(xlsxPath);
  const sheetTargets = readWorkbookSheetTargets(xlsxPath);
  const listingUrls: ListingUrlByVehicleId = new Map();

  for (const [sheetName, sheetPath] of sheetTargets) {
    if (sheetName === "Template" || !(sheetName in NEW_BRANDS_SHEET_TO_CSV)) continue;
    const sheetXml = readZipEntry(xlsxPath, sheetPath);
    const rows = parseSheetListingUrls(sheetXml, sharedStrings);
    for (const [vehicleId, listingUrl] of rows) {
      listingUrls.set(vehicleId, listingUrl);
    }
  }

  return listingUrls;
}

export function vehicleToBildquelleModelLabel(make: string, model: string, trim: string): string {
  const normalizedMake = make.trim();
  const normalizedModel = model.trim();
  const normalizedTrim = trim.trim();

  if (normalizedMake === "BYD" || normalizedMake === "Leapmotor" || normalizedMake === "XPENG") {
    return normalizedModel;
  }

  if (normalizedMake === "Lucid") {
    if (normalizedModel === "Air" && normalizedTrim === "Sapphire") return "Lucid Air Sapphire";
    if (normalizedModel === "Air") return "Lucid Air";
    if (normalizedModel === "Gravity") return "Lucid Gravity";
  }

  if (normalizedMake === "Polestar") return `Polestar ${normalizedModel}`;
  if (normalizedMake === "KGM" || normalizedMake === "NIO" || normalizedMake === "AION") {
    return `${normalizedMake} ${normalizedModel}`;
  }

  return `${normalizedMake} ${normalizedModel}`.trim();
}

function readZipEntry(xlsxPath: string, entryPath: string): string {
  try {
    return execFileSync("unzip", ["-p", xlsxPath, entryPath], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${entryPath} from ${xlsxPath}: ${message}`);
  }
}

function readSharedStrings(xlsxPath: string): string[] {
  const xml = readZipEntry(xlsxPath, "xl/sharedStrings.xml");
  const $ = load(xml, { xml: true });

  return $("si")
    .toArray()
    .map((element) => {
      const node = $(element);
      const richText = node
        .find("t")
        .toArray()
        .map((part) => $(part).text())
        .join("");
      return richText || node.find("t").first().text();
    });
}

function readWorkbookSheetTargets(xlsxPath: string): Array<[string, string]> {
  const workbookXml = readZipEntry(xlsxPath, "xl/workbook.xml");
  const relsXml = readZipEntry(xlsxPath, "xl/_rels/workbook.xml.rels");
  const workbook = load(workbookXml, { xml: true });
  const rels = load(relsXml, { xml: true });

  const relMap = new Map<string, string>();
  rels("Relationship").each((_index, element) => {
    const node = rels(element);
    const id = node.attr("Id");
    const target = node.attr("Target");
    if (!id || !target) return;
    const normalized = target.replace(/^\//, "");
    relMap.set(id, normalized.startsWith("xl/") ? normalized : `xl/${normalized}`);
  });

  const targets: Array<[string, string]> = [];
  workbook("sheet").each((_index, element) => {
    const node = workbook(element);
    const name = node.attr("name");
    const relId = node.attr("r:id") ?? node.attr(`${OFFICE_REL_NS}:id`) ?? node.attr("id");
    if (!name || !relId) return;
    const target = relMap.get(relId);
    if (target) targets.push([name, target]);
  });

  return targets;
}

function parseSheetListingUrls(sheetXml: string, sharedStrings: string[]): ListingUrlByVehicleId {
  const rows = readSheetRows(sheetXml, sharedStrings);
  const bildquelleHeaderRow = findBildquelleHeaderRow(rows);
  const bildquelleUrls = bildquelleHeaderRow === null ? new Map<string, string>() : buildBildquelleUrlByModel(rows, bildquelleHeaderRow);
  const listingUrls: ListingUrlByVehicleId = new Map();
  const lastVehicleRow = bildquelleHeaderRow ?? Number.MAX_SAFE_INTEGER;

  for (const [rowNumber, values] of rows) {
    if (rowNumber <= 1 || rowNumber >= lastVehicleRow) continue;

    const vehicleId = values.A?.trim() ?? "";
    if (!VEHICLE_ID_PATTERN.test(vehicleId)) continue;

    const listingUrl =
      extractFirstListingUrl(values.Z ?? "") ??
      bildquelleUrls.get(vehicleToBildquelleModelLabel(values.B ?? "", values.C ?? "", values.D ?? ""));

    if (listingUrl) listingUrls.set(vehicleId, listingUrl);
  }

  return listingUrls;
}

function readSheetRows(sheetXml: string, sharedStrings: string[]): SheetRows {
  const $ = load(sheetXml, { xml: true });
  const rows: SheetRows = new Map();

  $("row").each((_index, element) => {
    const row = $(element);
    const rowNumber = Number(row.attr("r") ?? 0);
    if (rowNumber <= 0) return;

    const values: SheetRowValues = {};
    row.find("c").each((_cellIndex, cellElement) => {
      const cell = $(cellElement);
      const ref = cell.attr("r") ?? "";
      const column = ref.replace(/\d+$/, "");
      values[column] = readCellValue(cell, sharedStrings);
    });

    rows.set(rowNumber, values);
  });

  return rows;
}

function findBildquelleHeaderRow(rows: SheetRows): number | null {
  for (const [rowNumber, values] of rows) {
    if (values.A?.trim() === "Modell" && values.C?.trim() === "Bildquelle") {
      return rowNumber;
    }
  }
  return null;
}

function buildBildquelleUrlByModel(rows: SheetRows, headerRow: number): Map<string, string> {
  const grouped = new Map<string, Array<{ view: string; url: string }>>();

  for (const [rowNumber, values] of rows) {
    if (rowNumber <= headerRow) continue;

    const model = values.A?.trim() ?? "";
    const view = values.B?.trim() ?? "";
    const url = extractFirstListingUrl(values.C ?? "");
    if (!model || !url) continue;

    const entries = grouped.get(model) ?? [];
    entries.push({ view, url });
    grouped.set(model, entries);
  }

  const result = new Map<string, string>();
  for (const [model, entries] of grouped) {
    const preferred =
      entries.find((entry) => /3\/4\s*front/i.test(entry.view)) ??
      entries.find((entry) => /front/i.test(entry.view)) ??
      entries[0];
    if (preferred) result.set(model, preferred.url);
  }

  return result;
}

function readCellValue(cell: Cheerio<Element>, sharedStrings: string[]): string {
  const type = cell.attr("t");
  const rawValue = cell.find("v").first().text();
  if (!rawValue) return "";

  if (type === "s") {
    const index = Number.parseInt(rawValue, 10);
    return sharedStrings[index] ?? "";
  }

  return rawValue;
}
