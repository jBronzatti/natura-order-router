import { describe, expect, it } from "vitest";
import { routeOrders } from "../src/router.ts";
import { at, created, edited, input, warehouse } from "./fixtures.ts";

// "021" is in zones on purpose: padding the number 2134 would wrongly match it.
describe("D-01: the ZIP prefix is the first 3 characters, never repaired", () => {
  const route = (zip: unknown) =>
    routeOrders(
      input({
        warehouses: [warehouse("WH-NJ", { "SKU-X": [10, 1] })],
        zones: { "WH-NJ": { "100": 1, "021": 1 } },
        orders: [created("#1", at(0), zip, [["SKU-X", 1]])],
      }),
    ).routes[0];

  it.each([["10001"], ["10001-1234"], [" 10001 "], [10001]])("routes ZIP %j with prefix 100", (zip) => {
    expect(route(zip)).toMatchObject({ kind: "warehouse", warehouse: "WH-NJ", zone: 1 });
  });

  it("does not pad a numeric ZIP that lost its leading zero", () => {
    expect(route(2134)).toMatchObject({ kind: "partner", reason: "ZIP_NOT_COVERED", detail: "prefix 213" });
  });

  it.each([[undefined], [null], [""], ["   "], [[100]], [{}], [true]])("treats ZIP %j as no ZIP", (zip) => {
    expect(route(zip)).toMatchObject({ kind: "partner", reason: "NO_ZIP" });
  });
});

describe("D-03: identifiers are trimmed and upper-cased everywhere", () => {
  const zones = { "WH-NJ": { "100": 1 }, "WH-GA": { "100": 2 } };

  it.each([["sku-x"], [" SKU-X "], ["Sku-X"]])("matches order SKU %j to SKU-X", (sku) => {
    const result = routeOrders(
      input({ warehouses: [warehouse("WH-NJ", { "SKU-X": [10, 1] })], zones, orders: [created("#1", at(0), "10001", [[sku, 1]])] }),
    );

    expect(result.routes).toMatchObject([{ kind: "warehouse", warehouse: "WH-NJ" }]);
  });

  it("matches an inventory key written in a different case", () => {
    const result = routeOrders(
      input({ warehouses: [warehouse("WH-NJ", { " sku-x": [10, 1] })], zones, orders: [created("#1", at(0), "10001", [["SKU-X", 1]])] }),
    );

    expect(result.routes).toMatchObject([{ kind: "warehouse", warehouse: "WH-NJ" }]);
  });

  it("normalizes SKUs in edit lines too", () => {
    const result = routeOrders(
      input({
        warehouses: [warehouse("WH-NJ", { "SKU-X": [10, 1] }), warehouse("WH-GA", { "SKU-X": [10, 1], "SKU-Y": [10, 1] })],
        zones,
        orders: [created("#1", at(0), "10001", [["SKU-X", 1]]), edited("#1", at(5), [["sku-y", 1]])],
      }),
    );

    expect(result.routes).toMatchObject([{ kind: "warehouse", warehouse: "WH-GA" }]);
  });

  it.each([["us"], [" US "], ["usa"], ["United States"]])("treats country %j as the US", (country) => {
    const result = routeOrders(
      input({
        warehouses: [warehouse("WH-NJ", { "SKU-X": [10, 1] })],
        zones,
        orders: [created("#1", at(0), "10001", [["SKU-X", 1]], country)],
      }),
    );

    expect(result.routes).toMatchObject([{ kind: "warehouse", warehouse: "WH-NJ" }]);
  });
});
