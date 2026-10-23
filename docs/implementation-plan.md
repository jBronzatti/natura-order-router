# Implementation plan — Part A: order router

Built from [decisions.md](decisions.md) (every D-xx is DECIDED). The tests come from [test-plan.md](test-plan.md).

## 1. Shape of the system

```
data/*.json ──read──▶ load (D-00, D-22) ──▶ ReferenceData + warnings
                                                   │
orders.json ──▶ assembleOrders (D-04, D-13, D-14, D-18, D-19, D-20) ──▶ Order[] in creation order
                                                   │
                       routeOrder (rules 1–7), Warehouse.reserve ──▶ Route[]
                                                   │
                                     format (D-15) ──▶ stdout + routes.txt
```

| Module | Responsibility |
|---|---|
| `src/types.ts` | `Route`, `ReasonCode`, `TieBreak`, `RawInput`, `RoutingResult`, `OrderLine`, `Items` |
| `src/guards.ts`, `src/errors.ts` | Type guards; `RoutingStopped`, the only error that stops a run (D-00) |
| `src/normalize.ts` | Canonical identifiers (D-03), country aliases (D-06, F-01) |
| `src/zip.ts` | `zipPrefix(raw)` → prefix or `undefined` = `NO_ZIP` (D-01) |
| `src/dedupe.ts` | The duplicate rule, shared by warehouses, inventory lines and the catalog (D-22) |
| `src/catalog.ts` | Loads and validates the catalog; expands bundles and sums SKUs (D-02, D-05, D-09) |
| `src/warehouse.ts` | One warehouse: zone for a prefix, `canFill`, `coverFor`, `reserve`. The only place where state changes |
| `src/network.ts` | Loads and validates warehouses and zones (D-22), keeps them in rule-6 order, finds candidates |
| `src/orders.ts` | Event list → orders in creation order, with edits merged and lines validated (D-04, D-13, D-14, D-18–D-20) |
| `src/route.ts` | Rules 1–7 for one order; reserves stock on the chosen warehouse |
| `src/router.ts` | `routeOrders(rawInput) → { routes, warnings }`: the public core API (F-04) |
| `src/format.ts` | Routes → aligned output lines (D-15) |
| `src/main.ts` | CLI: reads the data folder (arg, default `data/`), warnings → stderr, lines → stdout + `routes.txt` at the repo root |

`Route` is a discriminated union:
- `{ kind: "warehouse", orderNumber, warehouse, zone, tieBreak? }`
- `{ kind: "partner", orderNumber, reason, detail }`

## 2. Order of work (TDD)

1. ✅ Scaffold: `package.json` (ESM), `tsconfig.json`, vitest, tsx, `.gitignore` (`node_modules/`, `natura-wellness-backend-test 2/`).
2. ✅ **Core tests (red):** one suite per rule 1–7, plus bundles, edits and reservation order (18 tests, all through `routeOrders`).
3. ✅ Implemented: 18/18 green, `tsc` clean.
4. ✅ CLI + `format.ts`. `npm run route` output diffed against §3: **26/26 match**. Source data unchanged (byte-compared).
5. ✅ Review fixes (2026-10-23): warnings for invalid orders, strict timestamps, warnings kept when a run stops, empty `lines` invalid, stale `routes.txt` removed on a stopped run, BOM stripped, `bundles: null` handled.
6. ✅ Tests added: ACC-1 golden file on the real data (`tests/golden/routes.txt`), D-01, D-03; then F-11 timestamps after the second review. **47/47 green**, `routes.txt` unchanged.
7. Not done (deadline): the rest of test-plan.md. See Known issues in decisions.md.

## 3. Expected routes for today's data, worked out by hand

Initial stock as available / velocity (WH-TX is disabled):

| | VITD | MULTI | MAG |
|---|---|---|---|
| WH-NJ | 400/40 | 120/30 | 2/20 |
| WH-GA | 4/30 | 300/25 | 150/15 |
| WH-NV | 200/10 | 0/12 | 220/8 |

`zone` columns are NJ / GA / NV for the order's prefix. ✗ = not enough stock.

| Order | Ship to | Items (after D-02/D-03/D-04) | Zones NJ/GA/NV | Eligible | Result | Stock after |
|---|---|---|---|---|---|---|
| #2031 | US 070 | VITD 1 | 1/5/8 | all | **WH-NJ zone 1** | NJ VITD 399 |
| #2032 | US 303 | MULTI 1 | 5/1/7 | NJ, GA (NV ✗) | **WH-GA zone 1** | GA MULTI 299 |
| #2033 | US `2134` → `213` | VITD 1 | — | — | **PARTNER ZIP_NOT_COVERED (prefix 213)** | — |
| #2034 | US 606 | MAG 1 | 5/5/7 | all | tie at 5: cover GA 150/15 = 10.00 > NJ 2/20 = 0.10 → **WH-GA zone 5 (rule 5)** | GA MAG 149 |
| #2035 | US 752 | VITD 1 | 6/4/5 | all | **WH-GA zone 4** | GA VITD 3 |
| #2036 | US 891 | MAG 2 | 8/7/2 | all | **WH-NV zone 2** | NV MAG 218 |
| #2037 | CA | MULTI 1 | — | — | **PARTNER INTERNATIONAL (country CA)** | — |
| #2038 | US 900 | VITD 1 | 8/8/4 | all | **WH-NV zone 4** | NV VITD 199 |
| #2039 | US 070 (ZIP+4) | MAG 2 | 1/5/8 | all (NJ has exactly 2) | **WH-NJ zone 1** | NJ MAG 0 |
| #2040 | US 100 | bundle → VITD 1 + MAG 1 | 2/5/8 | GA, NV (NJ ✗ MAG) | **WH-GA zone 5** | GA VITD 2, MAG 148 |
| #2041 | US 891 | VITD 1 + MULTI 1 (edit merged, creation slot) | 8/7/2 | NJ, GA (NV ✗ MULTI) | **WH-GA zone 7** | GA VITD 1, MULTI 298 |
| #2042 | US 968 | VITD 1 | — | — | **PARTNER ZIP_NOT_COVERED (prefix 968)** | — |
| #2043 | US 941 | MAG 1 | 8/8/3 | GA, NV (NJ ✗) | **WH-NV zone 3** | NV MAG 217 |
| #2044 | US 802 | MULTI 1 | 7/6/4 | NJ, GA (NV ✗) | **WH-GA zone 6** | GA MULTI 297 |
| #2045 | US 282 | `nw-mag-90` → MAG 1 | 4/3/7 | GA, NV (NJ ✗) | **WH-GA zone 3** | GA MAG 147 |
| #2046 | US `""` | MULTI 1 | — | — | **PARTNER NO_ZIP** | — |
| #2047 | US 752 | MULTI 3 | 6/4/5 | NJ, GA (NV ✗) | **WH-GA zone 4** | GA MULTI 294 |
| #2048 | US 606 | VITD 1 | 5/5/7 | all (GA has 1) | tie at 5: cover NJ 399/40 = 9.97 > GA 1/30 = 0.03 → **WH-NJ zone 5 (rule 5)** | NJ VITD 398 |
| #2049 | US 331 | MAG 1 | 6/4/8 | GA, NV (NJ ✗) | **WH-GA zone 4** | GA MAG 146 |
| #2050 | US 303 | VITD 2 | 5/1/7 | NJ, NV (GA ✗: has 1) | **WH-NJ zone 5** | NJ VITD 396 |
| #2051 | US 891 | VITD 1 | 8/7/2 | all | **WH-NV zone 2** | NV VITD 198 |
| #2052 | US 981 | MAG 1 | 8/8/5 | GA, NV (NJ ✗) | **WH-NV zone 5** | NV MAG 216 |
| #2053 | US 100 | MULTI 1 | 2/5/8 | NJ, GA (NV ✗) | **WH-NJ zone 2** | NJ MULTI 119 |
| #2054 | US 752 | MAG 1 | 6/4/5 | GA, NV (NJ ✗) | **WH-GA zone 4** | GA MAG 145 |
| #2055 | US 900 | MULTI 1 | 8/8/4 | NJ, GA (NV ✗) | tie at 8: cover GA 294/25 = 11.76 > NJ 119/30 = 3.97 → **WH-GA zone 8 (rule 5)** | GA MULTI 293 |
| #2056 | US 070 | bundle → VITD 1 + MAG 1 | 1/5/8 | GA, NV (NJ ✗ MAG) | **WH-GA zone 5** | GA VITD 0, MAG 144 |

Things to note from the table:
- **Rule 6 never fires** on today's data. Rule 5 decides #2034, #2048 and #2055.
- **WH-GA's 4 VITD units** go to #2035, #2040, #2041 and #2056. #2050 (GA zone 1) needs 2 when GA has only 1 left, so it falls to WH-NJ zone 5. That's the D-14 effect described in analysis §3.
- **WH-NJ's 2 MAG units** go to #2039. After that NJ can't take any MAG or bundle order.
- Totals: 22 to warehouses (NJ 5, GA 12, NV 5), 4 to PARTNER, 26 lines.

The CLI output in step 4 must match this table line by line. If it doesn't, we find out whether the code or the table is wrong before changing either one.
