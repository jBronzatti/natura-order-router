import { RoutingStopped } from "./errors.ts";
import { isPositiveInteger, isRecord, show } from "./guards.ts";
import { canonicalId } from "./normalize.ts";
import type { OrderLine, Warn } from "./types.ts";

const EDIT_WINDOW_MS = 30 * 60 * 1000;
// ISO 8601 with a mandatory offset, so the same file routes the same way in every timezone.
// Hours stop at 23: "24:00" is rejected rather than rolled over to the next day (F-11).
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export interface Order {
  orderNumber: string;
  createdAt: number | undefined;
  shipTo: unknown;
  lines: OrderLine[];
  // Set when the order can't be routed safely; it then goes to PARTNER as INVALID_ORDER (D-18).
  problem: string | undefined;
}

interface Draft {
  orderNumber: string;
  createdAt: number | undefined;
  shipTo: unknown;
  rawLines: unknown[];
  problem: string | undefined;
}

type Event = Record<string, unknown>;

// Orders in creation order, each with its in-window edits merged in (D-04, D-13, D-14).
export function assembleOrders(raw: unknown, warn: Warn): Order[] {
  if (!Array.isArray(raw)) throw new RoutingStopped("orders.json: expected an array of events");

  const drafts = new Map<string, Draft>();
  const edits: Event[] = [];
  raw.forEach((event, index) => collect(event, index, drafts, edits, warn));
  for (const edit of edits) applyEdit(edit, drafts, warn);

  return [...drafts.values()].map(finish).sort((a, b) => creationKey(a) - creationKey(b));
}

function collect(event: unknown, index: number, drafts: Map<string, Draft>, edits: Event[], warn: Warn): void {
  if (!isRecord(event)) return warn(`orders.json: event ${index + 1} is not an object, ignored`);
  if (event.type === "order_edited") return void edits.push(event);
  if (event.type !== "order_created") return warn(`orders.json: event ${index + 1} has unknown type ${show(event.type)}, ignored`);
  addCreation(event, index, drafts, warn);
}

function addCreation(event: Event, index: number, drafts: Map<string, Draft>, warn: Warn): void {
  const orderNumber = orderNumberOf(event.orderNumber);
  if (orderNumber === undefined) return warn(`orders.json: event ${index + 1} has no order number, skipped`);
  if (drafts.has(orderNumber)) return warn(`orders.json: duplicate order_created for ${orderNumber}, ignored (first one wins)`);

  const createdAt = parseTime(event.at);
  drafts.set(orderNumber, {
    orderNumber,
    createdAt,
    shipTo: event.shipTo,
    rawLines: Array.isArray(event.lines) ? [...event.lines] : [],
    problem: creationProblem(createdAt, event.lines),
  });
}

function creationProblem(createdAt: number | undefined, lines: unknown): string | undefined {
  if (createdAt === undefined) return "unreadable creation time";
  if (!Array.isArray(lines)) return "lines is not an array";
  if (lines.length === 0) return "no lines";
  return undefined;
}

function applyEdit(edit: Event, drafts: Map<string, Draft>, warn: Warn): void {
  const orderNumber = orderNumberOf(edit.orderNumber);
  const draft = orderNumber === undefined ? undefined : drafts.get(orderNumber);
  if (!draft) return warn(`orders.json: order_edited for unknown order ${show(edit.orderNumber)}, ignored`);

  const rejection = editRejection(draft, parseTime(edit.at));
  if (rejection) return warn(`orders.json: order_edited for ${draft.orderNumber} ${rejection}, ignored`);
  mergeLines(draft, edit.addedLines);
}

// The window is inclusive: an edit at exactly 30:00 still counts (D-14).
function editRejection(draft: Draft, editedAt: number | undefined): string | undefined {
  if (draft.createdAt === undefined) return "targets an order with an unreadable creation time";
  if (editedAt === undefined) return "has an unreadable time";
  if (editedAt < draft.createdAt) return "is dated before the order";
  if (editedAt - draft.createdAt > EDIT_WINDOW_MS) return "is after the 30-minute window";
  return undefined;
}

function mergeLines(draft: Draft, addedLines: unknown): void {
  if (Array.isArray(addedLines)) return void draft.rawLines.push(...addedLines);
  draft.problem ??= "an edit's addedLines is not an array";
}

function finish(draft: Draft): Order {
  const { lines, problem } = validateLines(draft.rawLines);
  return { orderNumber: draft.orderNumber, createdAt: draft.createdAt, shipTo: draft.shipTo, lines, problem: draft.problem ?? problem };
}

// Any invalid line makes the whole order invalid; lines are never dropped or coerced (D-18).
function validateLines(rawLines: unknown[]): { lines: OrderLine[]; problem?: string } {
  if (rawLines.length === 0) return { lines: [], problem: "no lines" };

  const lines: OrderLine[] = [];
  for (const [index, raw] of rawLines.entries()) {
    const line = parseLine(raw);
    if (typeof line === "string") return { lines: [], problem: `line ${index + 1}: ${line}` };
    lines.push(line);
  }
  return { lines };
}

function parseLine(raw: unknown): OrderLine | string {
  if (!isRecord(raw)) return "not an object";
  const sku = canonicalId(raw.sku);
  if (sku === undefined) return `sku ${show(raw.sku)}`;
  if (!isPositiveInteger(raw.quantity)) return `quantity ${show(raw.quantity)}`;
  return { sku, quantity: raw.quantity };
}

function orderNumberOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const orderNumber = value.trim();
  return orderNumber === "" ? undefined : orderNumber;
}

function parseTime(value: unknown): number | undefined {
  const match = typeof value === "string" ? TIMESTAMP.exec(value) : null;
  if (!match || !isCalendarDate(match)) return undefined;
  const time = Date.parse(match[0]);
  return Number.isNaN(time) ? undefined : time;
}

// Date.parse rolls Feb 30 over to Mar 2, so check the day as written, before the offset is
// applied: 2026-03-01T01:00+05:00 is a valid date even though it is Feb 28 in UTC.
function isCalendarDate([, year, month, day]: RegExpExecArray): boolean {
  const lastDayOfMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return Number(day) >= 1 && Number(day) <= lastDayOfMonth;
}

// Orders with an unreadable creation time can't be sequenced, so they go last (F-07).
function creationKey(order: Order): number {
  return order.createdAt ?? Number.MAX_SAFE_INTEGER;
}
