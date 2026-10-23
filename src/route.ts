import type { Catalog } from "./catalog.ts";
import { isRecord } from "./guards.ts";
import type { Candidate, Network } from "./network.ts";
import { canonicalCountry, isUnitedStates } from "./normalize.ts";
import type { Order } from "./orders.ts";
import type { CoverEntry, Items, ReasonCode, Route } from "./types.ts";
import { zipPrefix } from "./zip.ts";

interface Ranked extends CoverEntry {
  candidate: Candidate;
}

// Rules 1–7 for one order. A warehouse route reserves its stock in the network.
export function routeOrder(order: Order, catalog: Catalog, network: Network): Route {
  const partner = (reason: ReasonCode, detail: string): Route => ({ kind: "partner", orderNumber: order.orderNumber, reason, detail });

  const country = canonicalCountry(shipToField(order.shipTo, "country"));
  if (country === undefined) return partner("NO_COUNTRY", "missing");
  if (!isUnitedStates(country)) return partner("INTERNATIONAL", `country ${country}`);

  const prefix = zipPrefix(shipToField(order.shipTo, "zip"));
  if (prefix === undefined) return partner("NO_ZIP", "missing");
  if (!network.covers(prefix)) return partner("ZIP_NOT_COVERED", `prefix ${prefix}`);

  if (order.problem !== undefined) return partner("INVALID_ORDER", order.problem);
  const expansion = catalog.expand(order.lines);
  if (!expansion.ok) return partner(expansion.reason, expansion.sku);

  const route = assignWarehouse(order.orderNumber, prefix, expansion.items, network);
  return route ?? partner("NO_WAREHOUSE", "no enabled warehouse can fill the whole order");
}

function assignWarehouse(orderNumber: string, prefix: string, items: Items, network: Network): Route | undefined {
  const candidates = network.candidates(prefix, items);
  if (candidates.length === 0) return undefined;

  const zone = Math.min(...candidates.map((candidate) => candidate.zone));
  const ranking = rankByCover(candidates.filter((candidate) => candidate.zone === zone), items);
  const [winner, runnerUp] = ranking;
  if (!winner) return undefined;

  winner.candidate.warehouse.reserve(items);
  const route: Route = { kind: "warehouse", orderNumber, warehouse: winner.warehouse, zone };
  if (!runnerUp) return route;
  return { ...route, tieBreak: { rule: winner.cover > runnerUp.cover ? 5 : 6, ranking: ranking.map(toCoverEntry) } };
}

// Stable sort: equal covers keep the network's priority order, which is rule 6.
function rankByCover(tied: Candidate[], items: Items): Ranked[] {
  return tied
    .map((candidate) => ({ candidate, warehouse: candidate.warehouse.code, cover: candidate.warehouse.coverFor(items) }))
    .sort(byCoverDescending);
}

function byCoverDescending(a: Ranked, b: Ranked): number {
  if (a.cover === b.cover) return 0;
  return a.cover > b.cover ? -1 : 1;
}

function toCoverEntry({ warehouse, cover }: Ranked): CoverEntry {
  return { warehouse, cover };
}

function shipToField(shipTo: unknown, field: string): unknown {
  return isRecord(shipTo) ? shipTo[field] : undefined;
}
