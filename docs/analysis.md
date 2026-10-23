# Analysis — Part A: order router

Scope: `INSTRUCTIONS.md` Part A, data in `natura-wellness-backend-test 2/*.json` (neither is in this repo: the brief stays private, and the data is copied unchanged into `data/`).
`ops-notes.md` is out of scope for Part A on purpose. It was not read or applied.

Every open point below links to an entry in [decisions.md](decisions.md) (`D-xx`).

**How to read this file:** each record below is *evidence that a class of input exists*. The decisions in decisions.md are general policies for the whole class, implemented in code. They are never fixes for the specific record, and the data files are never edited.

---

## 1. Rules: ambiguities and contradictions

### 1.1 Tension in the brief itself

- **"Apply these rules exactly as given" vs. "the data is real-world messy."** The rules say what to do with a ZIP prefix, a stock level or a zone. They don't say how to read malformed input (a numeric ZIP, a lowercase SKU, a bundle SKU). "Exactly as given" can mean two things. One: take the data at face value too, so anything malformed fails the rules and goes to PARTNER. Two: normalize the data where the intent is clear, then apply the rules exactly. This one choice drives most of D-01…D-05.
- **PARTNER is called "our international partner warehouse"**, but rules 2 and 7 also send domestic US orders there (no ZIP, an uncovered ZIP, no stock). That isn't a contradiction, because the rules are explicit. It is worth knowing that PARTNER is the fallback for every failure, not only for international orders.
- **The intro's goal ("closest warehouse that can ship the whole order") matches rules 3–4.** No conflict.

### 1.2 Rule by rule

| Rule | Text (short) | Ambiguity / gap | Decision |
|---|---|---|---|
| 1 | Outside the US → PARTNER | Which field decides "US"? `shipTo.country` is the obvious one. Case (`us`)? A missing country? `CA` is both the Canada country code (#2037) and the California state code (#2038, #2043, #2055), so the rule must look at `country`, never `state`. | D-06 |
| 2 | No ZIP, or prefix not in zones → PARTNER | "No ZIP": a missing field, `null`, `""`, or whitespace? "First three digits": of what representation? A numeric ZIP (`2134`) loses its leading zero. ZIP+4 (`07030-1834`) works literally. Should anything that isn't a 5-digit US ZIP be rejected? "Isn't in zones.json": zones are listed per warehouse. Today every warehouse has the same 13 prefixes, but the rule doesn't say what happens if a prefix is covered by only some warehouses. | D-01, D-08 |
| 3 | Enabled + enough stock for every item; never split | "Every item": per line, or per SKU summed across lines? (It matters once an edit adds a SKU that's already in the order.) A bundle line: check the bundle SKU or its components? An unknown SKU: stock 0 or invalid order? "Enough": `available >= qty` (equal counts as enough)? | D-02, D-03, D-09 |
| 4 | Lowest zone | A warehouse with no zone entry for the prefix: can't take it? (Not in today's data.) | D-08 |
| 5 | Tie → most days of cover; cover = min over products of available ÷ velocity | Is "available" taken **before** this order's own reservation (as written) or after it? `dailyVelocity = 0` divides by zero (all of WH-TX, which is disabled today). For a bundle, the "products" are presumably its components. | D-10, D-11 |
| 6 | Still tied → WH-NJ, WH-GA, WH-NV, WH-TX | Clear. A warehouse not on the list (none today) has no defined position. | — |
| 7 | Nobody can take it → PARTNER | Clear. Does PARTNER have unlimited stock with no reservation? It is implied but not stated. | D-12 |
| — | Route in creation order; each routed order reserves stock | PARTNER orders reserve nothing from our warehouses (assumed, see D-12). Events with the same timestamp: is the tie-break the file order? | D-13 |
| — | Edits allowed for up to 30 min; route each order once, with everything in it | **When** does an edited order take its place in the queue? (a) In its creation slot, with the edited lines merged in (this reads "route in the order they were created" literally). (b) When its 30-minute window closes. This changes who gets the scarce stock. See §3. Also: is the boundary at exactly 30:00 inclusive? An edit after the window: ignore it, or flag it? An edit for an unknown order, or one timestamped before its creation? | D-04, D-14 |
| Output | "Order number, warehouse (or PARTNER), reason or zone" | The line format isn't specified. Should a warehouse line show only the zone, or also the tie-break that decided it? Should PARTNER reasons be distinct per rule? Which order are the lines printed in? | D-15 |

---

## 2. Data anomalies

Checked: event types, key sets, timestamp order, duplicate order numbers, quantity types, SKU format, ZIP format, non-ASCII characters, and zone and warehouse key sets.

### 2.1 orders.json

| # | Anomaly | Examples (all occurrences) | Rule affected | Decision |
|---|---|---|---|---|
| O-1 | **Numeric ZIP, leading zero lost** | `#2033` `"zip": 2134` (a JSON number, state MA). As written, the prefix is `213` (not in zones → PARTNER). Padded to `02134`, the prefix is `021`, which is in zones. Evidence that padding is what's intended: `021` is the **only** zone prefix that no order uses, and 021xx is Massachusetts, which matches `state: "MA"`. | 2 | D-01 |
| O-2 | **ZIP+4 format** | `#2039` `"07030-1834"`. The literal first 3 chars are `070`, so it works either way. It only matters if we validate the format. | 2 | D-01 |
| O-3 | **Empty ZIP** | `#2046` `"zip": ""` (state NJ). | 2 | D-01 |
| O-4 | **Non-US postal code** | `#2037` `"M5V 2T6"`, country `CA`, state `ON`. Rule 1 catches it before rule 2. | 1 | D-06 |
| O-5 | **Valid US ZIP not covered by zones** | `#2042` `96815` (HI). Prefix `968` is not in zones → PARTNER under rule 2. | 2 | — |
| O-6 | **Lowercase SKU** | `#2045` `"nw-mag-90"`. Not an exact match for any catalog or inventory SKU. Uppercased, it is `NW-MAG-90`. | 3 | D-03 |
| O-7 | **Bundle SKU in an order line** | `#2040` and `#2056` `NW-BNDL-ESS` ×1. No warehouse stocks the bundle SKU. The catalog defines it as `NW-VITD-60`×1 + `NW-MAG-90`×1. | 3, 5 | D-02 |
| O-8 | **Order edit** | `order_edited` `#2041` at 13:48:37 adds `NW-MULTI-30`×1. The order was created at 13:30:37 (VITD×1, NV 891), so the edit came 18 min later, inside the window. WH-NV has 0 MULTI, so the edit changes where #2041 can ship. | timing rule | D-04, D-14 |
| O-9 | **Same timestamp on two events** | The `#2041` edit and the `#2047` creation are both `2026-10-20T13:48:37.000Z`. Harmless if edits are merged, but the sort must be stable. | ordering | D-13 |
| O-10 | **`CA` means two things** | country `CA` = Canada (#2037). State `CA` = California (#2038, #2043, #2055). | 1 | D-06 |
| — | Not anomalies (checked) | Timestamps are already ascending. No duplicate `order_created`. All quantities are positive integers (1–3). There is no non-ASCII content. Only two event types exist: `order_created` and `order_edited`. | — | — |

### 2.2 warehouses.json

| # | Anomaly | Examples | Rule affected | Decision |
|---|---|---|---|---|
| W-1 | **`dailyVelocity: 0`** (cover = x ÷ 0) | WH-TX, all 3 SKUs (500 available each). Unreachable today because WH-TX is disabled, but the code must define it. | 5 | D-11 |
| W-2 | **Disabled warehouse that is still in the priority list** | WH-TX `enabled: false`, but it is listed in rule 6. Not a conflict (rule 3 filters first). | 3, 6 | — |
| W-3 | **Zero stock** | WH-NV `NW-MULTI-30` available 0. | 3 | — |
| W-4 | **Very low stock, contested by several orders** | WH-NJ `NW-MAG-90` = **2**. WH-GA `NW-VITD-60` = **4**. Which orders get them depends on D-01…D-04 (see §3). | 3, reservations | — |
| W-5 | **No bundle SKU in any inventory** | No warehouse lists `NW-BNDL-ESS`. | 3 | D-02 |

### 2.3 zones.json

| # | Anomaly | Examples | Rule affected | Decision |
|---|---|---|---|---|
| Z-1 | **Non-warehouse key mixed in** | `"_note"` (a string) sits beside the warehouse maps. The loader must skip it, not treat it as a warehouse. | 2, 4 | — (loader detail) |
| Z-2 | **Zone ties between enabled warehouses** | `606`: NJ 5 = GA 5 (TX 5, but disabled). This sends #2034 and #2048 to rule 5. Other prefixes have no tie among the enabled warehouses. | 5 | — |
| Z-3 | **Coverage gaps** | Only 13 prefixes. `968` (HI, #2042) is missing. All 4 warehouses have the same prefix set, so the per-warehouse question in D-08 doesn't come up today. | 2 | D-08 |

### 2.4 catalog.json

| # | Anomaly | Examples | Decision |
|---|---|---|---|
| C-1 | **Bundle defined only in the catalog** | `NW-BNDL-ESS` = VITD×1 + MAG×1. This is the only source for expanding a bundle. | D-02 |
| C-2 | `priceCents` is irrelevant to routing | — | — |

---

## 3. Why the decisions interact (reservation cascade)

Stock reservations carry forward, so one interpretation choice can change orders further down the file. Two scarce pools decide most of the outcomes:

- **WH-NJ `NW-MAG-90` (2 units).** #2039 (NJ, MAG×2, zone 1) takes both. After that, any bundle routed through NJ (#2040 to prefix 100, NJ zone 2) can't use NJ. Under bundle expansion it falls to the next zone.
- **WH-GA `NW-VITD-60` (4 units).** Contested by #2035 (TX 752 → GA is the lowest enabled zone), #2040 (if bundles are expanded), #2041 (if the edit is merged: NV loses it because it has 0 MULTI, so GA is next) and #2050 (GA, VITD×2).

Because of this, D-04/D-14 (when an edited order is routed) is more than a formality. Routing #2041 in its creation slot (13:30) vs. at its window close (14:00:37) moves it from before #2050 (13:57) to after it. That can flip which order gets GA's last VITD units.
