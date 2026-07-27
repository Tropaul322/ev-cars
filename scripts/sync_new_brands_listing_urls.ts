import fs from "node:fs";
import path from "node:path";

import { readNewBrandsListingUrlsFromXlsx } from "../lib/inventory/new-brands-xlsx.ts";
import { mergeListingUrlsIntoSheetCsv } from "../lib/inventory/vehicles-sheet-import.ts";
import { patchVehicleListingUrls } from "../lib/repositories/vehicle-listing-url-patch.ts";

type Options = {
  xlsxPath: string;
  importsDir: string;
  allBrandsCsvPaths: string[];
  dryRun: boolean;
  applyDb: boolean;
  skipCsv: boolean;
};

const root = process.cwd();
loadEnv(path.join(root, ".env.local"));

const options = parseArgs(process.argv.slice(2));
const listingUrlsById = readNewBrandsListingUrlsFromXlsx(options.xlsxPath);

console.log(`Loaded ${listingUrlsById.size} listing URL(s) from ${options.xlsxPath}`);

if (!options.skipCsv) {
  const csvTargets = [
    ...options.allBrandsCsvPaths,
    ...fs
      .readdirSync(options.importsDir)
      .filter((name) => name.endsWith(".csv"))
      .map((name) => path.join(options.importsDir, name))
  ];

  const uniqueTargets = [...new Set(csvTargets.map((target) => path.resolve(target)))].filter((target) =>
    fs.existsSync(target)
  );

  for (const csvPath of uniqueTargets) {
    const original = fs.readFileSync(csvPath, "utf8");
    const updated = mergeListingUrlsIntoSheetCsv(original, listingUrlsById);
    if (updated === original) {
      console.log(`CSV unchanged: ${csvPath}`);
      continue;
    }

    if (options.dryRun) {
      console.log(`CSV would update: ${csvPath}`);
      continue;
    }

    fs.writeFileSync(csvPath, updated, "utf8");
    console.log(`CSV updated: ${csvPath}`);
  }
}

if (options.applyDb) {
  const result = await patchVehicleListingUrls(listingUrlsById, { dryRun: options.dryRun });
  console.log(
    `DB patch: requested=${result.requested}, updated=${result.updated}, missing=${result.missing.length}, skipped=${result.skipped.length}`
  );
  if (result.missing.length > 0) {
    console.log(`Missing vehicle ids (not inserted): ${result.missing.join(", ")}`);
  }
  if (result.errors.length > 0) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  }
} else {
  console.log("Skipped DB patch (pass --apply-db to merge listingUrl into existing vehicles only).");
}

function parseArgs(args: string[]): Options {
  const xlsxPath = path.join(root, "data", "1", "vehicles-sheet_new brands .xlsx");
  const optionsValue: Options = {
    xlsxPath,
    importsDir: path.join(root, "data", "imports", "new-brands"),
    allBrandsCsvPaths: [
      path.join(root, "data", "imports", "new-brands", "all-new-brands.csv"),
      path.join(root, "data", "1", "all-new-brands.csv")
    ],
    dryRun: false,
    applyDb: false,
    skipCsv: false
  };

  for (const arg of args) {
    if (arg === "--dry-run") optionsValue.dryRun = true;
    else if (arg === "--apply-db") optionsValue.applyDb = true;
    else if (arg === "--skip-csv") optionsValue.skipCsv = true;
    else if (arg.startsWith("--xlsx=")) optionsValue.xlsxPath = path.resolve(arg.slice("--xlsx=".length));
    else if (arg.startsWith("--imports-dir=")) {
      optionsValue.importsDir = path.resolve(arg.slice("--imports-dir=".length));
    }
  }

  if (!fs.existsSync(optionsValue.xlsxPath)) {
    throw new Error(`XLSX file not found: ${optionsValue.xlsxPath}`);
  }

  return optionsValue;
}

function loadEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    process.env[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }
}
