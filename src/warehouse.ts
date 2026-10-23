import type { Items } from "./types.ts";

export interface StockLine {
  available: number;
  readonly dailyVelocity: number;
}

export class Warehouse {
  constructor(
    readonly code: string,
    readonly enabled: boolean,
    private readonly zones: ReadonlyMap<string, number>,
    private readonly stock: Map<string, StockLine>,
  ) {}

  zoneFor(prefix: string): number | undefined {
    return this.zones.get(prefix);
  }

  hasZones(): boolean {
    return this.zones.size > 0;
  }

  canFill(items: Items): boolean {
    return this.enabled && [...items].every(([sku, quantity]) => this.line(sku).available >= quantity);
  }

  // Rule 5: the order's cover is the smallest available ÷ velocity among its products.
  // Velocity 0 gives Infinity, which is the intended meaning (D-11).
  coverFor(items: Items): number {
    return Math.min(...[...items.keys()].map((sku) => this.line(sku).available / this.line(sku).dailyVelocity));
  }

  // Only called after canFill, so every line exists.
  reserve(items: Items): void {
    for (const [sku, quantity] of items) this.line(sku).available -= quantity;
  }

  private line(sku: string): StockLine {
    return this.stock.get(sku) ?? { available: 0, dailyVelocity: 0 };
  }
}
