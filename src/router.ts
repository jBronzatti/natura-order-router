import { loadCatalog } from "./catalog.ts";
import { RoutingStopped } from "./errors.ts";
import { loadNetwork } from "./network.ts";
import { assembleOrders } from "./orders.ts";
import { routeOrder } from "./route.ts";
import type { RawInput, ReasonCode, Route, RoutingResult, Warn } from "./types.ts";

// PARTNER reasons caused by bad order data rather than by a routing rule; each one is also warned (D-00, F-13).
const DATA_PROBLEMS: ReadonlySet<ReasonCode> = new Set(["NO_COUNTRY", "INVALID_ORDER", "UNKNOWN_SKU", "INVALID_CATALOG_ITEM"]);

export function routeOrders(input: RawInput): RoutingResult {
  const warnings: string[] = [];
  const warn = (message: string) => void warnings.push(message);

  try {
    return { routes: route(input, warn), warnings };
  } catch (error) {
    if (!(error instanceof RoutingStopped)) throw error;
    throw new RoutingStopped(error.message, warnings);
  }
}

function route(input: RawInput, warn: Warn): Route[] {
  const catalog = loadCatalog(input.catalog, warn);
  const network = loadNetwork(input.warehouses, input.zones, warn);
  const orders = assembleOrders(input.orders, warn);

  // Sequential on purpose: each route reserves stock that later orders see.
  const routes = orders.map((order) => routeOrder(order, catalog, network));
  for (const problem of routes.filter(isDataProblem)) {
    warn(`${problem.orderNumber} goes to PARTNER: ${problem.reason} (${problem.detail})`);
  }
  return routes;
}

function isDataProblem(route: Route): route is Extract<Route, { kind: "partner" }> {
  return route.kind === "partner" && DATA_PROBLEMS.has(route.reason);
}
