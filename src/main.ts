import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RoutingStopped } from "./errors.ts";
import { formatRoutes } from "./format.ts";
import { routeOrders } from "./router.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTES_FILE = join(REPO_ROOT, "routes.txt");

// A BOM is an encoding marker, not data; RFC 8259 lets parsers ignore it.
function readJson(dataDir: string, name: string): unknown {
  const path = join(dataDir, `${name}.json`);
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new RoutingStopped(`${path} can't be read: ${(error as Error).message}`);
  }
}

function printWarnings(warnings: readonly string[]): void {
  for (const warning of warnings) console.error(`warning: ${warning}`);
}

function main(): void {
  // Deleted before reading anything, so a stop or a crash can't leave stale routes that look current.
  rmSync(ROUTES_FILE, { force: true });
  const dataDir = resolve(process.argv[2] ?? join(REPO_ROOT, "data"));
  const { routes, warnings } = routeOrders({
    orders: readJson(dataDir, "orders"),
    warehouses: readJson(dataDir, "warehouses"),
    zones: readJson(dataDir, "zones"),
    catalog: readJson(dataDir, "catalog"),
  });

  printWarnings(warnings);
  const output = formatRoutes(routes).map((line) => `${line}\n`).join("");
  process.stdout.write(output);
  writeFileSync(ROUTES_FILE, output);
}

try {
  main();
} catch (error) {
  if (!(error instanceof RoutingStopped)) throw error;
  printWarnings(error.warnings);
  console.error(`routing stopped: ${error.message}`);
  process.exitCode = 1;
}
