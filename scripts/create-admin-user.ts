import fs from "node:fs";
import path from "node:path";
import { createAdminUser } from "../lib/repositories/admin-user-repository.ts";

const root = process.cwd();
const env = loadEnv(path.join(root, ".env.local"));
for (const [key, value] of Object.entries(env)) {
  if (typeof value === "string") process.env[key] = value;
}

const options = parseArgs(process.argv.slice(2));

if (!options.email || !options.password) {
  console.error("Usage: npm run admin:create -- --email admin@example.com --password 'your-password' [--name 'Admin Name']");
  process.exit(1);
}

try {
  const user = await createAdminUser({
    email: options.email,
    password: options.password,
    name: options.name
  });
  console.log(`Created admin user: ${user.email} (${user.id})`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Failed to create admin user.");
  process.exit(1);
}

function parseArgs(args: string[]) {
  const options: { email?: string; password?: string; name?: string } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--email") options.email = args[index + 1];
    else if (arg === "--password") options.password = args[index + 1];
    else if (arg === "--name") options.name = args[index + 1];
    else if (arg.startsWith("--email=")) options.email = arg.slice("--email=".length);
    else if (arg.startsWith("--password=")) options.password = arg.slice("--password=".length);
    else if (arg.startsWith("--name=")) options.name = arg.slice("--name=".length);
  }

  return options;
}

function loadEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return process.env;
  const values: Record<string, string> = { ...process.env } as Record<string, string>;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    values[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }

  return values;
}
