# Mortgage Calculator — Specification

A static, client-side mortgage comparison tool hosted on GitHub Pages, focused on US loan types with California-specific cost estimates.

**Status:** Draft for review — no code written yet.

---

## 1. Goals

- Let a user model one or more loan scenarios ("profiles"), see monthly and lifetime costs, and compare them visually.
- Show how down payment size changes total cost.
- Benchmark the user's quoted rate against the latest national average.
- Run entirely in the browser: no backend, no accounts, no tracking.

### Non-goals

- No loan quotes, pre-qualification, or personalized financial advice. The site carries a visible "estimates only, not financial advice" disclaimer.
- No CalHFA / down-payment-assistance program modeling (removed from scope).
- No cross-device sync. Profiles are per-browser (localStorage) with export/import as the escape hatch.

---

## 2. Tech stack & hosting

| Concern | Decision |
|---|---|
| Frontend | Plain HTML + CSS + vanilla JavaScript (ES modules). No framework, no build step required to develop. |
| Charts | Chart.js (vendored locally or via npm, bundled — see hosting) |
| Hosting | GitHub Pages, deployed from the repo (root or `/docs`, or a Pages Actions workflow — decided at implementation) |
| Rate data | GitHub Action on a schedule commits `data/rates.json`; the page fetches it as a static file |
| Persistence | `localStorage` for saved profiles; URL query-string encoding for sharing |
| Tests | Plain JS unit tests for the amortization engine (framework TBD at implementation; the engine is pure functions so anything works) |

The amortization/financial math lives in a dependency-free module (`amortization.js` or similar) with no DOM access, so it is testable in isolation.

---

## 3. Core inputs

**Home price is the primary input; loan amount is derived** (`loan = price − down payment`, plus any financed fees). This is required because property tax and PMI both key off price/LTV, not loan amount.

### Loan inputs
- **Home price** ($)
- **Down payment** — editable as **% or $, linked** (editing one updates the other)
- **Interest rate** (annual %, user-entered)
- **Loan type** (see §4)
- **ARM only:** post-fixed-period rate assumption (see §4.2)
- **Discount points** (0–4 in 0.25 steps, default 0) and **rate reduction per point** (%/point; default **0.25%**, editable). The entered interest rate is treated as the zero-point base rate; the effective rate used for amortization = `base rate − points × reduction`, displayed next to the rate field. Points cost = `points% × loan amount`, paid at closing (not financed).

### Monthly-cost inputs (for full PITI+ view)
- **Property tax rate** (% of purchase price/yr; default **1.15%**, CA-typical under Prop 13)
- **Assessed-value growth** (%/yr; default **2%**, the Prop 13 cap) — drives property tax growth over the loan term
- **Homeowners insurance** ($/yr; default **$2,000**, editable — CA premiums vary widely)
- **HOA dues** ($/mo; default 0)
- **Mello-Roos / special assessments** ($/yr; default 0)
- **PMI rate** (conventional only, %/yr of loan balance; default **0.6%**, editable)
- **Extra monthly payment** ($/mo; default 0)
- **One-time extra payment** ($ + month number; default none)

All defaults are editable and clearly labeled as estimates.

---

## 4. Loan types

### 4.1 Fixed-rate
- 30-year fixed
- 20-year fixed
- 15-year fixed
- 10-year fixed

Standard fully-amortizing fixed loans. Monthly compounding, payment = standard annuity formula.

### 4.2 Adjustable-rate (ARM)
- 5/1, 7/1, 10/1 ARM

The rate is known only for the fixed period. To graph a full term, the user supplies a **post-adjustment rate assumption** (default: initial rate + 2%). The UI renders the post-fixed portion of all graphs in a visually distinct style (e.g. dashed) and labels it "assumed". 

Additionally, the chart offers an optional **band view**: best case (rate stays at initial) vs. worst case (initial + 5% lifetime cap, the common cap structure) to bound the outcome.

Adjustment mechanics are simplified: one rate change at the end of the fixed period, then constant. Periodic caps / annual re-adjustment are out of scope.

### 4.3 Government-backed
- **FHA 30-year**: 
  - Upfront MIP = **1.75%** of base loan, **financed into the loan balance** by default (toggle to pay-at-closing).
  - Annual MIP charged monthly on the loan balance. Rate defaults from the current FHA table based on LTV and loan size (editable). Duration rule modeled: **life of loan if down < 10%; drops after 11 years if down ≥ 10%**.
- **VA 30-year**: 
  - No monthly mortgage insurance.
  - Upfront **funding fee** (default 2.15% first use, editable; toggle for exempt), financed by default.

### 4.4 Mortgage insurance (conventional)
- If down payment < 20%: monthly PMI = `PMI rate × current loan balance / 12`.
- PMI **terminates automatically when LTV reaches 78%** of the original purchase price (scheduled amortization). The termination month is marked on graphs and shown in the summary.

### 4.5 Jumbo awareness
- If the loan amount exceeds the conforming limit, show a non-blocking badge: "Above the conforming limit — jumbo pricing likely applies."
- The conforming limit is stored in `data/limits.json` (baseline + CA high-cost figure) so it can be updated yearly without code changes. Seed values: 2026 baseline ≈ $806,500; high-cost counties up to ~$1.21M.

---

## 5. Calculation engine

Pure-function module. Given a profile, it produces a **month-by-month schedule** for the full term:

Per month: payment, principal, interest, PMI/MIP, extra payment applied, remaining balance, property tax (grown annually per §3), insurance, HOA, Mello-Roos, cumulative totals of each.

Derived summary per profile:
- Monthly **P&I**
- Monthly **all-in cost** (P&I + MI + tax + insurance + HOA + Mello-Roos) — first-month value shown, with note that tax grows
- Total interest paid
- Total MI paid, MI end month
- Total paid (P&I-only view and all-in view; both include upfront points cost at month 0)
- Payoff month (may be earlier than term when extra payments are set)
- **Points break-even**: when points > 0, the engine also runs the same profile at zero points and reports the month where the cumulative cost with points drops below the cumulative cost without ("points pay for themselves in year X.Y"), plus lifetime savings (or loss, if the loan is paid off before break-even)

Rules:
- Monthly compounding: `monthlyRate = annualRate / 12`.
- Extra payments reduce principal immediately; schedule ends when balance hits zero.
- Financed fees (FHA upfront MIP, VA funding fee) increase the amortized balance.
- All currency math done in cents or with careful rounding; final payment adjusts for residual.

---

## 6. UI — four tabs

### Tab 1: Calculator
- Input form (§3) with instant recalculation on change.
- Results panel: monthly P&I, itemized monthly all-in breakdown (stacked bar or table), summary stats (§5).
- **Rate benchmark widget** (§7): latest national average for the matching product, its as-of date, and the delta vs. the entered rate ("Your rate is 0.35% above the national average (30-yr fixed, week of …)").
- **Points panel** (visible when points > 0): points cost, effective rate, monthly savings vs. zero points, break-even month, and a **mini chart** — cumulative cost with points vs. without over time, with the crossover marked.
- **Save as profile** button → prompts for a name, saves to localStorage.
- **Share** button → copies a URL with the profile encoded in the query string; opening such a URL pre-fills the form.

### Tab 2: Compare (graphs)
- **Chart A — Cumulative total paid**: x = time (years), y = cumulative $ paid. One line per selected profile, distinct colors, legend with profile names. Toggle: **P&I only ⇄ all-in cost**. Markers for PMI drop-off and payoff. Profiles with points start at the points cost at month 0 (not $0), so crossovers between a with-points and a without-points profile are visible directly on the chart.
- **Chart B — Principal vs. interest**: stacked area (or toggleable per-month stacked bars) for one selected profile showing where each payment goes over time, including the MI component.
- **Comparison table**: one row per profile — monthly P&I, first-month all-in, total interest, total MI, total paid, payoff date. Best value per column subtly highlighted.
- Profile management: select/deselect for charting, rename, delete, **export all as JSON / import JSON**.

### Tab 3: Down payment explorer
- Fix home price, rate, and loan type; sweep down payment across editable presets (default **3.5%*, 5%, 10%, 15%, 20%, 25%** — 3.5% only for FHA; conventional minimum preset 3%).
- **Chart**: cumulative all-in cost over time, one line per down-payment level, with PMI drop-off markers.
- **Table**: per level — loan amount, monthly P&I, monthly MI, first-month all-in, total MI paid, total paid. Shows clearly where MI disappears (≥ 20%).

### Tab 4: Household split
Answers: "for each person paying into this mortgage, how much spending money do they have left each month after taxes, their mortgage share, and other shared costs?"

- **Mortgage cost source**: pick one saved profile (or the current Calculator inputs); the tab uses its **first-month all-in monthly cost** (P&I + MI + tax + insurance + HOA + Mello-Roos) as the amount to split. A toggle allows P&I-only.
- **People**: add/remove/rename people. Per person:
  - **Income**, entered one of two ways:
    - **Gross annual salary** ($) with **filing status** (single / married filing jointly; default single) and optional **pre-tax deductions** ($/mo — 401k, health premiums; capped at salary) — taxes are then estimated per below; or
    - **Actual take-home pay per two weeks** ($, from a payroll stub) — annualized as ×26 paychecks ÷ 12 months and used directly, bypassing the tax estimate entirely (tax columns show "—"). More accurate when the number is available.
  - **Mortgage share** — either a **% of the monthly cost or a fixed $/mo** (linked fields, same pattern as down payment)
- **Share validation**: shares are shown against the total. If the sum ≠ 100% (or ≠ the full $ amount), a warning banner shows the shortfall/overage — non-blocking, since uneven or partial splits are legitimate.
- **Other shared costs**: an editable list of named monthly costs (seeded with "Internet"; user can add utilities, streaming, etc.). Each cost has its own per-person split (% or $, defaulting to an even split). Costs can also be marked **personal** (assigned wholly to one person, e.g. a car payment).
- **Tax estimate** (per person, monthly):
  - Federal income tax: bracket math on (salary − pre-tax deductions − standard deduction) for the chosen filing status.
  - California income tax: same approach with CA brackets and CA standard deduction, plus CA SDI.
  - FICA: Social Security (with wage cap) + Medicare (incl. additional Medicare tax above threshold).
  - Brackets, deductions, caps, and rates live in **`data/tax.json`** (tax-year stamped, manually updated yearly like `limits.json`).
  - Simplifications: no itemizing, no credits, no dependents, W-2 wage income only. The mortgage-interest deduction is **not** applied. Labeled clearly: "rough estimate — not tax advice."
- **Results table**, one row per person: gross monthly → estimated taxes → take-home → mortgage share → other costs → **spending money / mo**. A red highlight if spending money is negative.
- **Chart**: per-person stacked bar (taxes / mortgage share / other costs / spending money) so contributions and leftovers are comparable at a glance.
- **Persistence**: people and shared costs saved to localStorage (`mortgage-calc:household:v1`), included in JSON export/import.

### General UI
- Responsive single-page app; tabs are client-side (no page reloads).
- Currency/percent formatting via `Intl.NumberFormat`.
- Disclaimer footer on every tab.

---

## 7. Rate benchmark data (GitHub Actions)

- **Source**: FRED series for Freddie Mac PMMS weekly national averages — `MORTGAGE30US` (30-yr fixed) and `MORTGAGE15US` (15-yr fixed). These are weekly national averages for conforming loans; the UI labels them as such.
- **Pipeline**: a scheduled GitHub Action (daily; PMMS updates weekly on Thursdays) fetches the latest observations using a FRED API key stored as a **repo secret**, writes `data/rates.json`, and commits only when values changed.
- `rates.json` shape:

```json
{
  "updated": "2026-08-20",
  "series": {
    "MORTGAGE30US": { "label": "30-yr fixed (US avg)", "rate": 6.35, "asOf": "2026-08-14" },
    "MORTGAGE15US": { "label": "15-yr fixed (US avg)", "rate": 5.62, "asOf": "2026-08-14" }
  }
}
```

- The page fetches this file same-origin (no CORS, no exposed key). If the fetch fails or the file is stale (> 21 days), the widget shows "benchmark unavailable" rather than a wrong number.
- Products without a PMMS series (20-yr, 10-yr, ARMs, FHA, VA) fall back to the 30-yr or 15-yr benchmark with a "closest benchmark" note.
- A "refresh" button on the widget simply re-fetches `rates.json` (cache-busted); it cannot fetch FRED directly.

---

## 8. Persistence & sharing

- **localStorage** key `mortgage-calc:profiles:v1` → array of profile objects `{ id, name, createdAt, inputs: {…} }`. Versioned so the schema can migrate.
- **Export/import**: download/upload the profile array as a JSON file.
- **Share URLs**: profile inputs serialized into the query string (compact keys, no personal data beyond the numbers themselves). Loading a shared URL fills the form but does **not** auto-save.

---

## 9. Repository layout (proposed)

```
/
├── index.html
├── css/style.css
├── js/
│   ├── amortization.js     # pure math engine
│   ├── loanTypes.js        # per-type rules (MI, fees, ARM logic)
│   ├── charts.js           # Chart.js wiring
│   ├── profiles.js         # localStorage + import/export + URL codec
│   ├── rates.js            # rates.json fetch + benchmark widget
│   ├── taxes.js            # pure federal/CA/FICA estimate engine
│   ├── household.js        # people, cost splits, spending-money calc
│   └── main.js             # UI glue, tabs, form binding
├── data/
│   ├── rates.json          # committed by the Action
│   ├── limits.json         # conforming limits, FHA MIP table (yearly manual update)
│   └── tax.json            # federal + CA brackets, deductions, FICA params (yearly manual update)
├── test/                   # engine unit tests
└── .github/workflows/
    ├── update-rates.yml    # scheduled rate fetch
    └── pages.yml           # Pages deploy (if not deploying from branch directly)
```

---

## 10. Phasing

### v1 — core loop
- Fixed-rate loans (30/20/15/10)
- Full PITI+ monthly cost model incl. conventional PMI with 78% drop-off
- Calculator tab + Compare tab (both charts, comparison table)
- Profiles: save/rename/delete, localStorage
- Rate benchmark widget + GitHub Action pipeline
- Jumbo badge, disclaimer, engine unit tests

### v2 — breadth
- ARMs (5/1, 7/1, 10/1) with assumption input and best/worst band
- FHA and VA with upfront/annual fee mechanics
- Down payment explorer tab
- Extra payments (monthly + one-time) with early-payoff handling
- Share URLs, JSON export/import
- Household split tab (people, tax estimates, cost splits) with `tax.json` + tax engine unit tests
- Discount points: effective-rate input, upfront cost in cumulative totals, break-even panel + mini chart

---

## 11. Known limitations (by design)

- Benchmark is a weekly national conforming average, not a live or state-level quote.
- ARM modeling uses a single user-supplied post-fixed rate (plus an optional cap band), not full cap/index simulation.
- Property tax model is simplified Prop 13 (fixed rate on assessed value growing ≤ 2%/yr); supplemental assessments, exemptions, and transfer taxes are ignored.
- Closing costs other than financed FHA/VA fees and discount points are not modeled.
- Points pricing is assumed linear (a fixed rate reduction per point); real lender pricing is nonlinear and varies daily, so the per-point reduction is a user-editable assumption. Points are modeled as paid at closing, never financed, and any tax deductibility of points is ignored.
- No CalHFA or down-payment-assistance programs.
- Tax estimates assume W-2 wage income, standard deduction, no credits/dependents/itemizing, and single-state (CA) residency; they are rough planning numbers, not tax advice.
- The household split uses the first-month all-in cost; it does not re-split as property tax grows or PMI drops off (the mortgage tabs cover that time dimension).
