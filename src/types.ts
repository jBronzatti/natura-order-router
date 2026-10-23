export type ReasonCode =
  | "INTERNATIONAL"
  | "NO_COUNTRY"
  | "NO_ZIP"
  | "ZIP_NOT_COVERED"
  | "UNKNOWN_SKU"
  | "INVALID_CATALOG_ITEM"
  | "INVALID_ORDER"
  | "NO_WAREHOUSE";

export interface CoverEntry {
  warehouse: string;
  cover: number;
}

// Ranking lists the tied warehouses in the order they ranked, winner first.
export interface TieBreak {
  rule: 5 | 6;
  ranking: CoverEntry[];
}

export type Route =
  | { kind: "warehouse"; orderNumber: string; warehouse: string; zone: number; tieBreak?: TieBreak }
  | { kind: "partner"; orderNumber: string; reason: ReasonCode; detail: string };

// Parsed JSON exactly as read from disk; validation happens inside the router (D-00).
export interface RawInput {
  orders: unknown;
  warehouses: unknown;
  zones: unknown;
  catalog: unknown;
}

export interface RoutingResult {
  routes: Route[];
  warnings: string[];
}

export type Warn = (message: string) => void;

export interface OrderLine {
  sku: string;
  quantity: number;
}

// Physical SKU -> total quantity, after bundles are expanded.
export type Items = ReadonlyMap<string, number>;
