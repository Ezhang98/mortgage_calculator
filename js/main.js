// UI glue: tabs, form binding, rendering. All math lives in the engine modules.

import { LOAN_TYPES, isArm } from './loanTypes.js';
import {
  buildSchedule, pointsBreakEven, resolveLoan, effectiveRate, fhaAutoAnnualMip,
} from './amortization.js';
import * as store from './profiles.js';
import { fetchRates, renderBenchmark } from './rates.js';
import {
  renderCumulativeChart, renderBreakdownChart, renderHouseholdChart, seriesColor, usd,
} from './charts.js';
import { computeHousehold } from './household.js';

const $ = (id) => document.getElementById(id);
const num = (id, fallback = 0) => {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : fallback;
};
const numOrNull = (id) => {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : null;
};

let limits = null;
let taxData = null;
let ratesData = null;
let lastDownEdited = 'percent';
let household = store.loadHousehold();
let activeTab = 'calculator';
let selectedProfileIds = null; // lazily initialized Set for the Compare tab

// ---------------- input handling ----------------

function readInputs() {
  return {
    homePrice: num('in-homePrice'),
    downMode: lastDownEdited,
    downPercent: num('in-downPercent'),
    downDollars: num('in-downDollars'),
    ratePct: num('in-ratePct'),
    loanType: $('in-loanType').value,
    armPostRatePct: numOrNull('in-armPostRatePct'),
    points: num('in-points'),
    pointReductionPct: num('in-pointReductionPct', 0.25),
    propTaxPct: num('in-propTaxPct'),
    assessedGrowthPct: num('in-assessedGrowthPct'),
    insuranceAnnual: num('in-insuranceAnnual'),
    hoaMonthly: num('in-hoaMonthly'),
    melloRoosAnnual: num('in-melloRoosAnnual'),
    pmiRatePct: num('in-pmiRatePct'),
    fhaAnnualMipPct: numOrNull('in-fhaAnnualMipPct'),
    fhaFinanceUpfront: $('in-fhaFinanceUpfront').checked,
    vaFundingFeePct: num('in-vaFundingFeePct', 2.15),
    vaExempt: $('in-vaExempt').checked,
    vaFinanceFee: $('in-vaFinanceFee').checked,
    extraMonthly: num('in-extraMonthly'),
    extraOnceAmount: num('in-extraOnceAmount'),
    extraOnceMonth: num('in-extraOnceMonth', 12),
  };
}

// Resolve the linked %/$ down payment into engine dollars.
function normalize(inputs) {
  const downDollars =
    inputs.downMode === 'dollars'
      ? inputs.downDollars
      : (inputs.homePrice * inputs.downPercent) / 100;
  return { ...inputs, downDollars };
}

function writeInputs(inputs) {
  const set = (id, v) => { if (v !== undefined && v !== null) $(id).value = v; };
  set('in-homePrice', inputs.homePrice);
  set('in-downPercent', inputs.downPercent);
  set('in-downDollars', inputs.downDollars);
  set('in-ratePct', inputs.ratePct);
  if (inputs.loanType && LOAN_TYPES[inputs.loanType]) $('in-loanType').value = inputs.loanType;
  set('in-armPostRatePct', inputs.armPostRatePct);
  set('in-points', inputs.points);
  set('in-pointReductionPct', inputs.pointReductionPct);
  set('in-propTaxPct', inputs.propTaxPct);
  set('in-assessedGrowthPct', inputs.assessedGrowthPct);
  set('in-insuranceAnnual', inputs.insuranceAnnual);
  set('in-hoaMonthly', inputs.hoaMonthly);
  set('in-melloRoosAnnual', inputs.melloRoosAnnual);
  set('in-pmiRatePct', inputs.pmiRatePct);
  set('in-fhaAnnualMipPct', inputs.fhaAnnualMipPct);
  if (inputs.fhaFinanceUpfront !== undefined) $('in-fhaFinanceUpfront').checked = inputs.fhaFinanceUpfront;
  set('in-vaFundingFeePct', inputs.vaFundingFeePct);
  if (inputs.vaExempt !== undefined) $('in-vaExempt').checked = inputs.vaExempt;
  if (inputs.vaFinanceFee !== undefined) $('in-vaFinanceFee').checked = inputs.vaFinanceFee;
  set('in-extraMonthly', inputs.extraMonthly);
  set('in-extraOnceAmount', inputs.extraOnceAmount);
  set('in-extraOnceMonth', inputs.extraOnceMonth);
  if (inputs.downMode) lastDownEdited = inputs.downMode === 'dollars' ? 'dollars' : 'percent';
  syncDown();
}

function syncDown() {
  const price = num('in-homePrice');
  if (price <= 0) return;
  if (lastDownEdited === 'percent') {
    $('in-downDollars').value = Math.round((price * num('in-downPercent')) / 100);
  } else {
    $('in-downPercent').value = ((num('in-downDollars') / price) * 100).toFixed(2);
  }
}

// ---------------- formatting ----------------

const pctFmt = (v, d = 2) => `${v.toFixed(d)}%`;
function yearsLabel(months) {
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m === 0 ? `${y} yr` : `${y} yr ${m} mo`;
}

// ---------------- Tab 1: Calculator ----------------

function updateSectionVisibility(p) {
  const lt = LOAN_TYPES[p.loanType];
  $('sec-arm').classList.toggle('hidden', !isArm(p.loanType));
  $('sec-fha').classList.toggle('hidden', lt.kind !== 'fha');
  $('sec-va').classList.toggle('hidden', lt.kind !== 'va');
  const { downPct } = resolveLoan(p, limits);
  $('sec-pmi').classList.toggle('hidden', !(lt.kind === 'conventional' && downPct < 20));
}

function renderCalculator() {
  const p = normalize(readInputs());
  updateSectionVisibility(p);

  // Auto placeholders
  $('in-armPostRatePct').placeholder = (p.ratePct + 2).toFixed(2);
  const { ltv, principal, upfrontFees, feeLabel, baseLoan, downPct } = resolveLoan(p, limits);
  $('in-fhaAnnualMipPct').placeholder = fhaAutoAnnualMip(ltv, limits).toFixed(2);

  const effNote = $('res-effRate');
  effNote.textContent =
    p.points > 0 ? `Effective rate after ${p.points} point(s): ${pctFmt(effectiveRate(p))}` : '';

  if (p.homePrice <= 0 || p.downDollars >= p.homePrice) {
    $('res-monthlyPI').textContent = '—';
    $('res-breakdown').innerHTML = '';
    $('res-summary').innerHTML = '<tr><td>Enter a home price greater than the down payment.</td></tr>';
    $('points-panel').classList.add('hidden');
    $('jumbo-badge').classList.add('hidden');
    return;
  }

  const { months, summary: s } = buildSchedule(p, limits);
  $('res-monthlyPI').textContent = usd(s.monthlyPI) + '/mo';

  const f = s.firstMonth;
  const rows = [
    ['Principal & interest', s.monthlyPI],
    ['Mortgage insurance', f.mi],
    ['Property tax (first yr)', f.tax],
    ['Home insurance', f.ins],
    ['HOA', f.hoa],
    ['Mello-Roos', f.mello],
  ].filter(([, v], i) => i < 1 || v > 0);
  $('res-breakdown').innerHTML =
    rows.map(([k, v]) => `<tr><td>${k}</td><td>${usd(v)}</td></tr>`).join('') +
    `<tr class="total"><td>All-in monthly (first month)</td><td>${usd(s.firstMonthAllIn)}</td></tr>`;

  const sm = [
    ['Base loan amount', usd(baseLoan)],
    feeLabel ? [feeLabel, usd(s.financedFees || s.upfrontFees)] : null,
    s.financedFees > 0 ? ['Amount financed', usd(s.principal)] : null,
    ['Down payment', `${usd(p.downDollars)} (${pctFmt(downPct, 1)})`],
    ['LTV', pctFmt(ltv * 100, 1)],
    p.points > 0 ? ['Points cost (at closing)', usd(s.pointsCost)] : null,
    s.fixedMonths
      ? [`Rate after ${s.fixedMonths / 12} yrs (assumed)`, pctFmt(s.postRatePct)]
      : null,
    ['Total interest', usd(s.totalInterest)],
    s.totalMI > 0 ? ['Total mortgage insurance', usd(s.totalMI)] : null,
    s.miEndMonth ? ['MI ends after', yearsLabel(s.miEndMonth)] : null,
    ['Total paid (P&I + upfront)', usd(s.totalPI)],
    ['Total all-in cost', usd(s.totalAllIn)],
    ['Paid off in', yearsLabel(s.payoffMonth)],
  ].filter(Boolean);
  $('res-summary').innerHTML = sm
    .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
    .join('');

  // Jumbo badge
  const badge = $('jumbo-badge');
  if (principal > limits.conformingHighCostMax) {
    badge.textContent = `Loan exceeds even the high-cost-area conforming ceiling (${usd(limits.conformingHighCostMax)}) — jumbo pricing applies.`;
    badge.classList.remove('hidden');
  } else if (principal > limits.conformingBaseline) {
    badge.textContent = `Loan is above the ${limits.year} baseline conforming limit (${usd(limits.conformingBaseline)}) — jumbo or high-balance pricing likely applies.`;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  if (ratesData) renderBenchmark($('benchmark'), ratesData, p.loanType, p.ratePct);

  // Points panel
  const panel = $('points-panel');
  const be = pointsBreakEven(p, limits);
  if (be) {
    panel.classList.remove('hidden');
    $('points-stats').innerHTML = [
      ['Points cost (at closing)', usd(s.pointsCost)],
      ['Monthly P&I savings', usd(be.monthlySavings)],
      ['Break-even', be.breakEvenMonth ? yearsLabel(be.breakEvenMonth) : 'never (within loan term)'],
      [be.savings >= 0 ? 'Lifetime savings' : 'Lifetime loss', usd(Math.abs(be.savings))],
    ]
      .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
      .join('');
    const toPts = (sched) =>
      [{ x: 0, y: sched.summary.pointsCost + sched.summary.upfrontFees }].concat(
        sched.months.map((r) => ({ x: r.m / 12, y: r.cumAllIn }))
      );
    const series = [
      { label: `With ${p.points} pt`, color: seriesColor(0), points: toPts(be.withSchedule) },
      { label: 'Without points', color: seriesColor(1), points: toPts(be.withoutSchedule) },
    ];
    if (be.breakEvenMonth) {
      series[0].markers = [{
        x: be.breakEvenMonth / 12,
        y: be.withSchedule.months[be.breakEvenMonth - 1].cumAllIn,
        label: 'Break-even',
        style: 'circle',
      }];
    }
    renderCumulativeChart($('chart-points'), series, { yLabel: 'Cumulative cost ($)' });
  } else {
    panel.classList.add('hidden');
  }
}

// ---------------- Tab 2: Compare ----------------

function compareEntries() {
  return [
    { id: 'current', name: 'Current inputs', inputs: readInputs(), saved: false },
    ...store.loadProfiles().map((p) => ({ id: p.id, name: p.name, inputs: p.inputs, saved: true })),
  ];
}

function ensureSelection(entries) {
  if (!selectedProfileIds) selectedProfileIds = new Set(entries.map((e) => e.id));
  return selectedProfileIds;
}

function entryDesc(inputs) {
  const p = normalize(inputs);
  const bits = [LOAN_TYPES[p.loanType]?.label ?? p.loanType, pctFmt(p.ratePct), usd(p.homePrice)];
  if (p.points > 0) bits.push(`${p.points} pt`);
  return bits.join(' · ');
}

function renderCompare() {
  const entries = compareEntries();
  const sel = ensureSelection(entries);

  $('profile-list').innerHTML = entries
    .map((e, i) => `
      <div class="profile-row">
        <input type="checkbox" data-sel="${e.id}" ${sel.has(e.id) ? 'checked' : ''}>
        <span class="swatch" style="background:${seriesColor(i)}"></span>
        <span class="p-name">${e.name}</span>
        <span class="p-desc">${entryDesc(e.inputs)}</span>
        ${e.saved ? `<button data-rename="${e.id}">rename</button><button data-del="${e.id}">delete</button>` : ''}
      </div>`)
    .join('');

  const allIn = $('cmp-allin').checked;
  const key = allIn ? 'cumAllIn' : 'cumPI';
  const band = $('cmp-armband').checked;
  const series = [];
  const tableRows = [];

  entries.forEach((e, i) => {
    const p = normalize(e.inputs);
    if (p.homePrice <= 0 || p.downDollars >= p.homePrice) return;
    const sched = buildSchedule(p, limits);
    const s = sched.summary;
    if (sel.has(e.id)) {
      const start = s.pointsCost + s.upfrontFees;
      const pts = [{ x: 0, y: start }].concat(sched.months.map((r) => ({ x: r.m / 12, y: r[key] })));
      const markers = [];
      if (s.miEndMonth) {
        markers.push({
          x: s.miEndMonth / 12, y: sched.months[s.miEndMonth - 1][key], label: `${e.name}: MI ends`,
        });
      }
      if (s.payoffMonth < s.termMonths) {
        markers.push({
          x: s.payoffMonth / 12, y: sched.months[s.payoffMonth - 1][key],
          label: `${e.name}: paid off`, style: 'rect',
        });
      }
      series.push({
        label: e.name, color: seriesColor(i), points: pts, markers,
        dashFromX: s.fixedMonths ? s.fixedMonths / 12 : null,
      });
      if (band && s.fixedMonths) {
        for (const [suffix, override] of [
          ['best (rate holds)', s.effRatePct],
          ['worst (+5 cap)', s.effRatePct + 5],
        ]) {
          const b = buildSchedule(p, limits, { postRateOverride: override });
          series.push({
            label: `${e.name} — ${suffix}`,
            color: seriesColor(i),
            thin: true,
            dashed: true,
            points: [{ x: 0, y: start }].concat(b.months.map((r) => ({ x: r.m / 12, y: r[key] }))),
          });
        }
      }
    }
    tableRows.push({ name: e.name, i, s });
  });

  renderCumulativeChart($('chart-cumulative'), series, {
    yLabel: allIn ? 'Cumulative all-in cost ($)' : 'Cumulative P&I + upfront ($)',
  });

  // Breakdown chart profile selector
  const bp = $('cmp-breakdown-profile');
  const prev = bp.value;
  bp.innerHTML = entries
    .map((e) => `<option value="${e.id}">${e.name}</option>`)
    .join('');
  if ([...bp.options].some((o) => o.value === prev)) bp.value = prev;
  const chosen = entries.find((e) => e.id === bp.value) ?? entries[0];
  if (chosen) {
    const p = normalize(chosen.inputs);
    if (p.homePrice > 0 && p.downDollars < p.homePrice) {
      renderBreakdownChart($('chart-breakdown'), buildSchedule(p, limits));
    }
  }

  // Comparison table with best-in-column highlighting (lower is better)
  const cols = [
    ['Monthly P&I', (s) => s.monthlyPI],
    ['First-mo all-in', (s) => s.firstMonthAllIn],
    ['Total interest', (s) => s.totalInterest],
    ['Total MI', (s) => s.totalMI],
    ['Total P&I', (s) => s.totalPI],
    ['Total all-in', (s) => s.totalAllIn],
  ];
  const best = cols.map(([, fn]) => Math.min(...tableRows.map((r) => fn(r.s))));
  $('cmp-table').innerHTML =
    `<tr><th>Profile</th>${cols.map(([h]) => `<th>${h}</th>`).join('')}<th>Paid off</th></tr>` +
    tableRows
      .map(
        (r) =>
          `<tr><td><span class="swatch" style="background:${seriesColor(r.i)}"></span>${r.name}</td>` +
          cols
            .map(([, fn], c) => {
              const v = fn(r.s);
              const isBest = tableRows.length > 1 && Math.abs(v - best[c]) < 0.5;
              return `<td${isBest ? ' class="best"' : ''}>${usd(v)}</td>`;
            })
            .join('') +
          `<td>${yearsLabel(r.s.payoffMonth)}</td></tr>`
      )
      .join('');
}

// ---------------- Tab 3: Down payment explorer ----------------

function renderExplorer() {
  const base = readInputs();
  const price = num('ex-homePrice');
  const rate = num('ex-ratePct');
  const loanType = $('ex-loanType').value;
  const presets = $('ex-presets').value
    .split(',')
    .map((s) => parseFloat(s.trim()))
    .filter((v) => Number.isFinite(v) && v >= 0 && v < 100);

  if (price <= 0 || presets.length === 0) return;

  const series = [];
  const rows = [];
  presets.forEach((pct, i) => {
    const p = normalize({
      ...base,
      homePrice: price,
      ratePct: rate,
      loanType,
      downMode: 'percent',
      downPercent: pct,
      points: 0,
      extraMonthly: 0,
      extraOnceAmount: 0,
    });
    const sched = buildSchedule(p, limits);
    const s = sched.summary;
    const markers = s.miEndMonth
      ? [{ x: s.miEndMonth / 12, y: sched.months[s.miEndMonth - 1].cumAllIn, label: `${pct}%: MI ends` }]
      : [];
    series.push({
      label: `${pct}% down`,
      color: seriesColor(i),
      points: [{ x: 0, y: s.upfrontFees }].concat(sched.months.map((r) => ({ x: r.m / 12, y: r.cumAllIn }))),
      markers,
      dashFromX: s.fixedMonths ? s.fixedMonths / 12 : null,
    });
    rows.push({ pct, down: p.downDollars, s, firstMI: sched.months[0]?.mi ?? 0 });
  });

  renderCumulativeChart($('chart-explorer'), series, { yLabel: 'Cumulative all-in cost ($)' });

  $('ex-table').innerHTML =
    `<tr><th>Down</th><th>Down $</th><th>Loan</th><th>Monthly P&I</th><th>MI /mo</th><th>First-mo all-in</th><th>MI ends</th><th>Total MI</th><th>Total all-in</th></tr>` +
    rows
      .map(
        (r) =>
          `<tr><td>${r.pct}%</td><td>${usd(r.down)}</td><td>${usd(r.s.principal)}</td>` +
          `<td>${usd(r.s.monthlyPI)}</td><td>${usd(r.firstMI)}</td><td>${usd(r.s.firstMonthAllIn)}</td>` +
          `<td>${r.s.miEndMonth ? yearsLabel(r.s.miEndMonth) : r.firstMI > 0 ? 'life of loan' : '—'}</td>` +
          `<td>${usd(r.s.totalMI)}</td><td>${usd(r.s.totalAllIn)}</td></tr>`
      )
      .join('');
}

// ---------------- Tab 4: Household split ----------------

function householdSource() {
  const sel = $('hh-source');
  const entries = compareEntries();
  const prev = sel.value;
  sel.innerHTML = entries.map((e) => `<option value="${e.id}">${e.name}</option>`).join('');
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  return entries.find((e) => e.id === sel.value) ?? entries[0];
}

function householdMortgageMonthly() {
  const src = householdSource();
  const p = normalize(src.inputs);
  if (p.homePrice <= 0 || p.downDollars >= p.homePrice) return 0;
  const s = buildSchedule(p, limits).summary;
  return $('hh-pionly').checked ? s.monthlyPI : s.firstMonthAllIn;
}

function renderHouseholdRows() {
  $('hh-people').innerHTML = household.people
    .map(
      (p) => `
      <div class="hh-row">
        <label>Name<input type="text" data-pid="${p.id}" data-field="name" value="${p.name ?? ''}"></label>
        <label>Income as<select data-pid="${p.id}" data-field="incomeMode">
          <option value="salary" ${p.incomeMode !== 'net2w' ? 'selected' : ''}>Gross salary /yr</option>
          <option value="net2w" ${p.incomeMode === 'net2w' ? 'selected' : ''}>Take-home / 2 wks</option>
        </select></label>
        ${p.incomeMode === 'net2w'
          ? `<label>Take-home ($/2 wks)<input type="number" min="0" step="50" data-pid="${p.id}" data-field="netBiweekly" value="${p.netBiweekly ?? 0}"></label>`
          : `
        <label>Salary ($/yr)<input type="number" min="0" step="1000" data-pid="${p.id}" data-field="salaryAnnual" value="${p.salaryAnnual ?? 0}"></label>
        <label>Filing<select data-pid="${p.id}" data-field="filing">
          <option value="single" ${p.filing !== 'mfj' ? 'selected' : ''}>Single</option>
          <option value="mfj" ${p.filing === 'mfj' ? 'selected' : ''}>Married joint</option>
        </select></label>
        <label>Pre-tax ($/mo)<input type="number" min="0" step="50" data-pid="${p.id}" data-field="preTaxMonthly" value="${p.preTaxMonthly ?? 0}"></label>`}
        <label>Share as<select data-pid="${p.id}" data-field="shareMode">
          <option value="pct" ${p.shareMode !== 'usd' ? 'selected' : ''}>% of payment</option>
          <option value="usd" ${p.shareMode === 'usd' ? 'selected' : ''}>$ / month</option>
        </select></label>
        <label>Share value<input type="number" min="0" step="1" data-pid="${p.id}" data-field="shareValue" value="${p.shareValue ?? 0}"></label>
        <button type="button" class="remove" data-remove-person="${p.id}">remove</button>
      </div>`
    )
    .join('') || '<p class="muted">No people yet — add one below.</p>';

  $('hh-costs').innerHTML = household.costs
    .map((c) => {
      const personOpts = household.people
        .map((p) => `<option value="${p.id}" ${c.personId === p.id ? 'selected' : ''}>${p.name || 'Person'}</option>`)
        .join('');
      const pctInputs =
        c.split === 'custom'
          ? `<div class="hh-pcts">${household.people
              .map(
                (p) =>
                  `<label>${p.name || 'Person'} (%)<input type="number" min="0" max="100" step="1" data-cid="${c.id}" data-pct-pid="${p.id}" value="${c.pct?.[p.id] ?? 0}"></label>`
              )
              .join('')}</div>`
          : '';
      return `
      <div class="hh-row">
        <label>Cost<input type="text" data-cid="${c.id}" data-field="name" value="${c.name ?? ''}"></label>
        <label>Amount ($/mo)<input type="number" min="0" step="5" data-cid="${c.id}" data-field="amount" value="${c.amount ?? 0}"></label>
        <label>Split<select data-cid="${c.id}" data-field="split">
          <option value="even" ${c.split === 'even' ? 'selected' : ''}>Even split</option>
          <option value="custom" ${c.split === 'custom' ? 'selected' : ''}>Custom %</option>
          <option value="personal" ${c.split === 'personal' ? 'selected' : ''}>Personal (one person)</option>
        </select></label>
        ${c.split === 'personal' ? `<label>Whose<select data-cid="${c.id}" data-field="personId">${personOpts}</select></label>` : ''}
        <button type="button" class="remove" data-remove-cost="${c.id}">remove</button>
        ${pctInputs}
      </div>`;
    })
    .join('') || '<p class="muted">No shared costs.</p>';
}

function renderHouseholdResults() {
  const total = householdMortgageMonthly();
  $('hh-mortgage-total').textContent = `Monthly amount being split: ${usd(total)} (${$('hh-pionly').checked ? 'P&I only' : 'all-in, first month'})`;

  const { rows, shareTotal, shareGap } = computeHousehold(household, total, taxData);
  const warn = $('hh-warning');
  if (rows.length > 0 && Math.abs(shareGap) > 1) {
    warn.textContent =
      shareGap > 0
        ? `Shares cover ${usd(shareTotal)} of ${usd(total)} — ${usd(shareGap)}/mo is unassigned.`
        : `Shares total ${usd(shareTotal)} — ${usd(-shareGap)}/mo more than the payment.`;
    warn.classList.remove('hidden');
  } else {
    warn.classList.add('hidden');
  }

  const cell = (v) => (v == null ? '—' : usd(v));
  $('hh-table').innerHTML =
    `<tr><th>Person</th><th>Gross /mo</th><th>Pre-tax</th><th>Est. taxes</th><th>Take-home</th><th>Mortgage share</th><th>Other costs</th><th>Spending money</th></tr>` +
    rows
      .map(
        (r) =>
          `<tr><td>${r.name}${r.fromPayroll ? ' <span class="muted">(payroll)</span>' : ''}</td>` +
          `<td>${cell(r.gross)}</td><td>${cell(r.preTax)}</td><td>${cell(r.taxes)}</td>` +
          `<td>${usd(r.takeHome)}</td><td>${usd(r.mortgage)}</td><td>${usd(r.other)}</td>` +
          `<td${r.spending < 0 ? ' class="negative"' : ''}>${usd(r.spending)}</td></tr>`
      )
      .join('');

  if (rows.length > 0) renderHouseholdChart($('chart-household'), rows);
  $('hh-taxnote').textContent = `Tax estimate (tax year ${taxData.taxYear}): federal + California income tax, CA SDI, Social Security and Medicare, standard deduction, W-2 wages only — no credits, dependents, or itemizing. Rough numbers, not tax advice. People entered as "Take-home / 2 wks" use their actual payroll number instead (annualized: ×26 paychecks ÷ 12 months), so no tax estimate is applied.`;
}

function renderHousehold() {
  householdSource();
  renderHouseholdRows();
  renderHouseholdResults();
}

// ---------------- tabs & events ----------------

function renderTab(tab) {
  if (tab === 'calculator') renderCalculator();
  else if (tab === 'compare') renderCompare();
  else if (tab === 'explorer') renderExplorer();
  else if (tab === 'household') renderHousehold();
}

function bindEvents() {
  $('tabs').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.tab-btn');
    if (!btn) return;
    activeTab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach((s) =>
      s.classList.toggle('active', s.id === 'tab-' + activeTab)
    );
    renderTab(activeTab);
  });

  $('calc-form').addEventListener('input', (ev) => {
    if (ev.target.id === 'in-downPercent') lastDownEdited = 'percent';
    if (ev.target.id === 'in-downDollars') lastDownEdited = 'dollars';
    if (['in-downPercent', 'in-downDollars', 'in-homePrice'].includes(ev.target.id)) syncDown();
    renderCalculator();
  });

  $('btn-save-profile').addEventListener('click', () => {
    const name = prompt('Profile name:', `${LOAN_TYPES[$('in-loanType').value].label} @ ${num('in-ratePct')}%`);
    if (!name) return;
    store.addProfile(name, readInputs());
    if (selectedProfileIds) selectedProfileIds.add([...store.loadProfiles()].pop().id);
    alert(`Saved "${name}". See it on the Compare tab.`);
  });

  $('btn-share').addEventListener('click', async () => {
    const url = store.encodeShareURL(readInputs());
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      prompt('Copy this link:', url);
    }
    $('share-copied').classList.remove('hidden');
    setTimeout(() => $('share-copied').classList.add('hidden'), 2000);
  });

  $('btn-refresh-rates').addEventListener('click', async () => {
    try {
      ratesData = await fetchRates(true);
    } catch { /* widget will show unavailable */ }
    renderCalculator();
  });

  // Compare tab
  for (const id of ['cmp-allin', 'cmp-armband', 'cmp-breakdown-profile']) {
    $(id).addEventListener('change', renderCompare);
  }
  $('profile-list').addEventListener('click', (ev) => {
    const t = ev.target;
    if (t.dataset.sel) {
      if (t.checked) selectedProfileIds.add(t.dataset.sel);
      else selectedProfileIds.delete(t.dataset.sel);
      renderCompare();
    } else if (t.dataset.rename) {
      const p = store.loadProfiles().find((x) => x.id === t.dataset.rename);
      const name = prompt('New name:', p?.name);
      if (name) { store.updateProfile(t.dataset.rename, { name }); renderCompare(); }
    } else if (t.dataset.del) {
      if (confirm('Delete this profile?')) {
        store.deleteProfile(t.dataset.del);
        selectedProfileIds?.delete(t.dataset.del);
        renderCompare();
      }
    }
  });
  $('btn-export').addEventListener('click', () => {
    const blob = new Blob([store.exportAll()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mortgage-profiles.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('file-import').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      store.importAll(await file.text());
      household = store.loadHousehold();
      selectedProfileIds = null;
      renderCompare();
      alert('Imported.');
    } catch (e) {
      alert('Import failed: ' + e.message);
    }
    ev.target.value = '';
  });

  // Explorer tab
  for (const id of ['ex-homePrice', 'ex-ratePct', 'ex-presets']) {
    $(id).addEventListener('input', renderExplorer);
  }
  $('ex-loanType').addEventListener('change', renderExplorer);

  // Household tab
  $('hh-source').addEventListener('change', renderHouseholdResults);
  $('hh-pionly').addEventListener('change', renderHouseholdResults);
  $('btn-add-person').addEventListener('click', () => {
    household.people.push({
      id: 'per' + Math.random().toString(36).slice(2, 8),
      name: `Person ${household.people.length + 1}`,
      incomeMode: 'salary', netBiweekly: 0,
      salaryAnnual: 100000, filing: 'single', preTaxMonthly: 0,
      shareMode: 'pct',
      shareValue: household.people.length === 0 ? 100 : 0,
    });
    store.saveHousehold(household);
    renderHousehold();
  });
  $('btn-add-cost').addEventListener('click', () => {
    household.costs.push({
      id: 'c' + Math.random().toString(36).slice(2, 8),
      name: 'New cost', amount: 50, split: 'even', pct: {}, personId: household.people[0]?.id ?? null,
    });
    store.saveHousehold(household);
    renderHousehold();
  });
  const structural = new Set(['split', 'personId']);
  const onHouseholdEdit = (ev) => {
    const t = ev.target;
    if (t.dataset.pid && t.dataset.field) {
      const p = household.people.find((x) => x.id === t.dataset.pid);
      if (!p) return;
      const v = ['name', 'filing', 'shareMode', 'incomeMode'].includes(t.dataset.field)
        ? t.value
        : parseFloat(t.value) || 0;
      p[t.dataset.field] = v;
      if (t.dataset.field === 'incomeMode') {
        store.saveHousehold(household);
        renderHousehold();
        return;
      }
    } else if (t.dataset.cid && t.dataset.pctPid) {
      const c = household.costs.find((x) => x.id === t.dataset.cid);
      if (!c) return;
      c.pct = c.pct || {};
      c.pct[t.dataset.pctPid] = parseFloat(t.value) || 0;
    } else if (t.dataset.cid && t.dataset.field) {
      const c = household.costs.find((x) => x.id === t.dataset.cid);
      if (!c) return;
      c[t.dataset.field] = ['name', 'split', 'personId'].includes(t.dataset.field)
        ? t.value
        : parseFloat(t.value) || 0;
      if (structural.has(t.dataset.field)) {
        store.saveHousehold(household);
        renderHousehold();
        return;
      }
    } else {
      return;
    }
    store.saveHousehold(household);
    renderHouseholdResults();
  };
  $('hh-people').addEventListener('input', onHouseholdEdit);
  $('hh-costs').addEventListener('input', onHouseholdEdit);
  const onHouseholdRemove = (ev) => {
    const t = ev.target;
    if (t.dataset.removePerson) {
      household.people = household.people.filter((x) => x.id !== t.dataset.removePerson);
    } else if (t.dataset.removeCost) {
      household.costs = household.costs.filter((x) => x.id !== t.dataset.removeCost);
    } else return;
    store.saveHousehold(household);
    renderHousehold();
  };
  $('hh-people').addEventListener('click', onHouseholdRemove);
  $('hh-costs').addEventListener('click', onHouseholdRemove);

  // Re-render charts when the OS theme flips (colors come from CSS variables).
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderTab(activeTab));
}

// ---------------- init ----------------

async function init() {
  // Populate loan type selects
  const opts = Object.entries(LOAN_TYPES)
    .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
    .join('');
  $('in-loanType').innerHTML = opts;
  $('ex-loanType').innerHTML = opts;

  try {
    [limits, taxData] = await Promise.all([
      fetch('data/limits.json').then((r) => r.json()),
      fetch('data/tax.json').then((r) => r.json()),
    ]);
  } catch (e) {
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<div class="badge warn">Could not load data files. If you opened index.html directly from disk, serve it over HTTP instead (see INSTRUCTIONS.md — e.g. <code>python -m http.server</code>).</div>'
    );
    throw e;
  }

  const shared = store.decodeShareURL(window.location.search);
  if (shared) writeInputs(shared);

  bindEvents();
  syncDown();
  renderCalculator();

  fetchRates()
    .then((r) => { ratesData = r; renderCalculator(); })
    .catch(() => renderBenchmark($('benchmark'), null, $('in-loanType').value, 0));
}

init();
