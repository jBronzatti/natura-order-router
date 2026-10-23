# Decisions — Part A: order router

Each decision is a **policy for a class of input**, implemented in code. It is never a fix for a specific record, and the data files are never edited. The records in [analysis.md](analysis.md) are only the evidence that a class of input exists.

Status values:
- **DECIDED** — confirmed by the user (with the date).
- **DEFAULT** — a small detail decided with Claude's recommendation, under the working agreement below.
- **OPEN** — a real choice that is still waiting.

**Working agreement (2026-10-23):** small details use Claude's recommendation and are written down here (section "Defaults"). Claude asks only when a choice changes where an order is routed.

---

## D-00 · Trust levels: order events vs. reference data — DECIDED (2026-10-23)

This is the umbrella decision. The others follow from it.

| Source | On bad input |
|---|---|
| **Order events** (`orders.json`): external, unbounded | **Never crash.** Every identifiable `order_created` gets exactly one output line. An order that can't be routed safely goes to **PARTNER with an explicit reason code**, plus a warning on stderr. |
| **Reference data** (`warehouses.json`, `zones.json`, `catalog.json`): our configuration | **Drop only the broken part, warn, and keep routing.** Details in D-22. |

- **Granularity of reference data:**
  - A bad inventory line → the warehouse doesn't have that SKU (rule 3 handles it).
  - A bad zone entry → the warehouse doesn't have that prefix (D-08 handles it).
  - A bad catalog item → only the orders that contain it go to PARTNER `INVALID_CATALOG_ITEM`.
  - A warehouse is disabled as a whole **only when its structure is broken**: no code, `enabled` not a boolean, `inventory` not an object, or a conflicting duplicate code.
- **The run stops only** when an input file can't be read (missing, invalid JSON, or the wrong top-level shape), or when no structurally valid warehouse **with a zone map** is left. Otherwise every order would go to PARTNER anyway.
- **Valid warehouses that are all `enabled: false`** are a deliberate business state, not broken data. In that case every order goes to PARTNER, and the run warns once on stderr. It doesn't stop.
- Part A only allows "warehouse or PARTNER", so invalid orders go to **PARTNER**. Their reason codes keep them distinct.
- *Rejected:* failing fast on any reference-data error (approved first, then revised the same day). Disabling a whole warehouse for one bad line.

---

## Order data: field policies

### D-01 · ZIP handling (D-07 merged in) — DECIDED (2026-10-23)

**Rule 2 is applied literally, and ZIP values are never repaired.** The code reads the ZIP only once rule 1 has passed.

| Input class | Result | Reason code |
|---|---|---|
| missing / `null` / not a string or number (boolean, object, array…) | PARTNER | `NO_ZIP` |
| a string that is empty after `trim()` (D-03) | PARTNER | `NO_ZIP` |
| a string (trimmed) or a number (as text): prefix = its **first 3 characters** | prefix is a zones key → rule 3 | — |
| | prefix is not a zones key → PARTNER | `ZIP_NOT_COVERED` |

- Consequences:
  - `"07030-1834"` → `070`.
  - `" 10001 "` → `100`.
  - The number `2134` → `"213"` → `ZIP_NOT_COVERED`.
  - The array `[100]` → `NO_ZIP`, so it never matches by accident.
- "First 3 characters" means exactly that. Digits are never picked out of a string (`"1-0001"` → `"1-0"`).
- Rejected: padding numeric ZIPs, validating ZIP formats, and converting arrays or objects to text.

### D-02 · Bundles — DECIDED (2026-10-23)
- Any order SKU that is a bundle in the catalog is replaced by `component.quantity × line.quantity` of each component. This happens before the stock check, the cover calculation and the reservation. Inventory is never checked for the bundle SKU itself.
- **Nested bundles (option A):** a bundle that contains another bundle is an invalid catalog item. Orders that contain it → PARTNER `INVALID_CATALOG_ITEM`.
- A bundle whose component isn't a valid catalog product, or that has an empty or invalid component list → an invalid catalog item (D-22).
- Rejected: recursive expansion (B); the literal reading, where nobody stocks the bundle SKU so the order goes to PARTNER.

### D-03 · Identifier normalization — DECIDED (2026-10-23)
- The canonical form is `trim()` + upper case, applied **everywhere**: order-line and edit-line SKUs, catalog products, bundle components, inventory keys, `shipTo.country`, and ZIP strings (trim only matters there).
- An order SKU that isn't a non-empty string after trimming → invalid line (D-18).
- Keys that collapse to the same canonical SKU are handled by the duplicate rule in D-22.

### D-04 · Edits are merged — DECIDED (2026-10-23)
- The `addedLines` of each valid edit (D-14) are appended to the order before it's routed. Multiple edits accumulate.
- *Source:* "route each order once, with everything in it."

### D-05 · Unknown SKU (not in the catalog after D-03) — DECIDED (2026-10-23)
- The whole order → PARTNER `UNKNOWN_SKU`. The catalog is authoritative: a SKU that exists only in an inventory is still unknown.
- A SKU in the catalog but missing from one warehouse's inventory is normal: that warehouse has 0 of it.
- *Source:* rule 7 (no warehouse can take it) + D-00 (an explicit reason).

### D-06 · Country — DECIDED (2026-10-23)
- Only `shipTo.country` is read (after D-03), never `state` (`CA` is both a country code and a state code).

| Input class (after normalization) | Result | Reason code |
|---|---|---|
| `US`, `USA`, `UNITED STATES`, `UNITED STATES OF AMERICA` | domestic → rule 2 | — |
| any other non-empty string | PARTNER | `INTERNATIONAL` |
| missing / `null` / empty / not a string / no `shipTo` | PARTNER | `NO_COUNTRY` |

- The aliases are different names for the US, not a repair of the data (user correction, 2026-10-23).
- US territories with their own ISO codes (PR, GU, VI…) are `INTERNATIONAL`.

### D-07 · *Merged into D-01.*

### D-18 · Order line validation (creation and edit lines alike) — DECIDED (2026-10-23)

| Input class | Result |
|---|---|
| `quantity` is an integer ≥ 1 | valid |
| `quantity` is 0, negative, a float, NaN, missing, or a numeric string (`"2"`) | invalid line |
| `sku` missing / empty after trim / not a string | invalid line |
| `lines` missing, not an array, or empty | invalid order |

- Any invalid line → the whole order goes to PARTNER `INVALID_ORDER`, with a stderr detail. Lines are never dropped, and numeric strings are never converted.
- *Source:* D-00 + "with everything in it" (dropping a line would ship an order the customer didn't place) + no repair.

### D-19 · Order identity — DECIDED (2026-10-23)
- `orderNumber` missing / empty / not a string → it can't be reported: skip it, with a warning.
- A duplicate `order_created` for the same number → the first one wins, and the later ones are ignored with a warning.
- *Source:* D-00 ("every identifiable order") + "route each order once."

### D-20 · Event envelope — DECIDED (2026-10-23)
- An unknown `type`, or an event that isn't an object → ignore it, with a warning.
- `orders.json` isn't an array → the run stops (the file can't be read).
- *Source:* D-00.

---

## Rule mechanics

### D-08 · Partial prefix coverage — DECIDED (2026-10-23)
- A prefix counts as "in zones.json" (rule 2) if **any** valid warehouse's zone map has it. A warehouse whose map lacks the prefix just can't take the order.
- The same applies to a zone entry that D-22 drops, and to a warehouse with no zone map at all (it can't take any order).

### D-09 · Stock check granularity — DECIDED (2026-10-23)
- Sum the quantities per canonical SKU across all lines (original + edits + expanded bundles). Eligible when `available >= total`.
- *Source:* rule 3. Checking each line on its own could reserve more stock than exists, and "enough" includes an exact match.

### D-10 · Days of cover — DECIDED (2026-10-23)
- `available ÷ velocity`, where `available` already reflects earlier reservations, but not this order's.
- *Source:* the literal formula in rule 5.

### D-11 · Velocity 0 — DECIDED (2026-10-23)
- Cover = `+Infinity`. 0 ÷ 0 can't happen, because the stock check fails first.
- An invalid velocity (negative, non-finite, not a number) drops that inventory line (D-22).
- *Source:* rule 5's formula.

### D-12 · PARTNER semantics — DECIDED (2026-10-23)
- Unlimited stock. It reserves nothing from our warehouses.
- *Source:* it isn't in `warehouses.json`.

### D-13 · Processing order — DECIDED (2026-10-23)
- A stable sort of `order_created` events by `at`. Ties keep their file order ("in the order they arrived").
- `at` missing or unparseable on a creation → PARTNER `INVALID_ORDER`, with no reservation.
- *Source:* "route orders in the order they were created" + D-00.

### D-14 · Edit timing — DECIDED (2026-10-23) (**affects the results**, see analysis §3)
- An edited order is routed **in its creation slot**, with all its valid edits merged (look-ahead over the whole event list).
- The window is inclusive: `0 ≤ edit.at − created.at ≤ 30:00`.
- Edits are ignored, with a warning, when they fall outside the window, come before the creation, have an unparseable `at`, or target an unknown order number.
- An in-window edit with an invalid line follows D-18.
- *Source:* "route orders in the order they were created", "for up to 30 minutes", and D-00.

### D-21 · Warehouses missing from the rule-6 priority list — DECIDED (2026-10-23)
- They go after the listed ones (NJ, GA, NV, TX), ordered by code, with a warning.
- *Source:* D-00. Their data is valid; the rules just don't rank them.

### D-22 · Reference data checklist (applies D-00) — DECIDED (2026-10-23)

| Check | If it fails |
|---|---|
| A file is missing / not valid JSON / the wrong top-level shape (`warehouses` not an array, `zones` not an object, `catalog.products` not an array, `orders` not an array) | **Stop the run** |
| A warehouse entry isn't an object, or its `code` is missing, empty or not a string | Skip the entry + warn |
| Two or more warehouse entries share a `code`: **identical** | Keep one + warn |
| Two or more warehouse entries share a `code`: **different in anything** | Disable all of them + warn |
| `enabled` isn't a boolean (a missing value is **not** treated as false) | Disable the warehouse + warn |
| `inventory` isn't an object | Disable the warehouse + warn |
| An inventory line isn't an object; `available` isn't an integer ≥ 0; `dailyVelocity` isn't a finite number ≥ 0 | Drop that line (the warehouse doesn't have that SKU) + warn |
| Two inventory keys in one warehouse collapse to the same SKU (D-03): **identical** / **different** | Keep one + warn / drop both + warn (the duplicate rule, applied to lines) |
| A warehouse has no zone map, or it isn't an object | The warehouse has no prefixes (D-08) + warn. It is not disabled, but it doesn't count for the stop check |
| A zone prefix key isn't 3 digits, or its zone value isn't an integer ≥ 1 | Drop that prefix for that warehouse (D-08) + warn |
| A zones key that isn't a warehouse code (`_note`, an unknown code) | Ignore it (warn only if the value is an object) |
| A catalog product or bundle with a missing/empty SKU | Skip the entry + warn |
| Catalog entries that collapse to the same SKU (D-03), including a bundle SKU equal to a product SKU: **identical** / **different** | Keep one + warn / every entry with that SKU is an invalid catalog item (the duplicate rule, applied to the catalog) |
| A bundle with an empty/invalid component list, a component qty that isn't an integer ≥ 1, a component that isn't a valid product, or a nested bundle | That bundle is an invalid catalog item |
| `catalog.bundles` is missing | No bundles (not an error) |
| **No structurally valid warehouse with a zone map** is left after all of the above | **Stop the run** |

---

## Output and tooling

### D-15 · Output format — DECIDED (2026-10-23)
- One line per routed `order_created`, in processing order, printed to stdout and written to `routes.txt`. Warnings go to **stderr only**, so `routes.txt` stays clean.
- Columns: order number, warehouse or `PARTNER`, then the zone or the reason code, aligned with spaces.
- **Warehouse lines** show the zone. When rule 5 or rule 6 decided the pick, a short tie-break detail follows in parentheses.
  - Cover is printed with 2 decimals, and `inf` stands for infinite cover (velocity 0).
  - `>` / `=` shows the real comparison. If two covers print the same at 2 decimals but aren't equal, the line still says `>`.
  - With 3 or more tied warehouses, every one of them is listed in the order they ranked.
- **PARTNER lines** show a machine reason code from a closed set, with a short detail in parentheses: `INTERNATIONAL`, `NO_COUNTRY`, `NO_ZIP`, `ZIP_NOT_COVERED`, `UNKNOWN_SKU`, `INVALID_CATALOG_ITEM`, `INVALID_ORDER`, `NO_WAREHOUSE`.
  ```
  #2031  WH-NJ    zone 1
  #20xx  WH-GA    zone 5 (tie rule 5: cover WH-GA 10.00d > WH-NJ 0.10d)
  #20xx  WH-NJ    zone 3 (tie rule 6: cover WH-NJ 5.00d = WH-GA 5.00d, priority WH-NJ > WH-GA)
  #20xx  PARTNER  INTERNATIONAL (country CA)
  #20xx  PARTNER  NO_COUNTRY (missing)
  #20xx  PARTNER  NO_ZIP (missing)
  #20xx  PARTNER  ZIP_NOT_COVERED (prefix 968)
  #20xx  PARTNER  UNKNOWN_SKU (NW-FOO-10)
  #20xx  PARTNER  INVALID_CATALOG_ITEM (NW-BNDL-X)
  #20xx  PARTNER  INVALID_ORDER (line 2: quantity "2")
  #20xx  PARTNER  NO_WAREHOUSE (no enabled warehouse can fill the whole order)
  ```
  (`#20xx` lines show the format only. They are not predicted results.)

### D-16 · Test runner and TS execution — DECIDED (2026-10-23)
- `vitest` for tests, `tsx` to run the TypeScript script.

### D-17 · Repo layout — DECIDED (2026-10-23)
- The code sits at the repo root: `src/`, `tests/`, `docs/`.
- The 4 JSON files are copied **unchanged** into `data/`. `ops-notes.md` is not copied.
- The script takes the data folder as an argument, with `data/` as the default.
- `routes.txt` is written at the repo root, worked out from where the script lives (not the current folder).
- The original `natura-wellness-backend-test 2/` folder stays out of the repo (`.gitignore`).

---

## Defaults (small details, under the working agreement)

Each one was checked: none of them changes where any order in today's data is routed.

| ID | Detail | Default |
|---|---|---|
| F-01 | Country normalization for the multi-word aliases | Trim, upper case, and collapse runs of internal whitespace to one space (`"United  States"` → `UNITED STATES`). Other punctuation (`U.S.`) is not stripped. |
| F-02 | Stop check: "has a zone map" | The map must be an object with at least one valid prefix after D-22. An object where every entry got dropped is as useless as no map. |
| F-03 | Rounding of cover in the output | `Number.toFixed(2)`, so 399/40 = 9.975 prints `9.97` (the double is 9.97499…). This is display only; the comparisons use the exact values. |
| F-04 | Core API for the tests | `routeOrders(rawInput) → { routes, warnings }`. It takes the four parsed JSON values as `unknown`, so validation (D-00) happens inside the system, not in the caller. |
| F-05 | `catalog.bundles` missing, `null`, or another non-array value | Missing → no bundles. `null` → no bundles, with a warning (user decision B, 2026-10-23). Any other non-array value → wrong top-level shape → stop the run |
| F-06 | Warehouse codes and zones keys | Normalized like other identifiers (trim + upper case), so `wh-nj` in zones matches `WH-NJ`. When two zones keys normalize to the same code, the first one wins |
| F-07 | Output position of an order with an unreadable creation time | It can't be sequenced, so it goes after all the others (file order among themselves) |
| F-08 | An in-window edit whose `addedLines` isn't an array | The order becomes `INVALID_ORDER`, consistent with D-18 |
| F-09 | Which reason wins when several apply | Rule 1 → rule 2 → order validity (`INVALID_ORDER`) → catalog (`UNKNOWN_SKU` / `INVALID_CATALOG_ITEM`) → rule 7. The destination is PARTNER in every case; only the reason text differs |
| F-10 | Order numbers | Trimmed, otherwise kept as written (an edit matches its order the same way) |
| F-11 | Timestamps | ISO 8601 strings **with an explicit offset** (`Z` or `±hh:mm`), hours `00`–`23` (`24:00` rejected, user decision 2026-10-23), and a day that exists in that month **as written** (leap years included; checked before the offset is applied, so `2026-03-01T01:00+05:00` is valid). Anything else is unreadable: an edit is ignored with a warning, a creation becomes `INVALID_ORDER`. No timezone is ever assumed, so the same file routes the same way on every machine (user decision A, 2026-10-23) |
| F-12 | Infinite cover in the output | Printed as `inf`, without the `d` |
| F-13 | Which PARTNER routes also get a warning | Those caused by bad order data: `NO_COUNTRY`, `INVALID_ORDER`, `UNKNOWN_SKU`, `INVALID_CATALOG_ITEM`. Rule outcomes (`INTERNATIONAL`, `NO_ZIP`, `ZIP_NOT_COVERED`, `NO_WAREHOUSE`) don't, because the rules expect them |
| F-14 | An empty `lines: []` at creation | `INVALID_ORDER`, even when an edit adds lines later (D-18 as written; fixes review point 5) |

---

## Known issues (accepted on 2026-10-23 to fit the deadline)

Found by an independent review on 2026-10-23. None of them changes a route in today's data: the data has no duplicate JSON keys, no BOM, no control characters, and every timestamp has an offset.

| ID | Issue | Effect | Why it's not fixed |
|---|---|---|---|
| K-01 | Exact duplicate keys inside a JSON object (e.g. the same SKU twice in one inventory) | `JSON.parse` keeps the last copy silently, so the D-22 duplicate rule never sees it. Keys that only differ in case are handled correctly | Detecting this needs a custom JSON scanner. Our config exports are built from objects, which can't hold duplicate keys |
| K-02 | Very large inputs | Spreading values into `Math.max`/`Math.min` and `push(...)` throws a `RangeError` at about 125k values (order count in `format.ts`, distinct SKUs in one order, lines in one edit). `dedupe` is quadratic in the number of duplicates | Far beyond realistic order volumes for one run. The fix is mechanical (use loops) |
| K-03 | "Identical" in the D-22 duplicate rule | Warehouse and catalog entries are compared raw (before normalization); inventory lines after. So `{sku:"X"}` vs `{sku:"x"}` count as a conflict | It always fails safe: the entries are disabled or marked invalid. It never routes to a warehouse with the wrong stock |
| K-04 | Control characters in identifiers or details (e.g. a SKU containing `\n`) | Copied into the output, so one order can print as two lines and break "one line per order" (D-15) | Needs escaping in `format.ts`. No such data today |
| K-05 | Decisions implemented but not covered by tests | D-02 nested/invalid bundles, D-05, D-06 `NO_COUNTRY` and the `UNITED STATES OF AMERICA` alias, D-08, D-09, D-11, rule 6 beyond NJ before GA (it never fires on today's data, so the rest of the priority order and the rule-6 output line are unprotected), D-13, D-14 edge cases, D-15 formatting beyond what the golden file prints, D-17 (where `routes.txt` is written), D-18 to D-22, F-01, F-05 `null`, F-06, F-13, F-14, warnings carried by a stop. The fixes for review points 1, 4, 5 and B were checked by hand in a scratch script; the CLI behavior (stale `routes.txt` removed, BOM stripped) only by reading the code, because the permission check blocked the CLI runs that test it. D-10 and rule 5 are protected by the golden file, which prints the covers | Test scope cut to ACC-1, D-01, D-03 and F-11 to fit the deadline |
| K-06 | Bad order data that isn't the deciding reason | Rules 1 and 2 run first (F-09), so e.g. an unreadable `at` on an international order goes to PARTNER `INTERNATIONAL` with no warning about the timestamp. The destination is always right; only the report is missing | A proper fix checks data separately from the rules, including the catalog check that never runs for international orders (user decision: document, 2026-10-23) |
| K-07 | `routes.txt` written directly, not through a temp file | If the write fails halfway (e.g. a full disk), a partial `routes.txt` is left behind | Guards against something that hasn't happened (user decision: minimal, 2026-10-23) |
