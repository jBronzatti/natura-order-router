import { describe, expect, it } from "vitest";
import { routeOrders } from "../src/router.ts";
import { at, created, input, routeOf, warehouse } from "./fixtures.ts";

// BNDL-XY = SKU-X x1 + SKU-Y x1 (see fixtures). No warehouse stocks the bundle SKU itself.
describe("bundles are expanded into their components (D-02)", () => {
  const zones = { "WH-NJ": { "100": 1 }, "WH-GA": { "100": 2 } };

  it("routes a bundle to a warehouse that stocks its components", () => {
    const result = routeOrders(
      input({
        warehouses: [warehouse("WH-NJ", { "SKU-X": [5, 1], "SKU-Y": [5, 1] })],
        zones,
        orders: [created("#1", at(0), "10001", [["BNDL-XY", 1]])],
      }),
    );

    expect(result.routes).toMatchObject([{ orderNumber: "#1", kind: "warehouse", warehouse: "WH-NJ", zone: 1 }]);
  });

  it("multiplies component quantities by the bundle quantity", () => {
    const result = routeOrders(
      input({
        warehouses: [
          warehouse("WH-NJ", { "SKU-X": [1, 1], "SKU-Y": [5, 1] }),
          warehouse("WH-GA", { "SKU-X": [2, 1], "SKU-Y": [2, 1] }),
        ],
        zones,
        orders: [created("#1", at(0), "10001", [["BNDL-XY", 2]])],
      }),
    );

    expect(result.routes).toMatchObject([{ orderNumber: "#1", kind: "warehouse", warehouse: "WH-GA", zone: 2 }]);
  });

  it("reserves the component stock, so later orders see less", () => {
    const result = routeOrders(
      input({
        warehouses: [
          warehouse("WH-NJ", { "SKU-X": [1, 1], "SKU-Y": [1, 1] }),
          warehouse("WH-GA", { "SKU-X": [5, 1], "SKU-Y": [5, 1] }),
        ],
        zones,
        orders: [created("#1", at(0), "10001", [["BNDL-XY", 1]]), created("#2", at(1), "10001", [["SKU-X", 1]])],
      }),
    );

    expect(routeOf(result, "#1")).toMatchObject({ kind: "warehouse", warehouse: "WH-NJ" });
    expect(routeOf(result, "#2")).toMatchObject({ kind: "warehouse", warehouse: "WH-GA" });
  });
});
