import fs from "node:fs";
import path from "node:path";
import {
  parseVehicleSheetCsv,
  vehiclesToSupabaseCsv
} from "../lib/inventory/vehicles-sheet-import.ts";

const root = process.cwd();
const options = parseArgs(process.argv.slice(2));
const csvContent = fs.readFileSync(options.inputPath, "utf8");
const vehicles = parseVehicleSheetCsv(csvContent);

fs.writeFileSync(options.outputPath, vehiclesToSupabaseCsv(vehicles), "utf8");

console.log(`Converted ${vehicles.length} vehicle(s)`);
console.log(`Input:  ${options.inputPath}`);
console.log(`Output: ${options.outputPath}`);

function parseArgs(args: string[]) {
  const inputPath = path.join(root, "data", "templates", "vehicles-sheet-template.csv");
  const outputPath = path.join(root, "data", "templates", "vehicles-supabase-import-template.csv");
  const optionsValue = { inputPath, outputPath };

  for (const arg of args) {
    if (arg.startsWith("--input=")) {
      optionsValue.inputPath = path.resolve(root, arg.slice("--input=".length));
    } else if (arg.startsWith("--output=")) {
      optionsValue.outputPath = path.resolve(root, arg.slice("--output=".length));
    }
  }

  if (!fs.existsSync(optionsValue.inputPath)) {
    throw new Error(`Input file not found: ${optionsValue.inputPath}`);
  }

  return optionsValue;
}
