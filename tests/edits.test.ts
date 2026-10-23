import { describe, expect, it } from "vitest";
import { routeOrders } from "../src/router.ts";
import { at, created, edited, input, warehouse } from "./fixtures.ts";

// WH-NJ is closer but has no SKU-Y, so an order that gains SKU-Y must go to WH-GA.
describe("order edits within 30 minutes are part of the order (D-04, D-14)", () => {
  const warehouses = [
    warehouse("WH-NJ", { "SKU-X": [10, 1] }),
    warehouse("WH-GA", { "SKU-X": [10, 1], "SKU-Y": [10, 1] }),
  ];
  const zones = { "WH-NJ": { "100": 1 }, "WH-GA": { "100": 2 } };

  const routeWithEditAt = (when: string) =>
    routeOrders(
      input({
        warehouses,
        zones,
        orders: [created("#1", at(0), "10001", [["SKU-X", 1]]), edited("#1", when, [["SKU-Y", 1]])],
      }),
    );

  it("routes the order once, with the added lines", () => {
    const result = routeWithEditAt(at(10));

    expect(result.routes).toHaveLength(1);
    expect(result.routes).toMatchObject([{ orderNumber: "#1", kind: "warehouse", warehouse: "WH-GA" }]);
  });

  it("includes an edit made exactly 30 minutes after the order", () => {
    const result = routeWithEditAt(at(30));

    expect(result.routes).toMatchObject([{ orderNumber: "#1", kind: "warehouse", warehouse: "WH-GA" }]);
  });

  it("ignores an edit made after the 30-minute window, with a warning", () => {
    const result = routeWithEditAt(at(30, 1));

    expect(result.routes).toMatchObject([{ orderNumber: "#1", kind: "warehouse", warehouse: "WH-NJ" }]);
    expect(result.warnings).not.toHaveLength(0);
  });
});
