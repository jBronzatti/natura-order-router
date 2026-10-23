import { describe, expect, it } from "vitest";
import { routeOrders } from "../src/router.ts";
import { created, input, warehouse } from "./fixtures.ts";

// Each rejected case was routed to a warehouse by the old plain Date.parse, whatever the machine's timezone.
describe("F-11: timestamps need an offset and a real calendar date", () => {
  const route = (when: string) =>
    routeOrders(
      input({
        warehouses: [warehouse("WH-NJ", { "SKU-X": [10, 1] })],
        zones: { "WH-NJ": { "100": 1 } },
        orders: [created("#1", when, "10001", [["SKU-X", 1]])],
      }),
    ).routes[0];

  it.each([
    ["no offset", "2026-10-20T13:00:00"],
    ["Feb 30", "2026-02-30T13:00:00Z"],
    ["Feb 29 outside a leap year", "2026-02-29T13:00:00Z"],
    ["24:00", "2026-10-20T24:00:00Z"],
  ])("treats a creation time with %s as unreadable", (_case, when) => {
    expect(route(when)).toMatchObject({ kind: "partner", reason: "INVALID_ORDER", detail: "unreadable creation time" });
  });

  it.each([
    ["an offset that crosses into the previous UTC day", "2026-03-01T01:00:00+05:00"],
    ["Feb 29 in a leap year", "2028-02-29T13:00:00Z"],
  ])("accepts %s", (_case, when) => {
    expect(route(when)).toMatchObject({ kind: "warehouse", warehouse: "WH-NJ" });
  });
});
