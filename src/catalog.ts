import { dedupe } from "./dedupe.ts";
import { RoutingStopped } from "./errors.ts";
import { isPositiveInteger, isRecord } from "./guards.ts";
import { canonicalId } from "./normalize.ts";
import type { Items, OrderLine, Warn } from "./types.ts";

type Entry =
  | { kind: "product" }
  | { kind: "bundle"; components: Items }
  | { kind: "invalid" };

interface RawEntry {
  sku: string;
  kind: "product" | "bundle";
  entry: Record<string, unknown>;
}

export type Expansion =
  | { ok: true; items: Items }
  | { ok: false; reason: "UNKNOWN_SKU" | "INVALID_CATALOG_ITEM"; sku: string };

type ExpansionFailure = Extract<Expansion, { ok: false }>;

const INVALID: Entry = { kind: "invalid" };

export class Catalog {
  constructor(private readonly entries: ReadonlyMap<string, Entry>) {}

  // Bundles become their components times the line quantity; repeated SKUs are summed (D-02, D-09).
  expand(lines: readonly OrderLine[]): Expansion {
    const items = new Map<string, number>();
    for (const line of lines) {
      const failure = this.addLine(items, line);
      if (failure) return failure;
    }
    return { ok: true, items };
  }

  private addLine(items: Map<string, number>, line: OrderLine): ExpansionFailure | undefined {
    const entry = this.entries.get(line.sku);
    if (!entry) return { ok: false, reason: "UNKNOWN_SKU", sku: line.sku };
    if (entry.kind === "invalid") return { ok: false, reason: "INVALID_CATALOG_ITEM", sku: line.sku };

    const parts: Items = entry.kind === "bundle" ? entry.components : new Map([[line.sku, 1]]);
    for (const [sku, quantity] of parts) addTo(items, sku, quantity * line.quantity);
    return undefined;
  }
}

export function loadCatalog(raw: unknown, warn: Warn): Catalog {
  if (!isRecord(raw) || !Array.isArray(raw.products)) {
    throw new RoutingStopped('catalog.json: expected an object with a "products" array');
  }
  if (raw.bundles === null) warn('catalog.json: "bundles" is null, treated as no bundles');
  const bundles = raw.bundles ?? [];
  if (!Array.isArray(bundles)) throw new RoutingStopped('catalog.json: "bundles" must be an array when present');

  const rawEntries = [...identifiable(raw.products, "product", warn), ...identifiable(bundles, "bundle", warn)];
  const unique = dedupe(rawEntries, (item) => item.sku, (sku, identical) => warnDuplicate(sku, identical, warn));

  const entries = new Map<string, Entry>();
  for (const [sku, item] of unique) entries.set(sku, toEntry(item, unique, warn));
  return new Catalog(entries);
}

function identifiable(list: unknown[], kind: RawEntry["kind"], warn: Warn): RawEntry[] {
  return list.flatMap((entry, index) => {
    const sku = isRecord(entry) ? canonicalId(entry.sku) : undefined;
    if (sku === undefined || !isRecord(entry)) {
      warn(`catalog.json: ${kind} ${index + 1} has no usable SKU, skipped`);
      return [];
    }
    return [{ sku, kind, entry }];
  });
}

function warnDuplicate(sku: string, identical: boolean, warn: Warn): void {
  const outcome = identical ? "identical copies, using one" : "conflicting entries, SKU marked invalid";
  warn(`catalog.json: ${sku} appears more than once (${outcome})`);
}

function toEntry(item: RawEntry | undefined, catalog: ReadonlyMap<string, RawEntry | undefined>, warn: Warn): Entry {
  if (!item) return INVALID;
  if (item.kind === "product") return { kind: "product" };

  const components = bundleComponents(item.entry.components, catalog);
  if (components) return { kind: "bundle", components };
  warn(`catalog.json: bundle ${item.sku} has invalid components, SKU marked invalid`);
  return INVALID;
}

// Components must be valid products; a bundle inside a bundle is rejected (D-02 option A).
function bundleComponents(raw: unknown, catalog: ReadonlyMap<string, RawEntry | undefined>): Items | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const components = new Map<string, number>();
  for (const component of raw) {
    const sku = isRecord(component) ? canonicalId(component.sku) : undefined;
    const quantity = isRecord(component) ? component.quantity : undefined;
    const isProduct = sku !== undefined && catalog.get(sku)?.kind === "product";
    if (!isProduct || !isPositiveInteger(quantity)) return undefined;
    addTo(components, sku, quantity);
  }
  return components;
}

function addTo(items: Map<string, number>, sku: string, quantity: number): void {
  items.set(sku, (items.get(sku) ?? 0) + quantity);
}
