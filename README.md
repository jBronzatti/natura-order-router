# Natura order router

My solution to Part A of the Natura Wellness order-routing test. A TypeScript script routes every order in `data/orders.json` to one warehouse or to PARTNER, and prints one line per order. The output is in [`routes.txt`](routes.txt).

Part A only: as the brief says, `ops-notes.md` is not applied here.

## Run it

Needs Node 22.12+, 24 or 26+ (I used Node 24).

```
npm install
npm run route              # reads data/, prints the routes, writes routes.txt
npm run route -- <folder>  # same, with another data folder (still overwrites routes.txt)
npm test
```

Warnings go to stderr, so `routes.txt` only contains routes.

## Output

```
#2031  WH-NJ    zone 1
#2034  WH-GA    zone 5 (tie rule 5: cover WH-GA 10.00d > WH-NJ 0.10d)
#2037  PARTNER  INTERNATIONAL (country CA)
```

A warehouse line shows the zone, plus the tie-break when rule 5 or 6 decided it. A PARTNER line shows a reason code and a short detail.

## How I worked

- **Decisions came first.** Before any code, I listed what was ambiguous in the rules and every anomaly in the data, then decided each one as a general policy for that kind of input, not as a fix for one record. The data files are copied unchanged.
- **Tests before code.** The core tests (one per rule, plus bundles, edits and reservation order) were written and failing before the router existed.
- **The 26 expected routes were worked out by hand before the code**, order by order with the stock left after each. The script's output had to match them line by line, and that table is now the golden file the acceptance test checks.
- **An independent session reviewed the code** and recalculated the routes by hand. Each finding was either fixed or recorded as a known issue.

## The decisions that matter most

- Rule 2 is applied literally: the ZIP `2134` (a number that lost its leading zero) gives prefix `213`, which isn't covered, so #2033 goes to PARTNER.
- Bundles are expanded into their components using the catalog.
- SKUs and countries are trimmed and upper-cased, so `nw-mag-90` is `NW-MAG-90`. `USA` and `United States` count as the US.
- An edited order is routed once, in its creation slot, with its edits merged in. This is why #2050 ends up at WH-NJ: the edit adds a Multivitamin that WH-NV doesn't stock, so #2041 goes to WH-GA and, routed at 13:30, takes a Vitamin D unit before #2050 (13:57) needs two.
- Bad order data never crashes the run: the order goes to PARTNER with a reason. Bad warehouse or catalog data only removes the broken part, with a warning; the run stops only if a file can't be read or no usable warehouse is left.

## Details

- [docs/analysis.md](docs/analysis.md): ambiguities in the rules and anomalies in the data
- [docs/decisions.md](docs/decisions.md): every decision, the small defaults, and the known issues
- [docs/implementation-plan.md](docs/implementation-plan.md): module layout and the hand-worked routes
- [docs/test-plan.md](docs/test-plan.md): the full test plan (only part of it is implemented, see the known issues)
