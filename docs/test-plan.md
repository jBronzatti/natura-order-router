# Test plan — Part A: order router

Tests come first. Each test uses a **small inline fixture** (a minimal set of warehouses, zones, catalog and events), so it checks exactly one rule. The real data files are only used by the acceptance suite (§9).

Columns: **ID** · **Scenario** · **Expected** · **Depends on** (the decisions in [decisions.md](decisions.md); the expected values may change once a decision is settled).

A shared baseline fixture unless a test says otherwise:
- 2 enabled warehouses, `A` and `B`, each with SKU `X` (available 10, velocity 1), plus a priority list `[A, B]`.
- Zones: prefix `100` → A 1, B 2. Prefix `200` → A 3, B 3.

---

## 1. Rule 1: international → PARTNER

| ID | Scenario | Expected | Depends on |
|---|---|---|---|
| R1-1 | country `CA`, any ZIP | PARTNER, reason international | — |
| R1-2 | country `CA`, but its ZIP prefix exists in zones | Still PARTNER (rule 1 beats rule 2/4) | — |
| R1-3 | country `US`, state `CA` (California) | Not caught by rule 1 | D-06 |
| R1-4 | country `us` (lower case) / `" US "` | Treated as US (D-03 normalization) | D-03, D-06 |
| R1-5 | country missing / `null` / `""` / a number / no `shipTo` at all (table-driven) | PARTNER `NO_COUNTRY` | D-06 |
| R1-6 | international order with an empty ZIP | `INTERNATIONAL`, not `NO_ZIP` (rule 1 is checked first) | — |
| R1-7 | country `USA` / `United States` / `United States of America` (any case) | Domestic (aliases accepted after normalization) | D-06 |

## 2. Rule 2: ZIP → PARTNER

D-01 is DECIDED: rule 2 is applied literally. Strings (trimmed) and numbers (as text) give a prefix = their first 3 characters, looked up in zones, with no repair. Any other type → `NO_ZIP`. The tests are table-driven. The baseline fixture's zones contain `100` and `200`.

| ID | Input class (example values) | Expected | Depends on |
|---|---|---|---|
| R2-1 | missing / `null` / `""` / `"   "` | PARTNER `NO_ZIP` | D-01, D-03 |
| R2-2 | string whose first 3 characters are a zones key (`"10001"`, `"10001-1234"`, `"100"`, `"100AB"`, `" 10001 "`) | prefix `100` → rule 3 | D-01, D-03 |
| R2-3 | string whose first 3 characters are not a zones key (`"96815"`, `"2134"`, `"M5V 2T6"`, `"1-0001"`) | PARTNER `ZIP_NOT_COVERED` | D-01 |
| R2-4 | number whose text starts with a zones key (`10001`) | prefix `100` → rule 3 | D-01 |
| R2-5 | number whose text doesn't (`2134` → `"213"`, `0`, `-100`, `NaN`) | PARTNER `ZIP_NOT_COVERED`, no padding | D-01 |
| R2-6 | other types (`true`, `{}`, `[]`, `[100]`) | PARTNER `NO_ZIP`. `[100]` must **not** match `100` | D-01 |
| R2-7 | the prefix exists only in B's zone map | B is eligible, A is not | D-08 |
| R2-8 | a prefix covered by no valid warehouse (only by a disabled-for-structure one) | PARTNER `ZIP_NOT_COVERED` | D-08, D-22 |

## 3. Rule 3: eligibility (enabled + stock, no split)

| ID | Scenario | Expected | Depends on |
|---|---|---|---|
| R3-1 | A is disabled, A has the better zone | B | — |
| R3-2 | available == quantity | Eligible (equal is enough) | D-09 |
| R3-3 | available == quantity − 1 | Not eligible | — |
| R3-4 | 2 SKUs: A has both, B is short on one | A (even if B had the better zone) | — |
| R3-5 | Order needs X and Y. A has only X, B has only Y | PARTNER (never split) | — |
| R3-6 | Same SKU on two lines (2 + 2), available 3 | Not eligible (quantities are summed) | D-09 |
| R3-7 | SKU missing from a warehouse's inventory | That warehouse is not eligible | D-05 |
| R3-8 | Bundle line ×2 → components X×1, Y×1 per bundle | Checked as X 2, Y 2 | D-02 |
| R3-9 | Bundle + a loose component in the same order (bundle(X,Y) + X×1) | Checked as X 2, Y 1 | D-02, D-09 |
| R3-10 | SKU casing/whitespace in order and edit lines (`"x"`, `" X "`, `"x "`) | All match `X` | D-03 |
| R3-11 | SKU casing in reference data (inventory key `x`, catalog `X`, bundle component `" x"`) | They all match | D-03 |
| R3-12 | SKU not in the catalog (also a SKU that's only in inventory, not in the catalog) | PARTNER `UNKNOWN_SKU` | D-05 |
| R3-13 | SKU in the catalog but missing from one warehouse's inventory | That warehouse counts it as 0. Not an error | D-05 |
| R3-14 | Bundle ×2 whose component quantity is 2 → component ×4 | Checked as 4 | D-02 |

## 4. Rule 4: lowest zone

| ID | Scenario | Expected | Depends on |
|---|---|---|---|
| R4-1 | prefix `100`: A zone 1, B zone 2, both eligible | A, zone 1 | — |
| R4-2 | the warehouse with the lower zone isn't eligible | The next-lowest eligible warehouse | — |
| R4-3 | the lower zone belongs to the later warehouse in priority order (B 1, A 2) | B (zone beats priority) | — |

## 5. Rule 5: tie → most days of cover

| ID | Scenario | Expected | Depends on |
|---|---|---|---|
| R5-1 | Same zone. A: X 10/1 = 10d. B: X 30/1 = 30d | B | — |
| R5-2 | Multi-SKU: A covers X 100d, Y 1d (min 1). B covers X 5d, Y 5d (min 5) | B (it compares the **minimum**) | — |
| R5-3 | Cover uses the stock **left after earlier orders' reservations** | After order 1 drains B, order 2's tie goes to A | — |
| R5-4 | Cover taken before vs after this order's own quantity (a case where the two give different winners) | The D-10 option wins | D-10 |
| R5-5 | velocity 0 at A (available > 0), velocity > 0 at B | A (cover = ∞) | D-11 |
| R5-6 | Bundle order: cover is computed over the component SKUs | — | D-02 |
| R5-7 | Cover equal down to the float (e.g. 3/30 vs 1/10) | Treated as a tie → rule 6 | — |

## 6. Rule 6: priority NJ → GA → NV → TX

| ID | Scenario | Expected | Depends on |
|---|---|---|---|
| R6-1 | Real codes, same zone, same cover: WH-GA vs WH-NV | WH-GA | — |
| R6-2 | Same tie across all four (TX enabled in the fixture) | WH-NJ | — |
| R6-3 | Same tie, WH-NJ not eligible | WH-GA | — |

## 7. Rule 7: nobody can take it → PARTNER

| ID | Scenario | Expected | Depends on |
|---|---|---|---|
| R7-1 | Every warehouse is short | PARTNER, reason no warehouse can fill the order | — |
| R7-2 | Every warehouse is disabled | PARTNER, same reason | — |
| R7-3 | A PARTNER order doesn't reserve stock | A later identical order that fits still gets the warehouse | D-12 |

## 8. Ordering, reservation and edits

| ID | Scenario | Expected | Depends on |
|---|---|---|---|
| S-1 | Reservation: A has X 1. Two orders for X×1, both nearest to A | Order 1 → A, order 2 → B | — |
| S-2 | Events out of order in the file (a later `at` comes first) | Routed by `at` | D-13 |
| S-3 | Two creations with the same `at` | File order is kept | D-13 |
| S-4 | An edit within the window adds a SKU that only B has | The order goes to B (routed once, with the edit merged) | D-04 |
| S-5 | Edit at exactly +30:00 | Merged (if inclusive) | D-14 |
| S-6 | Edit at +30:01 | Ignored (+ a warning) | D-14 |
| S-7 | Edit for an unknown order number | Ignored + a warning | D-14 |
| S-7b | Edit timestamped before its creation / with an unparseable `at` | Ignored + a warning | D-14 |
| S-7c | In-window edit with an invalid line | Same as an invalid creation line (D-18) | D-14, D-18 |
| S-8 | Edit adds a SKU that's already in the order | Quantities summed (see R3-6) | D-09 |
| S-9 | **Slot timing**: order P (created at t0, edited at t0+10m) and order Q (created at t0+5m) compete for the same last unit | P's slot is t0 (option A) → P wins. At window close (option B) → Q wins | D-14 |
| S-10 | Two edits on the same order | Both merged | D-04 |
| S-11 | Exactly one output line per `order_created`. Edits produce no line of their own | — | D-15 |

## 9. Output and acceptance

| ID | Scenario | Expected | Depends on |
|---|---|---|---|
| O-1 | Warehouse route decided by zone alone | `#n  WH-X    zone N`, no parentheses | D-15 |
| O-2 | Route decided by rule 5 | `(tie rule 5: cover A x.xxd > B y.yyd)` | D-15 |
| O-3 | Route decided by rule 6 | `(tie rule 6: cover A x = B x, priority A > B)` | D-15 |
| O-4 | Rule 5 win where both covers print the same at 2 decimals (e.g. 1.004 vs 1.001) | Shows `>`, not `=`, and says `rule 5` | D-15 |
| O-5 | Infinite cover (velocity 0) | Printed as `inf` | D-11, D-15 |
| O-6 | 3-way tie | All tied warehouses listed in the order they ranked | D-15 |
| O-7 | One case per PARTNER reason code | Code + a short detail in parentheses, matching D-15 | D-15 |
| O-8 | The same output goes to stdout and to `routes.txt` at the repo root; warnings go only to stderr | Identical content; `routes.txt` has no warnings | D-15, D-17 |
| O-9 | The data folder is given as an argument / no argument given | Reads from that folder / from `data/` | D-17 |
| ACC-1 | Run on the real files | Matches a **golden file** of 26 lines. Each line is hand-verified in a table (zone, cover, remaining stock) before it's committed, so the golden file is never just "whatever the code printed" | all |
| ACC-2 | The real data doesn't get mutated (warehouses.json stays unchanged on disk and in memory between runs) | — | — |

## 10. Robustness: order events never crash the run (D-00)

All tests here also check that the run still finishes, that every other order still routes, and that a warning goes to stderr.

| ID | Input class (example values) | Expected | Depends on |
|---|---|---|---|
| V-1 | `quantity` is `0`, `-1`, `1.5`, `NaN`, `"2"`, or missing | PARTNER `INVALID_ORDER` (no line is dropped, no conversion) | D-18 |
| V-2 | `sku` is missing, `""`, `null`, or `42` | PARTNER `INVALID_ORDER` | D-18 |
| V-3 | `lines` is missing, `[]`, or `"abc"` | PARTNER `INVALID_ORDER` | D-18 |
| V-4 | an invalid order reserves no stock | A later valid order still gets the stock | D-18 |
| V-5 | `orderNumber` is missing, `""`, or `42` | No output line + a warning | D-19 |
| V-6 | duplicate `order_created` for the same number | First wins, later ones ignored + a warning | D-19 |
| V-7 | event `type` is unknown / the event is not an object (`null`, `"x"`) | Ignored + a warning | D-20 |
| V-8 | `at` is missing or unparseable on a creation | PARTNER `INVALID_ORDER`, no reservation | D-13 |

## 11. Reference data: drop only the broken part (D-00, D-22)

**Isolation cases (L-1…L-16).** Each asserts that a warning names the file, the entry and the field, that the run goes on, and that unaffected warehouses and orders route exactly as they would with clean data.

| ID | Input class | Expected | Depends on |
|---|---|---|---|
| L-1 | a warehouse entry that isn't an object / has a missing, empty or non-string `code` | Entry skipped | D-22 |
| L-2 | two entries with the same `code`, identical content | One kept, routes normally | D-22 |
| L-3 | two entries with the same `code`, differing in any field | Both disabled; never picked | D-22 |
| L-4 | `enabled` missing / not a boolean | That warehouse disabled | D-22 |
| L-5 | `inventory` not an object (`null`, `[]`, `"x"`) | That warehouse disabled | D-22 |
| L-6 | one inventory line with `available` negative / a float / not a number | Only that SKU is missing there: orders for other SKUs can still go to it | D-22 |
| L-7 | one inventory line with `dailyVelocity` negative / `NaN` / `Infinity` / not a number | Same as L-6 | D-11, D-22 |
| L-8 | two inventory keys collapsing to one SKU (`X`, `x`): identical / different | One kept / that SKU dropped at that warehouse | D-03, D-22 |
| L-9 | a warehouse with no zone map / a map that isn't an object | It can't take any order; it is still "valid" for the stop check | D-08, D-22 |
| L-10 | one zone entry with a bad value (0, negative, float, not a number) or a bad prefix key | Only that prefix is missing for that warehouse | D-08, D-22 |
| L-11 | non-warehouse keys in zones (`_note`, an unknown code) | Ignored (a warning only for object values) | D-22 |
| L-12 | catalog entries collapsing to one SKU (also bundle SKU = product SKU): identical / different | One kept / orders with that SKU → PARTNER `INVALID_CATALOG_ITEM`, other orders unaffected | D-03, D-22 |
| L-13 | a bundle with an unknown/invalid component, an empty component list, a component qty ≤ 0, or a nested bundle | Orders with that bundle → PARTNER `INVALID_CATALOG_ITEM` | D-02, D-22 |
| L-14 | a catalog entry with a missing/empty SKU | Skipped | D-22 |
| L-15 | an enabled warehouse missing from the priority list | Ordered after the listed ones + a warning | D-21 |
| L-16 | `catalog.bundles` missing | No bundles. Not an error | D-22 |

**Stop and whole-run cases (L-17…L-19).**

| ID | Input class | Expected | Depends on |
|---|---|---|---|
| L-17 | any input file missing / invalid JSON / the wrong top-level shape | The run stops: non-zero exit, a clear error, no routing output | D-00, D-22 |
| L-18 | no structurally valid warehouse left | The run stops, as L-17 | D-00, D-22 |
| L-19 | every warehouse is valid but `enabled: false` | **No stop.** Every order → PARTNER `NO_WAREHOUSE`, plus one warning | D-00 |

---

### Notes
- ACC-1 is the main safeguard against AI-generated mistakes. The expected routes get worked out by hand (as a table in the implementation plan) **before** the code exists. A mismatch then means the code or our reasoning is wrong, and we look at it instead of updating the golden file.
- R5-7 is only a guard: dividing exact integers in IEEE arithmetic is correctly rounded, so equal ratios produce equal doubles.
