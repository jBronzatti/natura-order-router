import { dedupe } from "./dedupe.ts";
import { RoutingStopped } from "./errors.ts";
import { isNonNegativeFinite, isNonNegativeInteger, isPositiveInteger, isRecord } from "./guards.ts";
import { canonicalId } from "./normalize.ts";
import type { Items, Warn } from "./types.ts";
import { Warehouse, type StockLine } from "./warehouse.ts";

const PRIORITY = ["WH-NJ", "WH-GA", "WH-NV", "WH-TX"];
const PREFIX = /^\d{3}$/;

export interface Candidate {
  warehouse: Warehouse;
  zone: number;
}

interface RawWarehouse {
  code: string;
  entry: Record<string, unknown>;
}

// Warehouses kept in rule-6 priority order, so a stable sort by cover preserves the priority on ties.
export class Network {
  constructor(private readonly warehouses: readonly Warehouse[]) {}

  covers(prefix: string): boolean {
    return this.warehouses.some((warehouse) => warehouse.zoneFor(prefix) !== undefined);
  }

  candidates(prefix: string, items: Items): Candidate[] {
    return this.warehouses.flatMap((warehouse) => {
      const zone = warehouse.zoneFor(prefix);
      return zone !== undefined && warehouse.canFill(items) ? [{ warehouse, zone }] : [];
    });
  }
}

export function loadNetwork(rawWarehouses: unknown, rawZones: unknown, warn: Warn): Network {
  if (!Array.isArray(rawWarehouses)) throw new RoutingStopped("warehouses.json: expected an array of warehouses");
  if (!isRecord(rawZones)) throw new RoutingStopped("zones.json: expected an object of zone maps");

  const zoneMaps = byCanonicalKey(rawZones);
  const entries = identifiable(rawWarehouses, warn);
  const unique = dedupe(entries, (item) => item.code, (code, identical) => warnDuplicate(code, identical, warn));
  const warehouses = [...unique.values()].flatMap((item) => (item ? build(item, zoneMaps, warn) : []));

  warnUnusedZoneMaps(zoneMaps, new Set(entries.map((item) => item.code)), warn);
  return new Network(inPriorityOrder(checkUsable(warehouses, warn), warn));
}

function identifiable(list: unknown[], warn: Warn): RawWarehouse[] {
  return list.flatMap((entry, index) => {
    const code = isRecord(entry) ? canonicalId(entry.code) : undefined;
    if (code === undefined || !isRecord(entry)) return skip(warn, `warehouses.json: entry ${index + 1} has no usable code, skipped`);
    return [{ code, entry }];
  });
}

function warnDuplicate(code: string, identical: boolean, warn: Warn): void {
  const outcome = identical ? "identical copies, using one" : "conflicting entries, all disabled";
  warn(`warehouses.json: ${code} appears more than once (${outcome})`);
}

// Only a broken structure disables the whole warehouse; bad lines and zones are dropped one by one (D-00).
function build({ code, entry }: RawWarehouse, zoneMaps: ReadonlyMap<string, unknown>, warn: Warn): Warehouse[] {
  if (typeof entry.enabled !== "boolean") return skip(warn, `warehouses.json: ${code} has a non-boolean "enabled", disabled`);
  if (!isRecord(entry.inventory)) return skip(warn, `warehouses.json: ${code} has no inventory object, disabled`);
  return [new Warehouse(code, entry.enabled, parseZones(code, zoneMaps.get(code), warn), parseInventory(code, entry.inventory, warn))];
}

function parseInventory(code: string, inventory: Record<string, unknown>, warn: Warn): Map<string, StockLine> {
  const lines = Object.entries(inventory).flatMap(([key, line]) => {
    const sku = canonicalId(key);
    if (sku === undefined) return skip(warn, `warehouses.json: ${code} has an inventory line without a usable SKU, dropped`);
    return [{ sku, line }];
  });
  const unique = dedupe(lines, (item) => item.sku, (sku, identical) =>
    warn(`warehouses.json: ${code} lists ${sku} more than once (${identical ? "identical, using one" : "conflicting, dropped"})`),
  );
  return new Map([...unique].flatMap(([sku, item]) => (item ? stockLine(code, sku, item.line, warn) : [])));
}

function stockLine(code: string, sku: string, line: unknown, warn: Warn): [string, StockLine][] {
  const { available, dailyVelocity } = isRecord(line) ? line : {};
  if (!isNonNegativeInteger(available) || !isNonNegativeFinite(dailyVelocity)) {
    return skip(warn, `warehouses.json: ${code} inventory line ${sku} is invalid, dropped`);
  }
  // Adding 0 turns -0 into +0, so a JSON velocity of -0 still means infinite cover (D-11).
  return [[sku, { available, dailyVelocity: dailyVelocity + 0 }]];
}

function parseZones(code: string, zoneMap: unknown, warn: Warn): Map<string, number> {
  if (!isRecord(zoneMap)) {
    warn(`zones.json: ${code} has no zone map, it can't take any order`);
    return new Map();
  }
  return new Map(
    Object.entries(zoneMap).flatMap(([prefix, zone]) => {
      if (PREFIX.test(prefix) && isPositiveInteger(zone)) return [[prefix, zone] as const];
      return skip(warn, `zones.json: ${code} zone entry ${JSON.stringify(prefix)} is invalid, dropped`);
    }),
  );
}

// Reversed so that, when two keys normalize to the same code, the first one in the file wins.
function byCanonicalKey(record: Record<string, unknown>): Map<string, unknown> {
  return new Map(Object.entries(record).reverse().map(([key, value]) => [canonicalId(key) ?? key, value]));
}

function warnUnusedZoneMaps(zoneMaps: ReadonlyMap<string, unknown>, codes: ReadonlySet<string>, warn: Warn): void {
  const unused = [...zoneMaps].filter(([key, value]) => !codes.has(key) && isRecord(value));
  for (const [key] of unused) warn(`zones.json: zone map for unknown warehouse ${key}, ignored`);
}

// The run stops only when no warehouse could ever take an order (D-00, F-02).
function checkUsable(warehouses: Warehouse[], warn: Warn): Warehouse[] {
  if (!warehouses.some((warehouse) => warehouse.hasZones())) {
    throw new RoutingStopped("no usable warehouse: every warehouse is invalid or has no zone map");
  }
  if (!warehouses.some((warehouse) => warehouse.enabled)) warn("every warehouse is disabled: all orders go to PARTNER");
  return warehouses;
}

function inPriorityOrder(warehouses: Warehouse[], warn: Warn): Warehouse[] {
  for (const warehouse of warehouses.filter((w) => !PRIORITY.includes(w.code))) {
    warn(`${warehouse.code} is not in the rule-6 priority list, ranked after the listed warehouses`);
  }
  return [...warehouses].sort((a, b) => rank(a.code) - rank(b.code) || compareText(a.code, b.code));
}

function rank(code: string): number {
  const index = PRIORITY.indexOf(code);
  return index === -1 ? PRIORITY.length : index;
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function skip(warn: Warn, message: string): [] {
  warn(message);
  return [];
}
