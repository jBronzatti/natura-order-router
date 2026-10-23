import { describe, expect, it } from "vitest";
import { routeOrders } from "../src/router.ts";
import { at, created, edited, input, warehouse } from "./fixtures.ts";

// WH-NJ is closest but holds a single unit of SKU-X; whoever is routed first gets it.
describe("orders are routed in creation order and each one reserves its stock", () => {
  const warehouses = [
    warehouse("WH-NJ", { "SKU-X": [1, 1], "SKU-Y": [10, 1] }),
    warehouse("WH-GA", { "SKU-X": [10, 1], "SKU-Y": [10, 1] }),
  ];
  const zones = { "WH-NJ": { "100": 1 }, "WH-GA": { "100": 2 } };

  it("lets a routed order's reservation push the next order to another warehouse", () => {
    const result = routeOrders(
      input({
        warehouses,
        zones,
        orders: [created("#1", at(0), "10001", [["SKU-X", 1]]), created("#2", at(1), "10001", [["SKU-X", 1]])],
      }),
    );

    expect(result.routes).toMatchObject([
      { orderNumber: "#1", kind: "warehouse", warehouse: "WH-NJ" },
      { orderNumber: "#2", kind: "warehouse", warehouse: "WH-GA" },
    ]);
  });

  it("routes by creation time, not by position in the file", () => {
    const result = routeOrders(
      input({
        warehouses,
        zones,
        orders: [created("#late", at(5), "10001", [["SKU-X", 1]]), created("#early", at(0), "10001", [["SKU-X", 1]])],
      }),
    );

    expect(result.routes).toMatchObject([
      { orderNumber: "#early", kind: "warehouse", warehouse: "WH-NJ" },
      { orderNumber: "#late", kind: "warehouse", warehouse: "WH-GA" },
    ]);
  });

  it("keeps an edited order in its creation slot, ahead of orders created after it", () => {
    // #P is created first and gains SKU-X in an edit after #Q was created.
    const result = routeOrders(
      input({
        warehouses,
        zones,
        orders: [
          created("#P", at(0), "10001", [["SKU-Y", 1]]),
          created("#Q", at(5), "10001", [["SKU-X", 1]]),
          edited("#P", at(10), [["SKU-X", 1]]),
        ],
      }),
    );

    expect(result.routes).toMatchObject([
      { orderNumber: "#P", kind: "warehouse", warehouse: "WH-NJ" },
      { orderNumber: "#Q", kind: "warehouse", warehouse: "WH-GA" },
    ]);
  });
});
