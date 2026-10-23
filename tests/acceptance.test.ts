import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatRoutes } from "../src/format.ts";
import { routeOrders } from "../src/router.ts";

const readData = (name: string): unknown => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), "utf8"));

// The golden file was checked line by line against the hand-worked table in docs/implementation-plan.md §3.
// If this fails, find out whether the code or the table is wrong before touching the golden file.
describe("acceptance: today's data (ACC-1)", () => {
  const result = routeOrders({
    orders: readData("orders"),
    warehouses: readData("warehouses"),
    zones: readData("zones"),
    catalog: readData("catalog"),
  });

  it("produces exactly the hand-verified routes", () => {
    const golden = readFileSync(new URL("./golden/routes.txt", import.meta.url), "utf8");

    expect(`${formatRoutes(result.routes).join("\n")}\n`).toBe(golden);
  });

  it("raises no warnings", () => {
    expect(result.warnings).toEqual([]);
  });
});
