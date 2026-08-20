# Mortgage Calculator — Setup & Usage

A static mortgage comparison tool that runs entirely in the browser. No backend, no accounts,
no build step. See [SPEC.md](SPEC.md) for the full feature specification.

---

## 1. Deploy to GitHub Pages

### One-time setup

1. **Create a GitHub repository** and push this project to it:

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```

2. **Enable GitHub Pages**: on GitHub, open the repo → **Settings → Pages** →
   under *Build and deployment*, set **Source** to `Deploy from a branch`, pick branch
   **`main`** and folder **`/ (root)`**, and save. After a minute or two the site is live at
   `https://<your-username>.github.io/<repo-name>/`.

3. **Set up the rate-benchmark feed** (the "National average" widget shows *Benchmark
   unavailable* until this runs):
   1. Get a free FRED API key: <https://fred.stlouisfed.org/docs/api/api_key.html>
      (create a free account, request a key — instant).
   2. In the repo: **Settings → Secrets and variables → Actions → New repository secret**.
      Name it exactly `FRED_API_KEY`, paste the key.
   3. Make sure Actions can push: **Settings → Actions → General → Workflow permissions** →
      select **Read and write permissions**.
   4. Trigger the first run manually: **Actions → Update mortgage rates → Run workflow**.
      It fetches the latest Freddie Mac PMMS weekly averages (30-yr and 15-yr fixed) from FRED,
      writes `data/rates.json`, and commits it. After that it runs daily on its own and only
      commits when the weekly numbers actually change.

That's it. Every later `git push` to `main` redeploys the site automatically.

### Run locally

The page loads its JSON data with `fetch`, so it must be served over HTTP (opening
`index.html` directly from disk won't work). From the project folder:

```bash
python -m http.server 8321
```

then open <http://localhost:8321>. Any static server works (`npx serve`, etc.).

### Run the tests

The financial and tax engines have unit tests (Node 20+):

```bash
npm test
```

---

## 2. Using the tool

All four tabs recalculate instantly as you type. Everything is an **estimate** — verify with
your lender and a tax professional.

### Tab 1 — Calculator

- Enter **home price** and **down payment** (the % and $ fields are linked — edit either).
  The loan amount is derived from these.
- Pick a **loan type**: fixed terms (30/20/15/10-yr), ARMs (5/1, 7/1, 10/1), FHA, or VA.
  - **ARM**: the rate after the fixed period is unknown, so an assumption field appears
    (blank = your rate + 2%). Post-fixed-period portions of graphs are drawn dashed.
  - **FHA**: 1.75% upfront MIP is financed into the loan by default; annual MIP is auto-set
    from LTV (editable) and lasts the life of the loan when you put less than 10% down.
  - **VA**: no monthly mortgage insurance; a funding fee (default 2.15%) is financed by
    default, with an exemption checkbox.
  - **Conventional with <20% down**: a PMI field appears; PMI drops automatically when the
    balance reaches 78% of the purchase price.
- **Points**: buying discount points lowers your rate (default 0.25% per point, editable —
  match your lender's actual quote). The break-even panel shows the upfront cost, monthly
  savings, when the points pay for themselves, and a with/without mini-chart.
- **Monthly costs**: property tax (CA Prop 13 style — % of price, assessed value growing
  2%/yr), home insurance, HOA, and Mello-Roos feed the "all-in" monthly figure.
- **Extra payments**: a recurring monthly amount and/or a one-time payment at a chosen month;
  the loan then pays off early.
- **National average**: compares your rate against the latest Freddie Mac weekly national
  average (30-yr or 15-yr, whichever is closest to your loan type). Data older than 3 weeks
  shows as unavailable.
- **Save as profile** stores the current inputs in your browser (localStorage — per-browser,
  not synced). **Copy share link** puts every input into a URL you can send to someone.

### Tab 2 — Compare

- Check/uncheck profiles to overlay them on the **cumulative total paid** graph
  (x = years, y = total $ paid). Lines start at the upfront points/fee cost; triangles mark
  mortgage-insurance drop-off; squares mark early payoff.
- Toggle between **all-in cost** (with taxes/insurance/etc.) and **P&I only**.
- **ARM best/worst band** adds dashed bounds for ARM profiles: rate holds vs. rate jumps to
  the typical +5% lifetime cap.
- The **principal vs. interest** chart shows where each month's payment goes for one profile.
- The comparison table highlights the best (lowest) value in each column.
- **Export/Import JSON** backs up profiles and household data or moves them between browsers.

### Tab 3 — Down payment

Fix a price, rate, and loan type, then sweep down-payment levels (edit the comma-separated
list). The chart overlays cumulative all-in cost per level; the table shows monthly payment,
PMI amount, when PMI ends, and lifetime totals — so you can see exactly what putting more
down buys you. Other cost assumptions are inherited from the Calculator tab.

### Tab 4 — Household split

Answers: *how much spending money does each person have left per month?*

- Pick which mortgage to split (a saved profile or the current Calculator inputs), all-in or
  P&I only.
- Add **people**. Income can be entered two ways (per person):
  - **Gross salary /yr** with filing status and optional pre-tax deductions ($/mo, e.g.
    401k) — taxes are then estimated; or
  - **Take-home / 2 wks** — the actual net amount from a payroll stub, annualized as
    ×26 paychecks ÷ 12 months and used directly. No tax estimate is applied (those columns
    show "—"). Use this when you have a real paycheck number; it's more accurate.
  Each person also gets a mortgage share as **% of the payment or a fixed $/mo**. If shares
  don't cover the full payment a warning shows the gap (partial splits are allowed).
- Add **other costs** (seeded with Internet): each can be split evenly, by custom
  percentages, or assigned entirely to one person (e.g. a car payment).
- The table shows per person: gross → estimated taxes → take-home → mortgage share → other
  costs → **spending money** (red if negative), with a stacked-bar chart alongside.
- Taxes are a **rough estimate**: federal + California brackets, CA SDI, Social Security and
  Medicare, standard deduction, W-2 wages only — no credits, dependents, or itemizing (the
  mortgage-interest deduction is deliberately not applied). Not tax advice.

---

## 3. Yearly maintenance

Two data files hold numbers that change annually — update them by editing the JSON and
pushing (no code changes needed):

| File | What's in it | Update from |
|---|---|---|
| `data/limits.json` | Conforming loan limits (jumbo badge), FHA MIP rates, VA funding fees | FHFA announcement (Nov), HUD, VA |
| `data/tax.json` | Federal + CA brackets, standard deductions, FICA wage base, SDI rate | IRS inflation adjustment, CA FTB, SSA, EDD |

`data/rates.json` is maintained automatically by the GitHub Action.

---

## 4. Notes & troubleshooting

- **"Benchmark unavailable"** — the rates file is missing or stale. Check that the
  `FRED_API_KEY` secret is set and run the *Update mortgage rates* workflow manually
  (Actions tab). The refresh button on the page only re-reads the committed file; the
  browser never calls FRED directly (no key exposure, no CORS).
- **Profiles disappeared** — profiles live in the browser's localStorage, so they're
  per-browser and per-device. Use Export JSON to back them up, Import JSON to restore.
- **Charts library** — Chart.js is loaded from the jsDelivr CDN (pinned version) in
  `index.html`. To make the site fully offline/self-contained, download
  `chart.umd.min.js` into `js/vendor/` and point the `<script>` tag there.
- **Known simplifications** are listed in [SPEC.md §11](SPEC.md) — ARM caps, points pricing
  linearity, Prop 13 nuances, and the tax-model assumptions.
