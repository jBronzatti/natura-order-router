import type { RawInput, Route, RoutingResult } from "../src/types.ts";

const BASE_TIME = Date.parse("2026-10-20T13:00:00.000Z");

export function at(minutes: number, seconds = 0): string {
  return new Date(BASE_TIME + (minutes * 60 + seconds) * 1000).toISOString();
}

type Stock = Record<string, [available: number, dailyVelocity: number]>;
type Line = [sku: string, quantity: number];

export function warehouse(code: string, stock: Stock, enabled = true) {
  const inventory = Object.fromEntries(
    Object.entries(stock).map(([sku, [available, dailyVelocity]]) => [sku, { available, dailyVelocity }]),
  );
  return { code, city: "Test City", enabled, inventory };
}

const toLines = (lines: Line[]) => lines.map(([sku, quantity]) => ({ sku, quantity }));

export function created(orderNumber: string, when: string, zip: unknown, lines: Line[], country = "US") {
  return { type: "order_created", orderNumber, at: when, shipTo: { country, state: "XX", zip }, lines: toLines(lines) };
}

export function edited(orderNumber: string, when: string, lines: Line[]) {
  return { type: "order_edited", orderNumber, at: when, addedLines: toLines(lines) };
}

export const catalog = {
  products: [
    { sku: "SKU-X", name: "Product X", priceCents: 1000 },
    { sku: "SKU-Y", name: "Product Y", priceCents: 2000 },
  ],
  bundles: [
    {
      sku: "BNDL-XY",
      name: "X and Y bundle",
      priceCents: 2500,
      components: [
        { sku: "SKU-X", quantity: 1 },
        { sku: "SKU-Y", quantity: 1 },
      ],
    },
  ],
};

export function input(parts: { warehouses: unknown[]; zones: Record<string, Record<string, number>>; orders: unknown[] }): RawInput {
  return { catalog, ...parts };
}

export function routeOf(result: RoutingResult, orderNumber: string): Route | undefined {
  return result.routes.find((route) => route.orderNumber === orderNumber);
}
