import { describe, expect, it } from "vitest";
import { routeOrders } from "../src/router.ts";
import { at, created, input, warehouse } from "./fixtures.ts";

describe("rule 1: orders shipping outside the US go to PARTNER", () => {
  it("sends a non-US order to PARTNER even when its ZIP prefix is covered", () => {
    const result = routeOrders(
      input({
        warehouses: [warehouse("WH-NJ", { "SKU-X": [10, 1] })],
        zones: { "WH-NJ": { "100": 1 } },
        orders: [created("#1", at(0), "10001", [["SKU-X", 1]], "CA")],
      }),
    );

    expect(result.routes).toMatchObject([{ orderNumber: "#1", kind: "partner", reason: "INTERNATIONAL" }]);
  });
});

describe("rule 2: no ZIP, or a ZIP prefix not in zones, goes to PARTNER", () => {
  const warehouses = [warehouse("WH-NJ", { "SKU-X": [10, 1] })];
  const zones = { "WH-NJ": { "100": 1 } };

  it("sends an order with no ZIP to PARTNER", () => {
    const result = routeOrders(input({ warehouses, zones, orders: [created("#1", at(0), "", [["SKU-X", 1]])] }));

    expect(result.routes).toMatchObject([{ orderNumber: "#1", kind: "partner", reason: "NO_ZIP" }]);
  });

  it("sends an order whose ZIP prefix is not in zones to PARTNER", () => {
    const result = routeOrders(input({ warehouses, zones, orders: [created("#1", at(0), "96815", [["SKU-X", 1]])] }));

    expect(result.routes).toMatchObject([{ orderNumber: "#1", kind: "partner", reason: "ZIP_NOT_COVERED" }]);
  });
});

describe("rule 3: a warehouse must be enabled and have stock for every item", () => {
  it("skips a disabled warehouse even when it is the closest", () => {
    const result = routeOrders(
      input({
        warehouses: [warehouse("WH-NJ", { "SKU-X": [10, 1] }, false), warehouse("WH-GA", { "SKU-X": [10, 1] })],
        zones: { "WH-NJ": { "100": 1 }, "WH-GA": { "100": 2 } },
        orders: [created("#1", at(0), "10001", [["SKU-X", 1]])],
      }),
    );

    expect(result.routes).toMatchObject([{ orderNumber: "#1", kind: "warehouse", warehouse: "WH-GA", zone: 2 }]);
  });

  it("skips a closer warehouse that lacks one of the items instead of splitting the order", () => {
    const result = routeOrders(
      input({
        warehouses: [
          warehouse("WH-NJ", { "SKU-X": [10, 1], "SKU-Y": [0, 1] }),
          warehouse("WH-GA", { "SKU-X": [10, 1], "SKU-Y": [10, 1] }),
        ],
        zones: { "WH-NJ": { "100": 1 }, "WH-GA": { "100": 2 } },
        orders: [created("#1", at(0), "10001", [["SKU-X", 1], ["SKU-Y", 1]])],
      }),
    );

    expect(result.routes).toMatchObject([{ orderNumber: "#1", kind: "warehouse", warehouse: "WH-GA", zone: 2 }]);
  });
});

describe("rule 4: of the warehouses that can take it, pick the lowest zone", () => {
  it("picks the lowest zone even when the other warehouse has priority", () => {
    const result = routeOrders(
      input({
        warehouses: [warehouse("WH-NJ", { "SKU-X": [10, 1] }), warehouse("WH-GA", { "SKU-X": [10, 1] })],
        zones: { "WH-NJ": { "100": 2 }, "WH-GA": { "100": 1 } },
        orders: [created("#1", at(0), "10001", [["SKU-X", 1]])],
      }),
    );

    expect(result.routes).toMatchObject([{ orderNumber: "#1", kind: "warehouse", warehouse: "WH-GA", zone: 1 }]);
  });
});

describe("rule 5: on a zone tie, pick the most days of cover", () => {
  it("compares the smallest cover across the order's products", () => {
    // WH-NJ: X 100d, Y 1d -> 1d. WH-GA: X 5d, Y 5d -> 5d.
    const result = routeOrders(
      input({
        warehouses: [
          warehouse("WH-NJ", { "SKU-X": [100, 1], "SKU-Y": [1, 1] }),
          warehouse("WH-GA", { "SKU-X": [5, 1], "SKU-Y": [5, 1] }),
        ],
        zones: { "WH-NJ": { "100": 3 }, "WH-GA": { "100": 3 } },
        orders: [created("#1", at(0), "10001", [["SKU-X", 1], ["SKU-Y", 1]])],
      }),
    );

    expect(result.routes).toMatchObject([
      { orderNumber: "#1", kind: "warehouse", warehouse: "WH-GA", zone: 3, tieBreak: { rule: 5 } },
    ]);
  });
});

describe("rule 6: on a zone and cover tie, use the priority WH-NJ, WH-GA, WH-NV, WH-TX", () => {
  it("follows the priority list, not file order or alphabetical order", () => {
    const result = routeOrders(
      input({
        warehouses: [warehouse("WH-GA", { "SKU-X": [10, 1] }), warehouse("WH-NJ", { "SKU-X": [10, 1] })],
        zones: { "WH-GA": { "100": 3 }, "WH-NJ": { "100": 3 } },
        orders: [created("#1", at(0), "10001", [["SKU-X", 1]])],
      }),
    );

    expect(result.routes).toMatchObject([
      { orderNumber: "#1", kind: "warehouse", warehouse: "WH-NJ", zone: 3, tieBreak: { rule: 6 } },
    ]);
  });
});

describe("rule 7: if no warehouse can take it, it goes to PARTNER", () => {
  it("sends an order that no warehouse can fill to PARTNER", () => {
    const result = routeOrders(
      input({
        warehouses: [warehouse("WH-NJ", { "SKU-X": [1, 1] }), warehouse("WH-GA", { "SKU-X": [2, 1] })],
        zones: { "WH-NJ": { "100": 1 }, "WH-GA": { "100": 2 } },
        orders: [created("#1", at(0), "10001", [["SKU-X", 3]])],
      }),
    );

    expect(result.routes).toMatchObject([{ orderNumber: "#1", kind: "partner", reason: "NO_WAREHOUSE" }]);
  });
});
