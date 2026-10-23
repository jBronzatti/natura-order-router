import type { CoverEntry, Route, TieBreak } from "./types.ts";

const GAP = 2;

// One aligned line per route (D-15).
export function formatRoutes(routes: readonly Route[]): string[] {
  const orderWidth = Math.max(0, ...routes.map((route) => route.orderNumber.length)) + GAP;
  const destinationWidth = Math.max("PARTNER".length, ...routes.map((route) => destination(route).length)) + GAP;
  return routes.map((route) => route.orderNumber.padEnd(orderWidth) + destination(route).padEnd(destinationWidth) + outcome(route));
}

function destination(route: Route): string {
  return route.kind === "warehouse" ? route.warehouse : "PARTNER";
}

function outcome(route: Route): string {
  if (route.kind === "partner") return `${route.reason} (${route.detail})`;
  return `zone ${route.zone}${route.tieBreak ? ` ${tieDetail(route.tieBreak)}` : ""}`;
}

function tieDetail({ rule, ranking }: TieBreak): string {
  const priority = rule === 6 ? `, priority ${coverLeaders(ranking).join(" > ")}` : "";
  return `(tie rule ${rule}: cover ${coverChain(ranking)}${priority})`;
}

// ">" or "=" reflects the exact comparison, even when two covers print the same.
function coverChain(ranking: readonly CoverEntry[]): string {
  return ranking
    .map((entry, index) => {
      const previous = ranking[index - 1];
      const cell = `${entry.warehouse} ${formatCover(entry.cover)}`;
      return previous ? `${previous.cover === entry.cover ? "=" : ">"} ${cell}` : cell;
    })
    .join(" ");
}

function coverLeaders(ranking: readonly CoverEntry[]): string[] {
  return ranking.filter((entry) => entry.cover === ranking[0]?.cover).map((entry) => entry.warehouse);
}

function formatCover(cover: number): string {
  return Number.isFinite(cover) ? `${cover.toFixed(2)}d` : "inf";
}
